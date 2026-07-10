# News — Bias arah currency non-USD — Design

Tanggal: 2026-07-10
Status: Disetujui → TDD

## Tujuan
Event ekonomi non-USD (mis. UK CPI di GBP/USD, ECB di EUR/USD) saat ini tampil sebagai
marker + data tapi verdict **netral** (engine USD-centric). Generalisasi engine bias agar
event non-USD memberi **arah** (bullish/bearish) untuk instrumen aktif, di tempat yang sama
dengan bias USD (bias card panel, popup marker chart, baris event kalender).

## Konteks kode
- `internal/news/verdict.go`: `USDLean` (Neutral/Hawkish/Dovish) = tekanan USD; `usdLeanFor(kind,surprise)`;
  `Release.Classify() Verdict{Surprise,Lean,Label,Tilt,Tiebreak}` (Lean sudah dihitung utk SEMUA release).
- `internal/news/bias.go`: `InstrumentRole(symbol)` (RoleQuoteUSD/BaseUSD/Gold/DXY/Unknown),
  `InstrumentBias(lean,role) Bias`, `Playbook`, `PreScenario`, `fiat` map.
- `news.go` `buildCalendarResponse` (~baris 94-150): `role=InstrumentRole(instrument)`; bias hanya dihitung
  bila `it.Currency=="USD"` (baris 128), selain itu Lite netral (139-142). `it.Currency=h.Country` (kode currency event).
- Frontend `index.html`: `newsBiasLine(v)` render baris bias **hanya bila `v.bias` non-neutral** → begitu engine
  kasih arah utk non-USD, baris muncul otomatis. Bias card & `.np-bias` popup marker idem. Nyaris nol perubahan FE.
- Test: `internal/news/verdict_test.go`, `internal/news/bias_test.go`.

## Desain

### 1. `bias.go` — sisi event-currency terhadap pair
Tambah konsep Side (peran currency EVENT terhadap instrumen), gantikan pemetaan USD-only:
```go
type Side int
const ( SideNone Side = iota; SideBase; SideQuote; SideGoldUSD; SideDXYUSD )

// SideOf: peran `ccy` (currency event) pada `symbol`.
//   EUR_USD + EUR → SideBase ; EUR_USD + USD → SideQuote
//   USD_JPY + USD → SideBase ; USD_JPY + JPY → SideQuote
//   XAU_USD/XAG_USD + USD → SideGoldUSD (event non-USD di gold → SideNone)
//   DXY + USD → SideDXYUSD
//   ccy bukan bagian pair / non-fiat → SideNone
func SideOf(symbol, ccy string) Side

// BiasFrom: kekuatan currency event (lean) + side → bias instrumen.
//   lean Neutral / SideNone → BiasNeutral
//   SideBase:    strong→Bullish, weak→Bearish
//   SideQuote:   strong→Bearish, weak→Bullish
//   SideGoldUSD: USD strong→Bearish, weak→Bullish (gold inverse USD)
//   SideDXYUSD:  USD strong→Bullish, weak→Bearish
func BiasFrom(lean USDLean, side Side) Bias
```
`strong` = `lean==LeanHawkish` (currency menguat), `weak` = `LeanDovish`.

**Backward-compatible** (kasus USD lama identik):
- EUR/USD+USD hawkish → SideQuote → Bearish (= RoleQuoteUSD lama)
- USD/JPY+USD hawkish → SideBase → Bullish (= RoleBaseUSD lama)
- XAU/USD+USD hawkish → SideGoldUSD → Bearish (= RoleGold lama)
- DXY+USD hawkish → SideDXYUSD → Bullish (= RoleDXY lama)

Kasus baru:
- GBP/USD + GBP strong → SideBase → Bullish ; GBP/USD + GBP weak → Bearish
- EUR/GBP + GBP strong → SideQuote → Bearish ; EUR/GBP + EUR strong → SideBase → Bullish
- USD/JPY + JPY strong → SideQuote → Bearish

`InstrumentRole`/`InstrumentBias` lama DIPERTAHANKAN (dipakai? — cek; bila hanya dipakai di news.go, boleh diganti; simpan bila ada test/pemakai lain). `Playbook`/`PreScenario` digeneralisasi menyebut currency event.

### 2. `verdict.go` — makna `Lean` jadi umum
Reinterpretasi `USDLean` sebagai "kekuatan currency event" (nama tipe & string `hawkish/dovish/neutral`
TETAP → **JSON tak berubah**, `usdLean` dipertahankan). `usdLeanFor`→`ccyLeanFor` (logika identik).
Komentar diperjelas. `RegimeHawkishOnStrong` tetap.

### 3. `news.go` — hitung bias utk semua event fiat
Ganti gate `if it.Currency=="USD"`:
```go
if it.Released {
    v := rel.Classify()
    side := news.SideOf(instrument, it.Currency)
    bias := news.BiasFrom(v.Lean, side)
    it.Verdict = calVerdict{ Surprise:v.Surprise.String(), USDLean:v.Lean.String(),
        Bias:bias.String(), Label:v.Label, Playbook:news.Playbook(...event ccy...), Tiebreak:v.Tiebreak }
}
```
Event yang currency-nya bukan fiat dikenal / tak terkait pair → `SideNone` → bias netral (Lite, seperti sekarang).
PreScenario (belum rilis) juga pakai side (skenario "di atas forecast → …").

### 4. Frontend — nol/again minimal
Tak ada perubahan wajib; baris bias muncul otomatis untuk verdict non-netral. (Verifikasi visual saat live.)

## Testing (TDD, `go test ./internal/news/`)
1. **bias_test.go** (tulis dulu, merah):
   - `SideOf`: semua kasus base/quote/gold/DXY/none (USD & non-USD).
   - `BiasFrom`: matriks side × lean (strong/weak/neutral).
   - Regresi: kombinasi USD lama menghasilkan Bias sama dengan sebelumnya.
2. **verdict_test.go**: `Classify` tetap hijau (Lean & Tilt tak berubah untuk kasus lama).
3. **news_test.go** (bila ada test buildCalendarResponse): tambah kasus GBP event di GBP/USD → bias bullish/bearish.
4. Run `go build ./... && go test ./...` hijau.

## Verifikasi
- `go test ./...` hijau (unit).
- Manual: buka GBP/USD, cek event GBP (mis. UK CPI) yg sudah rilis kini punya baris bias berarah
  (butuh data live/login) — minimal pastikan server build & `/api/news/calendar?instrument=GBP_USD` mengembalikan
  `bias` non-neutral untuk event GBP yang released.

## Non-goal
Perluas `fiatCodes`/`fiat` (SEK/NOK) = item backlog terpisah. Rename JSON `usdLean` = TIDAK (dipertahankan).
