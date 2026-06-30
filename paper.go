// Paper engine per-user (Fase 2b): demo account server-side dengan saldo virtual.
// Eksekusi & valuasi 100% di server (anti-tamper); harga dari pricing Hub (satu
// upstream OANDA, read-only). Rumus P&L/pip/margin MIRROR dari index.html
// (tabel INSTRUMENT, quoteToUsd, pnlUsd, margin leverage-100) agar angka di
// server identik dengan yang dilihat user di chart.
//
// Posisi disimpan di tabel journal (mode='paper'); saldo cash di paper_accounts.
// DB ditulis HANYA saat open/close — equity/margin dihitung on-the-fly di sini.
package main

import (
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// instSpec = pip & mata uang quote per instrumen (mirror INSTRUMENT di FE).
type instSpec struct {
	pip   float64
	quote string
}

var instrumentSpec = map[string]instSpec{
	"EUR_USD": {0.0001, "USD"}, "GBP_USD": {0.0001, "USD"}, "AUD_USD": {0.0001, "USD"},
	"USD_CAD": {0.0001, "CAD"}, "USD_JPY": {0.01, "JPY"},
	"GBP_JPY": {0.01, "JPY"}, "EUR_JPY": {0.01, "JPY"},
	"XAU_USD": {0.1, "USD"}, "BTC_USD": {1, "USD"},
}

// approxUSDJPY = fallback konversi cross-JPY (mirror APPROX_USDJPY=157 di FE).
const approxUSDJPY = 157.0

// paperLeverage = leverage tetap untuk perhitungan margin (mirror FE: /100).
const paperLeverage = 100.0

func specOf(inst string) instSpec {
	if s, ok := instrumentSpec[inst]; ok {
		return s
	}
	return instSpec{0.0001, "USD"}
}

// quoteToUSD = faktor 1 unit mata-uang-quote → USD (mirror quoteToUsd FE).
func quoteToUSD(inst string, price float64) float64 {
	q := specOf(inst).quote
	switch {
	case q == "USD":
		return 1
	case strings.HasPrefix(inst, "USD_"): // USD_JPY, USD_CAD
		if price > 0 {
			return 1 / price
		}
		return 0
	case q == "JPY": // cross JPY (GBP_JPY, EUR_JPY)
		return 1 / approxUSDJPY
	default:
		return 1
	}
}

// pnlUSD = P&L dalam USD (mirror pnlUsd FE).
func pnlUSD(inst, dir string, entry, exit, units float64) float64 {
	mul := 1.0
	if dir == "short" {
		mul = -1
	}
	return (exit - entry) * mul * units * quoteToUSD(inst, exit)
}

// marginUSD = margin awal posisi (mirror FE: units*entry*quoteToUsd(entry)/leverage).
func marginUSD(inst string, entry, units float64) float64 {
	return units * entry * quoteToUSD(inst, entry) / paperLeverage
}

// entryPrice = harga buka dari Hub: buy→ask, sell→bid (bayar spread saat masuk).
func entryPrice(inst string, side Side) (float64, bool) {
	t, ok := hub.Last(Instrument(inst))
	if !ok {
		return 0, false
	}
	if side == Buy {
		return t.Ask, t.Ask > 0
	}
	return t.Bid, t.Bid > 0
}

// markPrice = harga utk menilai/menutup posisi: long di bid, short di ask.
func markPrice(inst, dir string) (float64, bool) {
	t, ok := hub.Last(Instrument(inst))
	if !ok {
		return 0, false
	}
	if dir == "long" {
		return t.Bid, t.Bid > 0
	}
	return t.Ask, t.Ask > 0
}

// paperPositionView = posisi terbuka + valuasi live untuk FE.
type paperPositionView struct {
	PaperTrade
	Price        float64 `json:"price"` // harga mark saat ini
	UnrealizedPL float64 `json:"unrealizedPl"`
	Margin       float64 `json:"margin"`
}

// GET /api/account → saldo + equity (on-the-fly) + margin paper user.
func handlePaperAccount(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	bal, err := store.PaperBalance(uid)
	if err != nil {
		log.Printf("paper account: baca saldo gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "gagal baca saldo")
		return
	}
	trades, err := store.OpenPaperTrades(uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal baca posisi")
		return
	}
	var openPnl, marginUsed float64
	for _, t := range trades {
		if mk, ok := markPrice(t.Instrument, t.Dir); ok {
			openPnl += pnlUSD(t.Instrument, t.Dir, t.Entry, mk, t.Units)
		}
		marginUsed += marginUSD(t.Instrument, t.Entry, t.Units)
	}
	eq := bal + openPnl
	writeJSON(w, http.StatusOK, Account{
		ID:                "paper",
		Currency:          "USD",
		Balance:           bal,
		Equity:            eq,
		UnrealizedPL:      openPnl,
		MarginUsed:        marginUsed,
		MarginAvailable:   eq - marginUsed,
		OpenPositionCount: len(trades),
	})
}

// GET /api/positions → posisi paper terbuka + unrealized live.
func handlePaperPositions(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	trades, err := store.OpenPaperTrades(uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal baca posisi")
		return
	}
	views := make([]paperPositionView, 0, len(trades))
	for _, t := range trades {
		v := paperPositionView{PaperTrade: t, Margin: marginUSD(t.Instrument, t.Entry, t.Units)}
		if mk, ok := markPrice(t.Instrument, t.Dir); ok {
			v.Price = mk
			v.UnrealizedPL = pnlUSD(t.Instrument, t.Dir, t.Entry, mk, t.Units)
		}
		views = append(views, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"positions": views})
}

// POST /api/order → buka posisi paper (market) di harga Hub. Idempotent via clientTag.
func handlePaperOrder(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "gagal baca body")
		return
	}
	req, err := validateOrder(cfg, raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Type != Market {
		writeErr(w, http.StatusBadRequest, "paper saat ini hanya mendukung market order")
		return
	}
	entry, ok := entryPrice(string(req.Instrument), req.Side)
	if !ok {
		writeErr(w, http.StatusServiceUnavailable, "harga belum tersedia — tunggu stream harga aktif")
		return
	}
	dir := "long"
	if req.Side == Sell {
		dir = "short"
	}

	// Idempotency: klaim clientTag dulu (cegah dobel akibat double-click/retry).
	var auditID int64
	var claimed bool
	if req.ClientTag != "" {
		id, okClaim, err := store.ClaimOrder("paper", req.ClientTag, "/api/order", string(raw))
		switch {
		case err != nil:
			log.Printf("paper order: klaim audit gagal (lanjut tanpa dedup): %v", err)
		case !okClaim:
			writeErr(w, http.StatusConflict, "order dengan clientTag ini sudah diproses — cek posisi")
			return
		default:
			auditID, claimed = id, true
		}
	}

	openTime := time.Now().UTC().Format(time.RFC3339)
	tradeID, err := store.OpenPaperTrade(uid, string(req.Instrument), dir, entry, req.Units, openTime, req.SL, req.TP)
	if claimed {
		status := http.StatusOK
		if err != nil {
			status = http.StatusInternalServerError
		}
		_ = store.CompleteOrderAudit(auditID, status, "")
	}
	if err != nil {
		log.Printf("paper order: buka posisi gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "gagal membuka posisi")
		return
	}
	writeJSON(w, http.StatusOK, paperPositionView{
		PaperTrade: PaperTrade{
			ID: tradeID, Instrument: string(req.Instrument), Dir: dir,
			Entry: entry, Units: req.Units, OpenTime: openTime, SL: req.SL, TP: req.TP,
		},
		Price:  entry,
		Margin: marginUSD(string(req.Instrument), entry, req.Units),
	})
}

type closeInput struct {
	ID int64 `json:"id"`
}

// POST /api/close → tutup posisi paper, realisasikan P&L di harga Hub, update saldo.
func handlePaperClose(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var in closeInput
	if err := decodeJSON(r, &in); err != nil || in.ID <= 0 {
		writeErr(w, http.StatusBadRequest, "id posisi wajib")
		return
	}
	t, err := store.GetPaperTrade(uid, in.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal baca posisi")
		return
	}
	if t == nil {
		writeErr(w, http.StatusNotFound, "posisi tidak ditemukan atau sudah ditutup")
		return
	}
	exit, ok := markPrice(t.Instrument, t.Dir)
	if !ok {
		writeErr(w, http.StatusServiceUnavailable, "harga belum tersedia — tunggu stream harga aktif")
		return
	}
	pnl := pnlUSD(t.Instrument, t.Dir, t.Entry, exit, t.Units)
	exitTime := time.Now().UTC().Format(time.RFC3339)
	newBal, err := store.ClosePaperTrade(uid, in.ID, exit, pnl, exitTime)
	if err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": in.ID, "exit": exit, "pnlCcy": pnl, "balance": newBal, "exitTime": exitTime,
	})
}

// GET /api/journal → riwayat posisi paper tertutup user.
func handlePaperJournal(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	closed, err := store.ClosedPaperTrades(uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal baca jurnal")
		return
	}
	if closed == nil {
		closed = []ClosedPaperTrade{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"trades": closed})
}
