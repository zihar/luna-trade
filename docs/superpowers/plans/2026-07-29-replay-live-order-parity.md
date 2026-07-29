# Parity Semantik Order Bar Replay ↔ Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat order di Bar Replay berperilaku sama dengan akun Live — banyak posisi, spread dibayar dua kali, SL/TP divalidasi & dibulatkan sama, grace pasca-entry, dan umpan balik toast yang identik.

**Architecture:** State replay `trade` tunggal diganti daftar `trades[]` dengan id negatif, sehingga sistem on-chart terpadu (`drawPaperLines`/`posLevel`, hasil PR parity 2026-07-06) langsung menerima banyak posisi replay seperti `SP.positions` di Live. Tiga helper baru di `js/sizing-pnl.js` (`synthHalfSpread`, `replayMarkPx`, `validateSLTPReplay`) jadi sumber tunggal harga bid/ask sintetis dan validasi SL/TP, cermin `markPrice`/`validateSLTP` di `paper.go`. Grace pasca-entry diwujudkan lewat `fillFrom` per posisi plus penerusan waktu **tutup** sub-bar dari `evalFills`.

**Tech Stack:** JavaScript classic script (51 modul `js/*.js`, tanpa bundler), Go 1.x (`paper.go`, `validate.go`, `store.go`), Playwright hermetik (`--project=hermetic`), `go test`.

**Spec:** `docs/superpowers/specs/2026-07-29-replay-live-order-parity-design.md`

## Global Constraints

- **Teks UI bahasa Inggris.** Semua label/tombol/chip/tooltip/toast yang tampil ke pengguna wajib Inggris (CLAUDE.md). Komentar kode & pesan commit boleh Indonesian.
- **Perilaku Live tak boleh berubah.** Satu-satunya perubahan sisi Live adalah *teks* pesan error — bukan status code, bentuk respons, atau logika.
- **Spread sintetis replay = `pip * 1.6`**, setengahnya di tiap sisi. Satu sumber: `synthHalfSpread()`. Angka ini harus tetap konsisten dengan `curBidAsk()` (`js/render.js:62`) — jangan tulis ulang `1.6` di tempat lain.
- **Kalimat error SL/TP muncul di TEPAT DUA tempat:** `sltpError` (`paper.go`) dan `validateSLTPReplay` (`js/sizing-pnl.js`). Keduanya dipin oleh test (Task 1 & Task 5). Kalau salah satu diubah, ubah keduanya.
- **Jangan buat nama global ganda** dan **jangan pakai identifier lintas-file di top-level** — `tests/smoke/module-hygiene.spec.js` menjaga dua hal itu dan akan merah.
- **Urutan muat modul relevan:** `sizing-pnl.js` → `sltp-draft.js` → `positions-onchart.js` → `replay-intrabar.js` → `broker-paper.js` → `stats-journal.js` → `trades-panel.js`. Helper baru masuk `sizing-pnl.js` karena ia yang paling awal.
- **Verifikasi sebelum push:** `npx playwright test tests/smoke --project=hermetic` **dan** `go test ./...`. Wajib `--project=hermetic`, JANGAN `npm test` (memicu suite penuh ~7 menit; itu tugas CI saat push `main`).
- **Commit conventional (Indonesian)** dengan trailer:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Branch sudah dibuat: `zihar/zihar/feat/replay-live-order-parity`.

## Struktur berkas

| Berkas | Tanggung jawab setelah plan ini |
|---|---|
| `js/state.js` | deklarasi `trades`, `replaySeq`, `pending` |
| `js/sizing-pnl.js` | spek instrumen, P&L, **harga bid/ask sintetis**, **validasi SL/TP**, `openTrade` |
| `js/replay-intrabar.js` | `evalFills`, pending order, `closeTrade`/`closeAllReplay` |
| `js/positions-onchart.js` | garis+pill on-chart, editor posisi, `checkTrades` |
| `js/trades-panel.js` | tabel Positions/Pending/Closed, `resetTrade` |
| `js/broker-paper.js` | fasad broker, akun Live server, `applyPaperMode` |
| `js/stats-journal.js` | statistik & `renderAcct` (agregat posisi) |
| `js/sltp-draft.js` | garis draft SL/TP tiket |
| `paper.go` | handler paper + `sltpError` (pesan Inggris, murni & teruji) |
| `tests/smoke/replay-order.spec.js` | **baru** — gerbang PR, order replay dasar |
| `tests/trading/replay-live-parity.spec.js` | **baru** — matriks parity untuk suite penuh |
| `paper_sltp_test.go` | **baru** — pin kalimat error SL/TP |

---

### Task 1: Pesan error server user-facing jadi Inggris

Cabut logika validasi SL/TP jadi fungsi murni `sltpError` supaya bisa diuji tanpa `hub`, lalu Inggriskan semua pesan yang benar-benar sampai ke pengguna.

**Files:**
- Create: `paper_sltp_test.go`
- Modify: `paper.go:106-129` (`validateSLTP`), `paper.go:252,257,280,298` dan pesan handler lain, `validate.go:28-78`, `store.go:427,481`

**Interfaces:**
- Consumes: —
- Produces: `func sltpError(dir string, sl, tp *float64, bid, ask float64) error` — validasi murni; `nil` bila valid. Kalimatnya dicermin `validateSLTPReplay` di Task 5.

- [ ] **Step 1: Tulis test yang gagal**

Create `paper_sltp_test.go`:

```go
// Kalimat error SL/TP dipin di sini karena ia dicermin PERSIS oleh
// validateSLTPReplay (js/sizing-pnl.js) supaya pesan di Bar Replay dan Live sama.
// Kalau kalimat di sini berubah, ubah juga cermin di frontend.
package main

import "testing"

func f(v float64) *float64 { return &v }

func TestSLTPError(t *testing.T) {
	cases := []struct {
		name     string
		dir      string
		sl, tp   *float64
		bid, ask float64
		want     string
	}{
		{"short SL di dalam spread", "short", f(1.1000), nil, 1.0999, 1.1001,
			"Stop Loss is inside the spread — place it above the Ask price."},
		{"short TP di dalam spread", "short", nil, f(1.1002), 1.0999, 1.1001,
			"Take Profit is inside the spread — place it below the Ask price."},
		{"long SL di dalam spread", "long", f(1.1000), nil, 1.0999, 1.1001,
			"Stop Loss is inside the spread — place it below the Bid price."},
		{"long TP di dalam spread", "long", nil, f(1.0998), 1.0999, 1.1001,
			"Take Profit is inside the spread — place it above the Bid price."},
		{"short valid", "short", f(1.1100), f(1.0900), 1.0999, 1.1001, ""},
		{"long valid", "long", f(1.0900), f(1.1100), 1.0999, 1.1001, ""},
		{"nil keduanya", "long", nil, nil, 1.0999, 1.1001, ""},
		{"harga belum ada → jangan tolak", "long", f(9), f(9), 0, 0, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := sltpError(c.dir, c.sl, c.tp, c.bid, c.ask)
			got := ""
			if err != nil {
				got = err.Error()
			}
			if got != c.want {
				t.Fatalf("sltpError = %q, mau %q", got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `go test -run TestSLTPError ./...`
Expected: gagal kompilasi — `undefined: sltpError`.

- [ ] **Step 3: Implementasi `sltpError` + `validateSLTP` jadi pembungkusnya**

Ganti `paper.go:106-129` dengan:

```go
// sltpError menolak SL/TP yang sudah di dalam spread (short dinilai di ask, long di bid)
// agar posisi tak langsung stop-out. Murni: harga di-inject supaya bisa diuji tanpa Hub,
// dan supaya kalimatnya bisa dipin test (paper_sltp_test.go). bid/ask <= 0 = harga belum
// tersedia → jangan tolak apa pun.
func sltpError(dir string, sl, tp *float64, bid, ask float64) error {
	if bid <= 0 || ask <= 0 {
		return nil
	}
	if dir == "short" {
		if sl != nil && *sl <= ask {
			return errors.New("Stop Loss is inside the spread — place it above the Ask price.")
		}
		if tp != nil && *tp >= ask {
			return errors.New("Take Profit is inside the spread — place it below the Ask price.")
		}
		return nil
	}
	if sl != nil && *sl >= bid {
		return errors.New("Stop Loss is inside the spread — place it below the Bid price.")
	}
	if tp != nil && *tp <= bid {
		return errors.New("Take Profit is inside the spread — place it above the Bid price.")
	}
	return nil
}

// validateSLTP = sltpError dengan harga dari Hub. nil = valid (atau harga belum tersedia).
func validateSLTP(inst Instrument, dir string, sl, tp *float64) error {
	tick, ok := hub.Last(inst)
	if !ok {
		return nil
	}
	return sltpError(dir, sl, tp, tick.Bid, tick.Ask)
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `go test -run TestSLTPError ./...`
Expected: PASS (8 subtest).

- [ ] **Step 5: Inggriskan pesan handler yang sampai ke pengguna**

Hanya empat titik frontend yang menampilkan teks server: `js/broker-paper.js:61` (`/api/order`), `js/broker-paper.js:73` (`/api/close`), `js/positions-onchart.js:119,341` (`/api/position/sltp`). Ganti pesan di jalur ketiga endpoint itu:

`paper.go`:
```
"gagal baca body"                                  → "Could not read the request body."
"id posisi wajib"                                  → "Position id is required."
"gagal baca posisi"                                → "Could not load the position."
"posisi tidak ditemukan atau sudah ditutup"        → "Position not found or already closed."
"paper saat ini hanya mendukung market order"      → "Paper accounts support market orders only."
"harga belum tersedia — tunggu stream harga aktif" → "Price feed isn't ready yet — wait for the price stream."
"gagal membuka posisi"                             → "Could not open the position."
"order dengan clientTag ini sudah diproses — cek posisi" → "This order was already processed — check your positions."
```

`validate.go`:
```
"body tidak valid: %v"                             → "Invalid request body: %v"
"instrument wajib"                                 → "Instrument is required."
"instrument %q tidak diizinkan (cek WHITELIST_INSTRUMENTS)" → "Instrument %q isn't allowed."
"side harus buy/sell"                              → "Side must be buy or sell."
"type harus market/limit/stop"                     → "Type must be market, limit, or stop."
"units harus > 0"                                  → "Units must be greater than 0."
"units %.0f melebihi cap %.0f (MAX_ORDER_UNITS)"   → "Units %.0f exceed the %.0f cap."
"price wajib & > 0 untuk order %s"                 → "Price is required and must be greater than 0 for a %s order."
"sl harus > 0"                                     → "Stop Loss must be greater than 0."
"tp harus > 0"                                     → "Take Profit must be greater than 0."
"trail harus > 0"                                  → "Trailing distance must be greater than 0."
```

`store.go:427` dan `store.go:481`:
```
"posisi tidak ditemukan atau sudah ditutup"        → "Position not found or already closed."
```

Biarkan Indonesian: seluruh komentar Go, semua `log.Printf`, dan pesan `api.go` (endpoint alert/analytics/auth tak menampilkan `d.error` ke pengguna lewat toast).

- [ ] **Step 6: Verifikasi suite Go & smoke tetap hijau**

Run:
```bash
go build ./... && go test ./...
npx playwright test tests/smoke --project=hermetic
```
Expected: keduanya PASS. Stub `tests/fixtures/api.js` tak meng-assert teks pesan, jadi smoke tak terpengaruh.

- [ ] **Step 7: Commit**

```bash
git add paper.go paper_sltp_test.go validate.go store.go
git commit -m "$(cat <<'EOF'
refactor(paper): pesan error user-facing jadi Inggris + sltpError murni

validateSLTP dipecah jadi sltpError (murni, harga di-inject) supaya bisa
diuji tanpa Hub dan kalimatnya bisa dipin — ia akan dicermin persis oleh
Bar Replay. Pesan writeErr di jalur /api/order, /api/close, dan
/api/position/sltp diinggriskan; komentar & log tetap Indonesian.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refactor mekanis `trade` → `trades[]` (perilaku belum berubah)

Ganti state tunggal jadi daftar **tanpa** mengubah perilaku: batas satu posisi masih berlaku. Tujuannya memisahkan risiko refactor dari perubahan semantik, supaya kalau ada regresi ia terisolasi di satu commit.

**Files:**
- Create: `tests/smoke/replay-order.spec.js`
- Modify: `js/state.js:10-11`, `js/sizing-pnl.js:75-90`, `js/positions-onchart.js` (`REPLAY_ID`, `replayPos`, `currentPositions`, `confirmClosePos`, `savePosLevel`, `commitPosSLTP`, `posLevel`, `recalcRisk`, `checkTrade`, `onNewBar`), `js/replay-intrabar.js` (`evalFills`, `checkPending`, `closeTrade`, hapus `partialClose`), `js/trades-panel.js` (`renderTrades`, `resetTrade`, handler `data-act`), `js/broker-paper.js:5-10`, `js/stats-journal.js:55,61`, `js/sltp-draft.js:38`

**Interfaces:**
- Consumes: —
- Produces:
  - `trades: Array<{id:number,no:number,dir:'long'|'short',entry:number,sl:number|null,tp:number|null,risk:number,units:number,trail:number,instrument:string,time:number,fillFrom:number}>`
  - `replaySeq: number`
  - `isReplayId(id:number): boolean`
  - `tradeById(id:number): object|null`
  - `replayPosView(t): object` — bentuk-posisi untuk `currentPositions()`
  - `closeTrade(id:number, exit:number, time:number): void`
  - `closeAllReplay(): void`
  - `checkTrades(c:object, close:number|null): void`

- [ ] **Step 1: Tulis test yang gagal**

Create `tests/smoke/replay-order.spec.js`:

```js
// Order di Bar Replay: sampai sekarang TAK ada satu pun test yang menyentuh jalur ini,
// padahal ia jalur eksekusi lengkap (buka posisi → garis+pill on-chart → tabel → close).
// Test ini gerbang PR untuk parity replay↔Live; matriks dalamnya ada di
// tests/trading/replay-live-parity.spec.js (suite penuh, jalan saat push main).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

/** Masuk Bar Replay lewat jalur UI nyata: ArrowRight → step(1) (js/keyboard.js). */
async function enterReplay(page) {
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => typeof replayMode !== 'undefined' && replayMode === true);
}

/**
 * Isi tiket order lewat kontrol nyata. #slPips/#tpPips/#slOn/#tpOn hidup di blok
 * `.op-expand` yang tersembunyi di mode simple → panel harus di-expand dulu.
 */
async function setTicket(page, { lots = '0.10', slTicks = '100', tpTicks = '200', sl = true, tp = true } = {}) {
  await page.click('#op2Expand');
  await page.fill('#lotInput', lots);
  await page.fill('#slPips', slTicks);
  await page.fill('#tpPips', tpTicks);
  if (sl !== (await page.isChecked('#slOn'))) await page.click('#slCard');
  if (tp !== (await page.isChecked('#tpOn'))) await page.click('#tpCard');
}

/** Jumlah posisi replay menurut state aplikasi sendiri. */
const posCount = (page) => page.evaluate(() => trades.length);

test('replay order: buka satu posisi → garis+pill on-chart, satu baris tabel', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);

  await page.click('#execBtn');

  expect(await posCount(page), 'posisi replay tak terbuka').toBe(1);
  await expect(page.locator('#tpNPos')).toHaveText('1');
  await expect(page.locator('#tpBody tr'), 'tabel Positions harus 1 baris').toHaveCount(1);

  // Pill P&L + garis SL & TP milik posisi itu ada di layer on-chart.
  await expect(page.locator('#posLayer .pos-node.entry .pos-pill')).toHaveCount(1);
  await expect(page.locator('#posLayer .pos-node.sl')).toHaveCount(1);
  await expect(page.locator('#posLayer .pos-node.tp')).toHaveCount(1);

  // Tutup dari tabel → posisi hilang, jurnal bertambah.
  await page.click('#tpBody button[data-act="close"]');
  expect(await posCount(page)).toBe(0);
  expect(await page.evaluate(() => journal.length)).toBe(1);

  assertNoPageErrors(page);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/smoke/replay-order.spec.js --project=hermetic`
Expected: FAIL pada `page.evaluate(() => trades.length)` — `trades is not defined`.

- [ ] **Step 3: Deklarasi state baru**

`js/state.js` — ganti baris 10-11:

```js
let trades = [];         // posisi replay TERBUKA (banyak, cermin SP.positions di Live)
let replaySeq = 0;       // penomoran tampilan: posisi ke-n → id internal -n (id Live selalu ≥1)
let pending = null;      // order menunggu harga tersentuh (satu slot; fitur khas replay)
```

- [ ] **Step 4: `openTrade` menulis ke `trades` (guard satu posisi MASIH ada)**

`js/sizing-pnl.js` — ganti `openTrade` (baris 75-90):

```js
function openTrade(dir){
  if(T==null||trades.length) return;   // guard 1-posisi masih berlaku; dilepas di Task 3
  const cur=currentCandle(); if(!cur) return;
  track('order',{dir,inst});
  const ba=curBidAsk();
  const entry = ba ? (dir==='short'?ba.bid:ba.ask) : cur.close;   // eksekusi di bid (sell) / ask (buy)
  const pip=+$('#pipSize').value, slp=+$('#slPips').value, rr=rrVal();
  const dist=slp*pip;
  const sl = $('#slOn').checked ? (dir==='long'?entry-dist:entry+dist) : null;
  const tp = $('#tpOn').checked ? (dir==='long'?entry+dist*rr:entry-dist*rr) : null;
  const no=++replaySeq;
  trades.push({id:-no,no,dir,entry,sl,tp,risk:dist,units:currentLots()*unitsPer(),
               trail: $('#trailOn').checked ? (+$('#trailPips').value||0)*pip : 0,
               instrument:inst, time:cur.timestamp, fillFrom:cur.timestamp});
  clearDraftLines(); drawPaperLines(); updateOpenTradeBox(); renderAcct(); renderSizing();
}
```

- [ ] **Step 5: Sumber posisi on-chart & pembantu id**

`js/positions-onchart.js` — ganti baris 7-19:

```js
function posById(id){ return currentPositions().find(x=>x.id===id); }
// Sumber posisi on-chart terpadu: Live → SP.positions; Replay → trades (dibungkus jadi posisi).
// id replay NEGATIF (-1,-2,…); id Live berasal dari rowid SQLite → selalu ≥1, jadi tandanya
// cukup sebagai diskriminator (menggantikan sentinel REPLAY_ID lama).
function isReplayId(id){ return id<0; }
function tradeById(id){ return trades.find(t=>t.id===id)||null; }
function replayPosView(t){
  const cur=currentCandle(), price=cur?cur.close:t.entry, units=t.units||0;
  return { id:t.id, no:t.no, src:'replay', instrument:t.instrument||inst,
    dir:t.dir, units, entry:t.entry, price, sl:t.sl, tp:t.tp,
    unrealizedPl: pnlUsd(t.dir,t.entry,price,units),
    margin: units*t.entry*quoteToUsd(t.entry)/100 };
}
function currentPositions(){ return spActive() ? (SP.positions||[]) : trades.map(replayPosView); }
function posPnlStr(v){ return (v>=0?'+':'-')+'$'+Math.abs(+v||0).toFixed(2); }
```

- [ ] **Step 6: Ganti semua cabang `REPLAY_ID` jadi `isReplayId` + per-posisi**

`js/positions-onchart.js`:

Baris 100-103 (`confirmClosePos`):
```js
function confirmClosePos(id,anchor){
  if(isReplayId(id)){ const t=tradeById(id); if(!t) return;
    miniConfirm('Close replay position?','Close',()=>{ const c=currentCandle(); if(c) closeTrade(id,c.close,c.timestamp); drawPaperLines(); },null,anchor); return; }
  miniConfirm(`Close position #${id}?`,'Close',()=>spClose(id),null,anchor);
}
```

Baris 112-115 (`savePosLevel`, cabang replay):
```js
  if(isReplayId(id)){ const t=tradeById(id); if(!t) return; t[kind]=+v; if(kind==='sl') recalcRisk(t);
    toast(kind.toUpperCase()+' updated','success'); drawPaperLines(); updateOpenTradeBox(); return; }
```

Baris 199-201 (`posLevel` entry drag):
```js
      onPressedMoving:(e)=>{ const t=tradeById(p.id); if(!t) return false;
        const v=e.overlay.points[0]&&e.overlay.points[0].value; if(v==null) return false;
        t.entry=v; try{renderPosDom(posById(p.id));}catch(_){} updateOpenTradeBox(); return false; },
```

Baris 225 (entry draggable):
```js
    else rec.entry=posLevel(p,'entry', isReplayId(p.id));   // entry replay bisa di-drag; entry live tidak
```

Baris 334-337 (`commitPosSLTP`, cabang replay):
```js
  if(isReplayId(editPos.id)){ const t=tradeById(editPos.id);
    if(t){ t.sl=editPos.slOn?+editPos.sl:null; t.tp=editPos.tpOn?+editPos.tp:null; recalcRisk(t); }
    toast('SL/TP updated','success'); closePositionEditor(); drawPaperLines(); updateOpenTradeBox(); return; }
```

Baris 361-364 (`recalcRisk` jadi per-posisi):
```js
function recalcRisk(t){
  if(!t) return;
  // lot tetap (sizing berbasis lot ala TradeLocker) — geser SL hanya ubah jarak risiko/$ & R, bukan ukuran lot
  if(t.sl!=null) t.risk=Math.abs(t.entry-t.sl)||t.risk;
}
```

Baris 366-381 (`checkTrade` → `checkTrades`, loop; parameter `close` sudah diterima tapi belum dipakai sampai Task 6):
```js
function checkTrades(c, close){
  if(!trades.length) return;
  trades.slice().forEach(t=>{
    if(t.fillFrom!=null && c.timestamp < t.fillFrom) return;   // jangan evaluasi bar sebelum entry
    let exit=null;
    if(t.dir==='long'){ if(t.sl!=null && c.low<=t.sl) exit=t.sl; else if(t.tp!=null && c.high>=t.tp) exit=t.tp; }
    else{ if(t.sl!=null && c.high>=t.sl) exit=t.sl; else if(t.tp!=null && c.low<=t.tp) exit=t.tp; }
    if(exit!==null){ closeTrade(t.id,exit,c.timestamp); return; }
    // trailing stop: rapatkan SL ke arah profit utk bar berikutnya (pakai ekstrem bar yang sudah close)
    if(t.trail>0 && t.sl!=null){
      const ns = t.dir==='long' ? c.high-t.trail : c.low+t.trail;
      const better = t.dir==='long' ? ns>t.sl : ns<t.sl;
      if(better) t.sl=ns;
    }
  });
}
// dipanggil tiap bar baru terungkap (juga dari jalur LIVE, js/live-refresh.js — di sana
// `trades` selalu kosong sehingga dua cek pertama no-op dan hanya checkAlerts yang bekerja).
function onNewBar(c){ const close=stepBarTs(currentTF,c.timestamp,1); checkPending(c,close); checkTrades(c,close); checkAlerts(c); }
```

- [ ] **Step 7: `closeTrade` per-id, `closeAllReplay`, `checkPending`, hapus `partialClose`**

`js/replay-intrabar.js` — ganti blok `partialClose` + `closeTrade` (baris 78-104) dengan:

```js
function closeTrade(id,exit,time){
  const i=trades.findIndex(t=>t.id===id); if(i<0) return;
  const t=trades[i];
  const mul=t.dir==='long'?1:-1;
  const r=(exit-t.entry)*mul/(t.risk||1e-9);
  const units=t.units||0;
  const pnlCcy=pnlUsd(t.dir,t.entry,exit,units);
  let bal=(+$('#balance').value||0)+pnlCcy;             // ledger: balance maju sesuai realized P&L
  $('#balance').value=bal.toFixed(2); localStorage.setItem('br_balance',bal.toFixed(2));
  journal.push({time:t.time,exitTime:time,dir:t.dir,entry:t.entry,exit,r,units,pnlCcy,balanceAfter:bal});
  trades.splice(i,1);
  saveJournal(); renderStats(); renderJournal(); updateOpenTradeBox(); renderAcct();
  try{ drawPaperLines(); }catch(e){}   // bersihkan garis/pill on-chart di semua jalur close
}
// Tutup semua posisi replay di harga pasar saat ini (cermin spCloseAll di Live).
function closeAllReplay(){
  const c=currentCandle(); if(!c) return;
  trades.slice().forEach(t=>closeTrade(t.id,c.close,c.timestamp));
}
```

`checkPending` (baris 67-77) jadi:

```js
function checkPending(c, close){
  if(!pending || trades.length) return;                          // guard 1-posisi masih berlaku; dilepas di Task 3
  if(pending.fillFrom!=null && c.timestamp < pending.fillFrom) return;   // jangan isi dari bar SEBELUM pending dibuat (re-tread Prev)
  if(!(c.low<=pending.entry && pending.entry<=c.high)) return;   // belum tersentuh
  clearPendingLines();
  const no=++replaySeq;
  trades.push({id:-no,no,dir:pending.dir,entry:pending.entry,sl:pending.sl,tp:pending.tp,
    risk:pending.risk,units:pending.units,trail:pending.trail,instrument:inst,
    time:c.timestamp,fillFrom:c.timestamp});
  const entry=pending.entry; pending=null;
  drawPaperLines(); updateOpenTradeBox();
  toast('Pending executed @ '+fmt(entry),'success');
}
```

`placePending` (baris 39-40): ganti dua guard jadi satu (`trade` tak ada lagi):
```js
  if(trades.length){ setStatus('Close position first (one position at a time).',true); return; }
  if(pending){ setStatus("There's already a pending — cancel it first.",true); return; }
```
dan tambahkan `fillFrom:cur.timestamp` di objek `pending` (baris 49-51), berdampingan dengan `time:cur.timestamp`.

`evalFills` (baris 10 dan 30): ganti guard & pemanggilan:
```js
  if(trades.length || pending || (alerts&&alerts.length)){
```
```js
    for(const b of subs){ checkPending(b,b.timestamp); checkTrades(b,b.timestamp); checkAlerts(b); }
```

- [ ] **Step 8: Tabel, broker, akun, draft — ikut `trades`**

`js/trades-panel.js`:
- Baris 15-16: `$('#tpNPos').textContent = trades.length;`
- Baris 29-42 (tab positions): ganti `if(!trade)` → `if(!trades.length)`, dan render **satu baris untuk `trades[0]`** (bentuk tabel diubah di Task 3):
  ```js
    if(!trades.length){ body.innerHTML=emptyRow(9,'No open positions','Pick an instrument in Markets, then Buy or Sell to open one.','☾'); return; }
    const t0=trades[0];
    const mkt=cur?cur.close:t0.entry;
    const pl=pnlUsd(t0.dir,t0.entry,mkt,t0.units||0);
    const margin=(t0.units||0)*t0.entry*quoteToUsd(t0.entry)/100;
    body.innerHTML=`<tr>
      <td><b>${sym}</b></td>
      <td class="${sideCls(t0.dir)}">${sideTxt(t0.dir)}</td>
      <td>${lotLabel(t0.units||0)}</td>
      <td>${fmt(t0.entry)} / ${fmt(mkt)}</td>
      <td>${fmt(t0.sl)}</td>
      <td>${fmt(t0.tp)}</td>
      <td>${usdFmt(margin)}</td>
      <td class="${pl>=0?'t-pos':'t-neg'}">${pl>=0?'+':''}${usdFmt(pl)}</td>
      <td class="t-act"><button data-act="close" data-id="${t0.id}">Close</button></td></tr>`;
  ```
- Baris 78-83 (handler baris): hapus cabang `partial`, pakai `data-id`:
  ```js
  // aksi per baris (Close / Cancel)
  $('#tpBody').addEventListener('click',e=>{ const b=e.target.closest('button[data-act]'); if(!b) return;
    const a=b.dataset.act;
    if(a==='close'){ const c=currentCandle(); if(c) closeTrade(+b.dataset.id, c.close, c.timestamp); }
    else if(a==='cancel') cancelPending();
  });
  ```
- Baris 89-94 (`resetTrade`): field garis lama sudah mati sejak parity on-chart → hapus:
  ```js
  function resetTrade(){
    clearPendingLines(); pending=null;
    trades=[]; replaySeq=0;
    try{ drawPaperLines(); }catch(e){}   // bersihkan garis/pill on-chart posisi replay
  }
  ```

`js/broker-paper.js` baris 5-10:
```js
const ReplayBroker = {
  mode:'replay',
  market(dir){ openTrade(dir); },
  closeMarket(){ if(trades.length) closeAllReplay(); if(pending) cancelPending(); },
  hasOpen(){ return trades.length>0; },
};
```
Baris 174 (`#closeAllBtn`): `try{ broker.closeMarket(); }catch(e){}` menggantikan dua blok `trade`/`pending`.

`js/stats-journal.js` baris 55 & 61 — jumlahkan semua posisi:
```js
  let openPnl=0; { const cur=currentCandle();
    if(cur) trades.forEach(t=>{ openPnl+=pnlUsd(t.dir,t.entry,cur.close,t.units||0); }); }
```
```js
  let margin=0; trades.forEach(t=>{ margin+=(t.units||0)*t.entry*quoteToUsd(t.entry)/100; });   // leverage 100
```
(Sesuaikan dengan bentuk baris aslinya; yang penting `trade` tunggal hilang.)

`js/sltp-draft.js` baris 38: `if(trade || pending || …)` → `if(trades.length || pending || T==null || (op && op.style.display==='none'))`.

`js/render.js` baris 72 (`refreshLotSuggestion`): `if(lotsManual||trade||!$('#riskOn').checked)` → `if(lotsManual||trades.length||!$('#riskOn').checked)`.

`js/sizing-pnl.js` baris 55 & 61 (`renderSizing`): `if(trade)` → `if(trades.length)` dan pakai `trades[0]` (dibereskan jadi selalu-preview di Task 7).

- [ ] **Step 9: Cari sisa referensi `trade` tunggal**

Run:
```bash
grep -rn "\btrade\b" js/*.js | grep -v "trades" | grep -v "^js/[a-z-]*\.js:[0-9]*: *//"
```
Expected: tak ada lagi pembacaan variabel `trade`; yang tersisa hanya kata "trade" di komentar/teks. Perbaiki bila ada.

- [ ] **Step 10: Jalankan test, pastikan LULUS**

Run:
```bash
npx playwright test tests/smoke --project=hermetic
```
Expected: seluruh smoke PASS, termasuk `replay-order.spec.js` (1 test) dan `module-hygiene.spec.js` (tak ada nama ganda / referensi eager baru).

- [ ] **Step 11: Commit**

```bash
git add js/ tests/smoke/replay-order.spec.js
git commit -m "$(cat <<'EOF'
refactor(replay): state trade tunggal jadi daftar trades[]

Persiapan multi-posisi: `trade` diganti `trades[]` berid negatif, sentinel
REPLAY_ID diganti isReplayId(id), dan semua call site (checkTrades,
closeTrade per-id, checkPending, tabel, broker, akun, draft) ikut. Perilaku
BELUM berubah — guard satu posisi masih berlaku. partialClose dihapus:
tombolnya sudah dicabut PR parity, jadi ia tak terjangkau dari UI.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Multi-posisi — lepas batas satu posisi

**Files:**
- Modify: `js/sizing-pnl.js` (`openTrade`), `js/replay-intrabar.js` (`checkPending`, `placePending`), `js/trades-panel.js` (`renderTrades` tab positions), `tests/smoke/replay-order.spec.js`

**Interfaces:**
- Consumes: `trades`, `replaySeq`, `closeTrade(id,exit,time)` dari Task 2
- Produces: tabel Positions replay dengan header 8 kolom identik Live dan satu baris per posisi

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `tests/smoke/replay-order.spec.js`:

```js
test('replay order: dua posisi hidup bersamaan, masing-masing bisa ditutup', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { lots: '0.10' });

  await page.click('#execBtn');
  await setTicket(page, { lots: '0.20' });
  await page.click('#execBtn');   // dulu ditolak diam-diam oleh guard 1-posisi

  expect(await posCount(page), 'posisi kedua tak terbuka').toBe(2);
  await expect(page.locator('#tpNPos')).toHaveText('2');
  await expect(page.locator('#tpBody tr')).toHaveCount(2);
  // dua pill P&L terpisah di chart
  await expect(page.locator('#posLayer .pos-node.entry .pos-pill')).toHaveCount(2);

  // Tutup baris pertama saja → sisa satu, dan yang tersisa adalah posisi 0.20 lot.
  const firstId = await page.evaluate(() => trades[0].id);
  await page.click(`#tpBody button[data-act="close"][data-id="${firstId}"]`);
  expect(await posCount(page)).toBe(1);
  expect(await page.evaluate(() => trades[0].units)).toBe(0.2 * 100000);

  assertNoPageErrors(page);
});

test('replay order: header tabel Positions sama dengan Live (8 kolom, SL / TP gabung)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  const head = page.locator('#tpHead th');
  await expect(head).toHaveCount(8);
  await expect(head.nth(4)).toHaveText('SL / TP');

  assertNoPageErrors(page);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/smoke/replay-order.spec.js --project=hermetic`
Expected: test kedua FAIL (`posCount` = 1, bukan 2); test ketiga FAIL (9 kolom, kolom ke-5 "Stop Loss").

- [ ] **Step 3: Lepas guard satu posisi**

`js/sizing-pnl.js` — baris pertama `openTrade`:
```js
  if(T==null) return;   // banyak posisi diizinkan (cermin Live: tiap order = posisi baru)
```

`js/replay-intrabar.js`:
- `checkPending`: `if(!pending || trades.length) return;` → `if(!pending) return;`
- `placePending`: hapus guard `if(trades.length){ … }` seluruhnya (pending boleh berdampingan dengan posisi terbuka, seperti Live yang tak memblokir order baru).

- [ ] **Step 4: Tabel Positions jadi N baris, header identik Live**

`js/trades-panel.js` — ganti seluruh cabang `activeTradeTab==='positions'`:

```js
  if(activeTradeTab==='positions'){
    // header identik Live (spRenderTrades): 8 kolom, SL & TP digabung satu sel
    head.innerHTML=thRow(['Instrument','Side','Size','Entry / Market','SL / TP','Margin','Profit & Loss','Actions']);
    if(!trades.length){ body.innerHTML=emptyRow(8,'No open positions','Pick an instrument in Markets, then Buy or Sell to open one.','☾'); return; }
    body.innerHTML=trades.map(t=>{
      const mkt=cur?cur.close:t.entry;
      const pl=pnlUsd(t.dir,t.entry,mkt,t.units||0);
      const margin=(t.units||0)*t.entry*quoteToUsd(t.entry)/100;
      return `<tr>
      <td><b>${sym}</b></td>
      <td class="${sideCls(t.dir)}">${sideTxt(t.dir)}</td>
      <td>${lotLabel(t.units||0)}</td>
      <td>${fmt(t.entry)} / ${fmt(mkt)}</td>
      <td><span class="t-neg">${t.sl!=null?fmt(t.sl):'—'}</span> / <span class="t-pos">${t.tp!=null?fmt(t.tp):'—'}</span></td>
      <td>${usdFmt(margin)}</td>
      <td class="${pl>=0?'t-pos':'t-neg'}">${pl>=0?'+':''}${usdFmt(pl)}</td>
      <td class="t-act"><button data-act="close" data-id="${t.id}">Close</button></td></tr>`;
    }).join('');
  } else if(activeTradeTab==='pending'){
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: seluruh smoke PASS (3 test di `replay-order.spec.js`).

- [ ] **Step 6: Commit**

```bash
git add js/ tests/smoke/replay-order.spec.js
git commit -m "$(cat <<'EOF'
feat(replay): banyak posisi terbuka seperti akun Live

Guard satu posisi dilepas dari openTrade, checkPending, dan placePending;
tabel Positions replay jadi satu baris per posisi dengan header identik
Live (8 kolom, SL / TP digabung) supaya tampilannya tak berganti bentuk
saat pindah mode.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Harga bid/ask — spread dibayar dua kali

**Files:**
- Modify: `js/sizing-pnl.js` (helper baru), `js/positions-onchart.js` (`replayPosView`, `checkTrades`), `js/replay-intrabar.js` (`closeTrade` pemanggil, `closeAllReplay`), `js/trades-panel.js` (kolom Market & P&L), `js/stats-journal.js` (`renderAcct`)
- Test: `tests/trading/replay-live-parity.spec.js` (dibuat di task ini)

**Interfaces:**
- Consumes: `trades`, `replayPosView`, `checkTrades` dari Task 2
- Produces:
  - `synthHalfSpread(): number` — setengah spread sintetis replay
  - `replayMarkPx(dir:'long'|'short', mid:number): number` — harga mark/exit

- [ ] **Step 1: Tulis test yang gagal**

Create `tests/trading/replay-live-parity.spec.js`:

```js
// Matriks parity order Bar Replay ↔ Live. Bukan bagian gerbang PR (smoke) — ia jalan di
// suite penuh saat push ke main. Yang diuji di sini adalah keputusan yang tak terlihat dari
// tampilan: spread dibayar dua kali, SL/TP divalidasi & dibulatkan, dan grace pasca-entry.
// Spec: docs/superpowers/specs/2026-07-29-replay-live-order-parity-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

async function enterReplay(page) {
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => typeof replayMode !== 'undefined' && replayMode === true);
}

async function setTicket(page, { lots = '0.10', slTicks = '100', tpTicks = '200', sl = true, tp = true } = {}) {
  await page.click('#op2Expand');
  await page.fill('#lotInput', lots);
  await page.fill('#slPips', slTicks);
  await page.fill('#tpPips', tpTicks);
  if (sl !== (await page.isChecked('#slOn'))) await page.click('#slCard');
  if (tp !== (await page.isChecked('#tpOn'))) await page.click('#tpCard');
}

test('spread dibayar dua kali: P&L tepat setelah buka = -(spread x units)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  const m = await page.evaluate(() => {
    const p = currentPositions()[0];
    const mid = currentCandle().close;
    return { pnl: p.unrealizedPl, entry: p.entry, price: p.price, mid, half: synthHalfSpread(), units: p.units, dir: p.dir };
  });

  // sell → masuk di bid (mid-½s), dinilai di ask (mid+½s) → jarak = satu spread penuh
  expect(m.dir).toBe('short');
  expect(m.entry).toBeCloseTo(m.mid - m.half, 10);
  expect(m.price).toBeCloseTo(m.mid + m.half, 10);
  expect(m.pnl, 'posisi baru harus minus sebesar spread').toBeLessThan(0);
  expect(Math.abs(m.pnl)).toBeCloseTo(2 * m.half * m.units, 6);

  assertNoPageErrors(page);
});

test('pemicu SL memakai bid untuk long (bukan low mid)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);

  // Posisi long dengan SL PERSIS di (low bar berikutnya − ½ spread): kena kalau pemicunya bid,
  // tak kena kalau pemicunya low mid. Dipasang langsung ke state supaya harga bisa dipatok tepat.
  const hit = await page.evaluate(() => {
    const arr = tfData[currentTF];
    let lo = 0, h = arr.length;
    while (lo < h) { const m = (lo + h) >> 1; if (barEndAt(currentTF, m, arr) <= T) lo = m + 1; else h = m; }
    const next = arr[lo];                       // bar yang akan diungkap oleh step(1)
    const half = synthHalfSpread();
    trades.length = 0;
    trades.push({ id: -99, no: 99, dir: 'long', entry: next.high + 10 * half, sl: next.low - half,
      tp: null, risk: 1, units: 1000, trail: 0, instrument: inst, time: T, fillFrom: T });
    return { sl: trades[0].sl, low: next.low, half };
  });
  expect(hit.sl).toBeCloseTo(hit.low - hit.half, 10);

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => trades.length === 0, null, { timeout: 5000 });

  const j = await page.evaluate(() => journal[journal.length - 1]);
  expect(j.exit, 'exit harus tepat di level SL').toBeCloseTo(hit.sl, 10);

  assertNoPageErrors(page);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic`
Expected: test pertama FAIL (`synthHalfSpread is not defined`).

- [ ] **Step 3: Tambah helper harga**

`js/sizing-pnl.js` — sisipkan setelah `pnlUsd` (baris 44):

```js
// Spread sintetis Bar Replay. Live memakai bid/ask sungguhan dari Hub; replay tak punya tick,
// jadi ia diturunkan dari candle dengan lebar yang SAMA seperti curBidAsk (js/render.js) —
// satu sumber angka supaya entry, valuasi, dan pemicu SL/TP tak pernah memakai spread berbeda.
function synthHalfSpread(){ return (+$('#pipSize').value||instSpec().pip)*1.6/2; }
// Harga mark/exit: long dinilai di bid, short di ask (cermin markPrice di paper.go).
// Akibatnya posisi baru langsung minus sebesar spread — sama seperti akun Live.
function replayMarkPx(dir, mid){ const h=synthHalfSpread(); return dir==='long' ? mid-h : mid+h; }
```

- [ ] **Step 4: Pakai helper di valuasi, close, dan pemicu SL/TP**

`js/positions-onchart.js` — `replayPosView`:
```js
function replayPosView(t){
  const cur=currentCandle(), mid=cur?cur.close:t.entry, price=replayMarkPx(t.dir,mid), units=t.units||0;
  return { id:t.id, no:t.no, src:'replay', instrument:t.instrument||inst,
    dir:t.dir, units, entry:t.entry, price, sl:t.sl, tp:t.tp,
    unrealizedPl: pnlUsd(t.dir,t.entry,price,units),
    margin: units*t.entry*quoteToUsd(t.entry)/100 };
}
```

`js/positions-onchart.js` — `checkTrades`, bagian pemicu & trailing:
```js
function checkTrades(c, close){
  if(!trades.length) return;
  const h=synthHalfSpread();
  trades.slice().forEach(t=>{
    if(t.fillFrom!=null && c.timestamp < t.fillFrom) return;
    // low/high candle adalah MID → seri bid = mid-½s, seri ask = mid+½s (cermin paper_monitor.go:
    // long dinilai di bid, short di ask). Harga exit = level SL/TP itu sendiri.
    let exit=null;
    if(t.dir==='long'){
      if(t.sl!=null && c.low-h<=t.sl) exit=t.sl;
      else if(t.tp!=null && c.high-h>=t.tp) exit=t.tp;
    } else {
      if(t.sl!=null && c.high+h>=t.sl) exit=t.sl;
      else if(t.tp!=null && c.low+h<=t.tp) exit=t.tp;
    }
    if(exit!==null){ closeTrade(t.id,exit,c.timestamp); return; }
    if(t.trail>0 && t.sl!=null){
      const ns = t.dir==='long' ? (c.high-h)-t.trail : (c.low+h)+t.trail;
      const better = t.dir==='long' ? ns>t.sl : ns<t.sl;
      if(better) t.sl=ns;
    }
  });
}
```

`js/replay-intrabar.js` — `closeAllReplay` pakai harga mark:
```js
function closeAllReplay(){
  const c=currentCandle(); if(!c) return;
  trades.slice().forEach(t=>closeTrade(t.id, replayMarkPx(t.dir,c.close), c.timestamp));
}
```

`js/positions-onchart.js` — `confirmClosePos` cabang replay:
```js
    miniConfirm('Close replay position?','Close',()=>{ const c=currentCandle();
      if(c) closeTrade(id, replayMarkPx(t.dir,c.close), c.timestamp); drawPaperLines(); },null,anchor); return; }
```

`js/trades-panel.js` — kolom Market & P&L tabel Positions:
```js
      const mkt=cur?replayMarkPx(t.dir,cur.close):t.entry;
```
dan handler Close per baris:
```js
    if(a==='close'){ const t=trades.find(x=>x.id===+b.dataset.id), c=currentCandle();
      if(t&&c) closeTrade(t.id, replayMarkPx(t.dir,c.close), c.timestamp); }
```

`js/stats-journal.js` — `renderAcct` open P&L:
```js
  let openPnl=0; { const cur=currentCandle();
    if(cur) trades.forEach(t=>{ openPnl+=pnlUsd(t.dir,t.entry,replayMarkPx(t.dir,cur.close),t.units||0); }); }
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run:
```bash
npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic
npx playwright test tests/smoke --project=hermetic
```
Expected: keduanya PASS.

- [ ] **Step 6: Commit**

```bash
git add js/ tests/trading/replay-live-parity.spec.js
git commit -m "$(cat <<'EOF'
feat(replay): valuasi & pemicu SL/TP pakai bid/ask, bukan mid

synthHalfSpread + replayMarkPx jadi sumber tunggal harga sintetis replay:
mark & exit di bid (long) / ask (short), dan pemicu SL/TP dihitung dari
seri bid/ask (low-½s, high+½s) — cermin markPrice & paper_monitor.go.
Konsekuensi yang disengaja: posisi baru langsung minus sebesar spread,
persis seperti akun Live.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pasang SL/TP — guard ticks, pembulatan, validasi, toast, validasi lot

**Files:**
- Modify: `js/sizing-pnl.js` (`validateSLTPReplay`, `openTrade`), `js/replay-intrabar.js` (`placePending`), `js/positions-onchart.js` (`savePosLevel`, `commitPosSLTP`), `tests/trading/replay-live-parity.spec.js`

**Interfaces:**
- Consumes: `synthHalfSpread` dari Task 4, `curBidAsk()` (`js/render.js`)
- Produces: `validateSLTPReplay(dir, sl, tp, bid, ask): string|null` — pesan error Inggris identik `sltpError` (Task 1), atau `null` bila valid

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `tests/trading/replay-live-parity.spec.js`:

```js
test('SL ON dengan ticks 0 → posisi terbuka TANPA SL (bukan SL di entry)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await page.click('#op2Expand');
  await page.fill('#lotInput', '0.10');
  if (!(await page.isChecked('#slOn'))) await page.click('#slCard');
  await page.fill('#slPips', '0');
  await page.click('#execBtn');

  const t = await page.evaluate(() => trades[0]);
  expect(t, 'posisi harus terbuka').toBeTruthy();
  expect(t.sl, 'SL tak boleh diletakkan di entry').toBeNull();
});

test('SL/TP dibulatkan ke desimal instrumen', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { slTicks: '37', tpTicks: '91' });
  await page.click('#execBtn');

  const r = await page.evaluate(() => {
    const t = trades[0], d = priceDecimals();
    return { sl: t.sl, tp: t.tp, slR: +t.sl.toFixed(d), tpR: +t.tp.toFixed(d) };
  });
  expect(r.sl).toBe(r.slR);
  expect(r.tp).toBe(r.tpR);
});

test('SL di dalam spread ditolak dengan pesan yang sama seperti Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { tp: false });

  // Arah default tiket = sell. Untuk sell, "di dalam spread" berarti SL <= ask.
  await page.evaluate(() => { window.__badSL = curBidAsk().ask - synthHalfSpread() / 2; });
  const msg = await page.evaluate(() =>
    validateSLTPReplay('short', window.__badSL, null, curBidAsk().bid, curBidAsk().ask)
  );
  expect(msg).toBe('Stop Loss is inside the spread — place it above the Ask price.');

  // Jalur nyata: ubah SL posisi terbuka ke dalam spread → toast error & nilai lama bertahan.
  await page.click('#execBtn');
  const before = await page.evaluate(() => trades[0].sl);
  await page.evaluate(() => savePosLevel(trades[0].id, 'sl', window.__badSL));
  await expect(page.locator('#toast')).toHaveClass(/\bt-error\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText(
    'Stop Loss is inside the spread — place it above the Ask price.'
  );
  expect(await page.evaluate(() => trades[0].sl), 'SL lama harus bertahan').toBeCloseTo(before, 10);
});

test('lot 0 ditolak dengan pesan yang sama seperti Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await page.click('#op2Expand');
  await page.fill('#lotInput', '0');
  await page.click('#execBtn');

  expect(await page.evaluate(() => trades.length)).toBe(0);
  // setStatus(msg, true) tak menulis ke elemen mana pun — ia memanggil toast(msg,'error')
  // (js/load-chart.js). Jadi yang diperiksa toast-nya, bukan bilah status.
  await expect(page.locator('#toast')).toHaveClass(/\bt-error\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText('Lot must be greater than 0.');
});

test('toast buka & tutup memakai format Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  await expect(page.locator('#toast')).toHaveClass(/\bt-success\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText(/^SELL 0\.10 lot .+ @ /);

  await page.click('#tpBody button[data-act="close"]');
  await expect(page.locator('#toast .toast-msg')).toHaveText(/^Closed #1 {2}[-+]\$/);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic`
Expected: lima test baru FAIL — `validateSLTPReplay is not defined`, `t.sl` = harga entry, tak ada toast.

- [ ] **Step 3: Tambah `validateSLTPReplay`**

`js/sizing-pnl.js` — setelah `replayMarkPx`:

```js
// Cermin sltpError (paper.go): tolak SL/TP yang sudah di dalam spread supaya posisi tak
// langsung stop-out. Short dinilai di ask, long di bid. Kalimatnya HARUS sama dengan versi
// Go — keduanya dipin test (paper_sltp_test.go & tests/trading/replay-live-parity.spec.js).
// Kembalikan pesan error, atau null bila valid / harga belum tersedia.
function validateSLTPReplay(dir, sl, tp, bid, ask){
  if(!(bid>0) || !(ask>0)) return null;
  if(dir==='short'){
    if(sl!=null && sl<=ask) return 'Stop Loss is inside the spread — place it above the Ask price.';
    if(tp!=null && tp>=ask) return 'Take Profit is inside the spread — place it below the Ask price.';
    return null;
  }
  if(sl!=null && sl>=bid) return 'Stop Loss is inside the spread — place it below the Bid price.';
  if(tp!=null && tp<=bid) return 'Take Profit is inside the spread — place it above the Bid price.';
  return null;
}
```

- [ ] **Step 4: `openTrade` — validasi lot, guard ticks, pembulatan, validasi, toast**

`js/sizing-pnl.js` — `openTrade` jadi:

```js
function openTrade(dir){
  if(T==null) return;   // banyak posisi diizinkan (cermin Live: tiap order = posisi baru)
  const cur=currentCandle(); if(!cur) return;
  const units=currentLots()*unitsPer();
  if(!(units>0)){ setStatus('Lot must be greater than 0.',true); return; }   // kalimat identik ServerPaperBroker
  const ba=curBidAsk();
  const entry = ba ? (dir==='short'?ba.bid:ba.ask) : cur.close;   // eksekusi di bid (sell) / ask (buy)
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal();
  const dist=slp*pip, dec=priceDecimals();
  // slp>0 wajib: tanpa guard ini SL/TP jatuh TEPAT di entry lalu kena instan (cermin ServerPaperBroker).
  let sl=null, tp=null;
  if(slp>0){
    if($('#slOn').checked) sl=+(dir==='long'?entry-dist:entry+dist).toFixed(dec);
    if($('#tpOn').checked) tp=+(dir==='long'?entry+dist*rr:entry-dist*rr).toFixed(dec);
  }
  const bad = ba ? validateSLTPReplay(dir,sl,tp,ba.bid,ba.ask) : null;
  if(bad){ toast(bad,'error'); return; }   // cermin 400 dari /api/order
  track('order',{dir,inst});
  const no=++replaySeq;
  trades.push({id:-no,no,dir,entry,sl,tp,risk:dist,units,
               trail: $('#trailOn').checked ? (+$('#trailPips').value||0)*pip : 0,
               instrument:inst, time:T, fillFrom:T});
  toast((dir==='long'?'BUY':'SELL')+' '+lotLabel(units)+' '+dispSym(inst)+' @ '+fmtFor(inst,entry),'success');
  clearDraftLines(); drawPaperLines(); updateOpenTradeBox(); renderAcct(); renderSizing();
}
```

- [ ] **Step 5: Toast saat close**

`js/replay-intrabar.js` — `closeTrade`, setelah `trades.splice(i,1)`:
```js
  toast('Closed #'+t.no+'  '+((pnlCcy>=0?'+':'')+usdFmt(pnlCcy)), pnlCcy>=0?'success':'info');   // format identik spClose
```

- [ ] **Step 6: Validasi di jalur ubah SL/TP posisi terbuka**

`js/positions-onchart.js` — `savePosLevel` cabang replay:
```js
  if(isReplayId(id)){ const t=tradeById(id); if(!t) return;
    const ba=curBidAsk();
    const bad = ba ? validateSLTPReplay(t.dir, kind==='sl'?+v:t.sl, kind==='tp'?+v:t.tp, ba.bid, ba.ask) : null;
    if(bad){ toast(bad,'error'); drawPaperLines(); return; }   // cermin 400 dari /api/position/sltp
    t[kind]=+v; if(kind==='sl') recalcRisk(t);
    toast(kind.toUpperCase()+' updated','success'); drawPaperLines(); updateOpenTradeBox(); return; }
```

`js/positions-onchart.js` — `commitPosSLTP` cabang replay:
```js
  if(isReplayId(editPos.id)){ const t=tradeById(editPos.id); if(!t){ closePositionEditor(); return; }
    const nsl=editPos.slOn?+editPos.sl:null, ntp=editPos.tpOn?+editPos.tp:null;
    const ba=curBidAsk();
    const bad = ba ? validateSLTPReplay(t.dir,nsl,ntp,ba.bid,ba.ask) : null;
    if(bad){ toast(bad,'error'); return; }
    t.sl=nsl; t.tp=ntp; recalcRisk(t);
    toast('SL/TP updated','success'); closePositionEditor(); drawPaperLines(); updateOpenTradeBox(); return; }
```

- [ ] **Step 7: `placePending` — guard ticks, pembulatan, validasi terhadap harga entry pending**

`js/replay-intrabar.js` — `placePending`, ganti perhitungan SL/TP:
```js
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal();
  const dist=slp*pip, dec=priceDecimals();
  let sl=null, tp=null;
  if(slp>0){
    if($('#slOn').checked) sl=+(dir==='long'?entry-dist:entry+dist).toFixed(dec);
    if($('#tpOn').checked) tp=+(dir==='long'?entry+dist*rr:entry-dist*rr).toFixed(dec);
  }
  // Acuan validasi pending = harga ENTRY pending-nya sendiri, bukan harga pasar: SL/TP harus
  // di sisi yang benar relatif entry. (Live tak punya pending, jadi tak ada cermin langsung.)
  const bad=validateSLTPReplay(dir,sl,tp,entry,entry);
  if(bad){ toast(bad,'error'); return; }
```

- [ ] **Step 8: Jalankan test, pastikan LULUS**

Run:
```bash
npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic
npx playwright test tests/smoke --project=hermetic
```
Expected: keduanya PASS.

- [ ] **Step 9: Commit**

```bash
git add js/ tests/trading/replay-live-parity.spec.js
git commit -m "$(cat <<'EOF'
feat(replay): SL/TP diguard, dibulatkan, & divalidasi seperti Live

validateSLTPReplay mencermin sltpError (paper.go) dengan kalimat identik,
dipakai di tiga jalur replay: openTrade, placePending, dan ubah SL/TP
posisi terbuka. Guard slp>0 menghentikan SL/TP jatuh tepat di entry
(stop-out instan), harga dibulatkan ke desimal instrumen, lot 0 ditolak,
dan toast buka/tutup memakai format yang sama dengan akun Live.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Grace pasca-entry — `fillFrom` + waktu tutup sub-bar

**Files:**
- Modify: `js/replay-intrabar.js` (`evalFills`, `checkPending`), `js/positions-onchart.js` (`checkTrades`, `onNewBar`), `tests/trading/replay-live-parity.spec.js`

**Interfaces:**
- Consumes: `trades[].fillFrom`, `checkTrades(c, close)`, `checkPending(c, close)` dari Task 2
- Produces: `evalFills` meneruskan waktu **tutup** setiap sub-bar; guard grace `close <= fillFrom → skip`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `tests/trading/replay-live-parity.spec.js`:

```js
test('grace: Prev lalu Next tak mengeksekusi SL dari harga PRA-entry', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);

  // Pasang posisi long ber-SL di bawah low bar TERAKHIR yang sudah terungkap. Bar itu sudah
  // lewat sebelum entry, jadi SL tak boleh kena. Tanpa grace, Prev menurunkan frontier fillT
  // dan Next mengevaluasi ulang bar itu → stop-out palsu.
  await page.evaluate(() => {
    const c = currentCandle(), half = synthHalfSpread();
    trades.length = 0;
    trades.push({ id: -50, no: 50, dir: 'long', entry: c.close, sl: c.low - half - 5 * pipOf(inst),
      tp: null, risk: 1, units: 1000, trail: 0, instrument: inst, time: T, fillFrom: T });
  });

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => trades.length), 'posisi ter-stop-out oleh harga pra-entry').toBe(1);
  expect(await page.evaluate(() => journal.length)).toBe(0);

  assertNoPageErrors(page);
});

test('grace: pending yang terisi tak langsung ter-stop-out di sub-bar pengisinya', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);

  // Pending limit di dalam rentang bar berikutnya, dengan SL yang JUGA di dalam rentang bar itu.
  // Fill dan SL berada di sub-bar yang sama → dengan grace, SL baru dievaluasi sub-bar berikutnya.
  const setup = await page.evaluate(() => {
    const arr = tfData[currentTF];
    let lo = 0, h = arr.length;
    while (lo < h) { const m = (lo + h) >> 1; if (barEndAt(currentTF, m, arr) <= T) lo = m + 1; else h = m; }
    const next = arr[lo];
    trades.length = 0;
    pending = { dir: 'long', type: 'limit', entry: (next.high + next.low) / 2, sl: next.low - synthHalfSpread(),
      tp: null, risk: 1, units: 1000, trail: 0, time: T, fillFrom: T, lineEntry: null, lineSL: null, lineTP: null };
    return { entry: pending.entry };
  });
  expect(setup.entry).toBeGreaterThan(0);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => trades.length), 'pending harus terisi').toBe(1);
  expect(await page.evaluate(() => journal.length), 'tak boleh langsung tertutup di sub-bar yang sama').toBe(0);

  assertNoPageErrors(page);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic -g grace`
Expected: FAIL — posisi tertutup (guard sekarang membandingkan `c.timestamp` dengan `fillFrom`, sedangkan sub-bar di bar entry punya `timestamp >= fillFrom`).

- [ ] **Step 3: `evalFills` membawa waktu tutup tiap sub-bar**

`js/replay-intrabar.js` — ganti isi `evalFills` (baris 6-33):

```js
async function evalFills(toT){
  if(!replayMode || fillT==null){ fillT=toT; return; }   // masuk replay → set frontier tanpa fire
  if(toT<=fillT) return;                                   // mundur/diam → jangan re-fire
  const from=fillT;
  if(trades.length || pending || (alerts&&alerts.length)){
    let subs=null;
    const fineTF=pickFineTF(currentTF, DUR[currentTF]), arr=tfData[currentTF];
    if(fineTF && arr && arr.length){
      const fdur=DUR[fineTF], acc=[];
      let lo=0,h=arr.length; while(lo<h){const m=(lo+h)>>1; if(arr[m].timestamp<=toT) lo=m+1; else h=m;}
      for(let i=lo-1;i>=0;i--){                            // bar kasar beririsan (from,toT] — telusuri mundur
        const bOpen=arr[i].timestamp, bEnd=barEndAt(currentTF,i,arr);
        if(bEnd<=from) break;                               // sudah sepenuhnya sebelum frontier → stop
        const win=await ensureFineWindow(fineTF,bOpen,bEnd);
        if(win && win.length){ for(const b of win){ const c=b.timestamp+fdur; if(c>from && c<=toT) acc.push({b,close:c}); } }
        else if(bEnd>from && bEnd<=toT) acc.push({b:arr[i],close:bEnd});   // fetch sub-bar gagal → fallback bar kasar (tutup penuh ≤ toT, tanpa lookahead) drpd drop diam-diam
      }
      acc.sort((x,y)=>x.b.timestamp-y.b.timestamp); subs=acc;
    }
    if(subs==null){                                         // fallback: bar currentTF sendiri (≤M5 / fetch gagal)
      subs=[];
      const src=arr||[];
      for(let i=0;i<src.length;i++){ const c=barEndAt(currentTF,i,src); if(c>from && c<=toT) subs.push({b:src[i],close:c}); }
    }
    // Waktu TUTUP sub-bar diteruskan: itu satuan yang dipakai guard grace (fillFrom). Memakai
    // timestamp BUKA seperti dulu membuat sub-bar yang MEMUAT momen entry ikut dievaluasi —
    // itu sumber stop-out palsu setelah Prev→Next.
    for(const s of subs){ checkPending(s.b,s.close); checkTrades(s.b,s.close); checkAlerts(s.b); }
  }
  if(toT>fillT) fillT=toT;                                  // frontier hanya-maju (anti dobel-fire saat konkuren)
}
```

- [ ] **Step 4: Guard grace di `checkTrades` & `checkPending`**

`js/positions-onchart.js` — `checkTrades`, ganti baris guard:
```js
    // Grace pasca-entry (padanan grace 2 detik di paper_monitor.go): sub-bar yang tutup pada atau
    // sebelum momen entry tak boleh mengeksekusi SL/TP — harga yang sudah terjadi sebelum tombol
    // Buy ditekan bukan milik posisi ini.
    if(t.fillFrom!=null && close!=null && close<=t.fillFrom) return;
```

`js/replay-intrabar.js` — `checkPending`, ganti baris guard dan `fillFrom` posisi hasil fill:
```js
function checkPending(c, close){
  if(!pending) return;
  if(pending.fillFrom!=null && close!=null && close<=pending.fillFrom) return;   // jangan isi dari sub-bar sebelum pending dibuat (re-tread Prev)
  if(!(c.low<=pending.entry && pending.entry<=c.high)) return;   // belum tersentuh
  clearPendingLines();
  const at = close!=null?close:c.timestamp;
  const no=++replaySeq;
  trades.push({id:-no,no,dir:pending.dir,entry:pending.entry,sl:pending.sl,tp:pending.tp,
    risk:pending.risk,units:pending.units,trail:pending.trail,instrument:inst,
    time:at, fillFrom:at});   // fillFrom = tutup sub-bar pengisi → SL/TP dievaluasi mulai sub-bar berikutnya
  const entry=pending.entry; pending=null;
  drawPaperLines(); updateOpenTradeBox();
  toast('Pending executed @ '+fmt(entry),'success');
}
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run:
```bash
npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic
npx playwright test tests/smoke --project=hermetic
```
Expected: keduanya PASS.

- [ ] **Step 6: Commit**

```bash
git add js/ tests/trading/replay-live-parity.spec.js
git commit -m "$(cat <<'EOF'
fix(replay): grace pasca-entry lewat fillFrom & waktu tutup sub-bar

evalFills kini meneruskan waktu TUTUP tiap sub-bar, dan guard grace
membandingkannya dengan fillFrom posisi. Guard lama memakai timestamp buka
bar, sehingga setelah Prev lalu Next sub-bar di bar entry yang terjadi
sebelum tombol Buy ditekan ikut mengeksekusi SL. Pending yang terisi juga
mendapat fillFrom = tutup sub-bar pengisi, jadi SL/TP-nya baru dievaluasi
mulai sub-bar berikutnya — padanan grace 2 detik di paper_monitor.go.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Tiket order — draft SL/TP, sizing preview, saran lot, teks Inggris

**Files:**
- Modify: `js/sltp-draft.js:34-38`, `js/sizing-pnl.js` (`renderSizing`), `js/render.js:72`, `js/stats-journal.js:36`, `js/broker-paper.js:141`, `tests/trading/replay-live-parity.spec.js`

**Interfaces:**
- Consumes: `trades` dari Task 2
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `tests/trading/replay-live-parity.spec.js`:

```js
test('draft SL/TP tetap tampil saat sudah ada posisi (spt Live)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  // Sentuh tiket supaya renderOrderPanel → drawDraftLines berjalan setelah posisi terbuka.
  await page.fill('#slPips', '120');
  await expect(page.locator('#posLayer .pos-node.draft.sl')).toHaveCount(1);
  await expect(page.locator('#posLayer .pos-node.draft.tp')).toHaveCount(1);

  assertNoPageErrors(page);
});

test('sizing box selalu preview tiket, bukan angka posisi terbuka', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { lots: '0.10' });
  await page.click('#execBtn');

  await page.fill('#lotInput', '0.50');
  // Ukuran di sizing box mengikuti tiket (0.50), bukan posisi yang terbuka (0.10).
  await expect(page.locator('#sizingBox')).toContainText('0.50 lot');

  assertNoPageErrors(page);
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/trading/replay-live-parity.spec.js --project=hermetic -g "draft SL/TP tetap|sizing box"`
Expected: FAIL — chip draft berjumlah 0; sizing box menampilkan `0.10 lot`.

- [ ] **Step 3: Hapus guard posisi di `drawDraftLines`**

`js/sltp-draft.js` baris 35-38:
```js
  // preview SL/TP saat panel order terbuka & menyiapkan order — termasuk saat sudah ada posisi
  // terbuka (tambah posisi baru), sama seperti Live. Sembunyikan hanya saat panel tertutup atau
  // data belum ada.
  const op=$('#orderpanel');
  if(T==null || (op && op.style.display==='none')){ clearDraftLines(); return; }
```

- [ ] **Step 4: `renderSizing` selalu preview dari tiket**

`js/sizing-pnl.js` baris 51-72 — buang cabang posisi terbuka:
```js
// readout ukuran posisi: SELALU preview dari input tiket (sama seperti Live, yang tak pernah
// membaca posisi terbuka di sini) — posisi yang sudah jalan punya pill P&L-nya sendiri di chart.
function renderSizing(){
  const box=$('#sizingBox'); if(!box) return;
  const bal=+$('#balance').value||0, rp=+$('#riskPct').value||0;
  const cur=currentCandle(); if(!cur){ box.innerHTML=''; return; }
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value, rrp=rrVal();
  const dir=orderDir, ba=curBidAsk();
  const entry = ba ? (dir==='short'?ba.bid:ba.ask) : cur.close;
  const sl = dir==='long' ? entry-slp*pip : entry+slp*pip;
  const tp = dir==='long' ? entry+slp*pip*rrp : entry-slp*pip*rrp;
  const units = currentLots()*unitsPer();   // sizing berbasis lot
  const riskUsd=Math.abs(pnlUsd(dir,entry,sl,units));
  const rewUsd=Math.abs(pnlUsd(dir,entry,tp,units));
  const rr = Math.abs(entry-sl)>0 ? Math.abs(tp-entry)/Math.abs(entry-sl) : 0;
  const pctRisk = bal? riskUsd/bal*100 : 0;
  box.innerHTML =
    `<span>Size: <b>${lotLabel(units)}</b> · ${Math.round(units).toLocaleString('en-US')} u</span>`+
    `<span>Risk: <b class="neg">$${riskUsd.toFixed(2)}</b> (${pctRisk.toFixed(2)}%)</span>`+
    `<span>Reward: <b class="pos">$${rewUsd.toFixed(2)}</b></span>`+
    `<span>R:R <b>1:${rr.toFixed(2)}</b></span>`;
}
```
Catatan: `rp` tak lagi dipakai untuk output — hapus variabelnya kalau linter mengeluh, tapi `bal` tetap dipakai.

- [ ] **Step 5: Saran lot terus berjalan + teks Inggris**

`js/render.js:72`:
```js
function refreshLotSuggestion(){ if(lotsManual||!$('#riskOn').checked) return; const s=suggestLotsFromRisk(); if(s!=null) setLots(s); }
```

`js/stats-journal.js:36` dan `js/broker-paper.js:141` — teks kanvas equity curve jadi Inggris:
```js
'No closed trades yet.'
```
(Di `stats-journal.js` varian mode $: `'No closed trades yet ($ mode).'`)

- [ ] **Step 6: Jalankan test, pastikan LULUS**

Run:
```bash
npx playwright test tests/trading tests/smoke --project=hermetic
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/ tests/trading/replay-live-parity.spec.js
git commit -m "$(cat <<'EOF'
feat(replay): tiket order berperilaku sama saat posisi sudah terbuka

Garis draft SL/TP tak lagi disembunyikan oleh posisi/pending, sizing box
selalu menampilkan preview tiket (bukan angka posisi terbuka), dan saran
lot dari Risk% terus berjalan — ketiganya perilaku Live. Teks kanvas
equity curve ikut diinggriskan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verifikasi menyeluruh & dokumentasi

**Files:**
- Modify: `tests/README.md` (daftar susunan folder), `CLAUDE.md` (bila perlu), `docs/superpowers/specs/2026-07-29-replay-live-order-parity-design.md` (tandai selesai)

**Interfaces:**
- Consumes: seluruh hasil Task 1-7
- Produces: PR siap review

- [ ] **Step 1: Jalankan suite penuh sekali secara lokal**

Ini satu-satunya titik di plan ini yang menjalankan suite penuh — refactor state inti replay menyentuh banyak jalur, jadi sekali putaran penuh sebelum PR lebih murah daripada menemukannya di CI setelah merge.

Run:
```bash
go test ./...
npx playwright test --project=hermetic
```
Expected: keduanya hijau. Baseline sebelum perubahan = 228 test hijau (lihat memori `e2e-ui-suite`) + suite Go hijau; sekarang harus 228 + test baru.

- [ ] **Step 2: Catat folder test baru di `tests/README.md`**

Di blok "Susunan", tambahkan setelah baris `chart/`:
```
  trading/                semantik order & posisi (parity replay↔Live) — bukan drawing
```

- [ ] **Step 3: Verifikasi manual di browser**

```bash
PORT=8765 ./luna-trade
```
Buka `http://localhost:8765`, login akun test, lalu periksa:
1. Bar Replay: buka 3 posisi dengan SL/TP berbeda → tiga pill P&L, tiga pasang garis, tiga baris tabel.
2. Geser garis SL satu posisi → mini-confirm → tersimpan; geser ke dalam spread → toast error, garis balik.
3. Prev lalu Next beberapa kali → tak ada posisi tertutup tanpa sebab.
4. Play sampai SL/TP kena → toast `Closed #n`, jurnal & balance bergerak.
5. Close All → semua posisi tertutup, pending dibatalkan.
6. Keluar replay → mode Live: buka posisi, ubah SL/TP, tutup → tetap lewat `/api/*`, tak ada perubahan perilaku.
7. Konsol bersih.

- [ ] **Step 4: Commit & buka PR**

```bash
git add tests/README.md
git commit -m "$(cat <<'EOF'
docs(tests): catat folder tests/trading di susunan README

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin zihar/zihar/feat/replay-live-order-parity
gh pr create --base main --title "feat(replay): samakan semantik order Bar Replay dengan Live" --body "$(cat <<'EOF'
## Ringkasan

Order di Bar Replay kini berperilaku sama dengan akun Live: banyak posisi,
spread dibayar dua kali, SL/TP diguard & divalidasi identik, grace pasca-entry,
dan toast yang sama.

Spec: `docs/superpowers/specs/2026-07-29-replay-live-order-parity-design.md`
Plan: `docs/superpowers/plans/2026-07-29-replay-live-order-parity.md`

## Yang berubah

- `trade` tunggal → `trades[]` berid negatif; sentinel `REPLAY_ID` → `isReplayId(id)`
- Valuasi, close, dan pemicu SL/TP replay pakai bid/ask sintetis (`synthHalfSpread`, `replayMarkPx`)
- `validateSLTPReplay` mencermin `sltpError` (`paper.go`) dengan kalimat identik, dipakai di tiga jalur
- Guard `slPips > 0`, pembulatan `priceDecimals()`, validasi lot, toast buka/tutup
- Grace pasca-entry via `fillFrom` + waktu tutup sub-bar dari `evalFills`
- Pesan error server yang sampai ke pengguna diinggriskan
- `partialClose` dihapus (tak terjangkau dari UI sejak PR parity)

## Verifikasi

- `go test ./...` hijau
- `npx playwright test --project=hermetic` hijau (termasuk `tests/smoke/replay-order.spec.js` & `tests/trading/replay-live-parity.spec.js`)
- Manual di browser: 3 posisi replay, drag SL/TP, Prev/Next, Play sampai SL kena, Close All, lalu regresi mode Live

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Merge lewat skrip repo**

Setelah CI hijau:
```bash
scripts/merge-pr.sh <nomor-PR>
```
Jangan `gh pr merge` langsung. Ingat: merge ke `main` **tidak** merilis ke pengguna — go-live manual lewat Actions → Release.

---

## Self-review

**Cakupan spec → task:**

| Bagian spec | Task |
|---|---|
| §1 state `trades[]`, `isReplayId`, hapus field mati & `partialClose` | 2 |
| §1 multi-posisi (lepas guard), tabel N baris & header Live | 3 |
| §2 spread dua kali (mark, close, pemicu SL/TP) | 4 |
| §3a guard ticks>0 | 5 |
| §3b pembulatan | 5 |
| §3c validasi spread/sisi (3 jalur) | 5 |
| §3d grace `fillFrom` + tutup sub-bar | 6 |
| §3e validasi lot | 5 |
| §3f toast buka/tutup | 5 |
| §4 `#tpNPos`, Close All, editor, `renderAcct` agregat | 2 (Close All, `renderAcct`), 3 (`#tpNPos`, tabel), 5 (editor + validasi) |
| §4 teks Indonesia di berkas tersentuh | 7 |
| §5 pesan server Inggris | 1 |
| Rencana verifikasi | 2, 3 (smoke), 4-7 (matriks), 8 (suite penuh + manual) |

Tak ada bagian spec tanpa task.

**Konsistensi nama antar-task:** `trades`, `replaySeq`, `isReplayId`, `tradeById`, `replayPosView`, `closeTrade(id,exit,time)`, `closeAllReplay`, `checkTrades(c,close)`, `checkPending(c,close)`, `synthHalfSpread`, `replayMarkPx(dir,mid)`, `validateSLTPReplay(dir,sl,tp,bid,ask)`, `sltpError(dir,sl,tp,bid,ask)`, `recalcRisk(t)` — dipakai dengan tanda tangan yang sama di semua task.

**Catatan risiko yang harus diperhatikan pelaksana:**

1. `page.fill` gagal pada input tersembunyi. `#balance`, `#pipSize`, `#trailOn`, `#trailPips` hidup di `.op-hidden` → ubah lewat `page.evaluate`, bukan `fill`. `#slPips`/`#tpPips`/`#slOn`/`#tpOn`/`#execBtn` butuh `#op2Expand` diklik dulu.
2. `#lotInput` **berpindah induk** antar mode tiket (`#dealStepSlot` ↔ `#oneStepSlot` ↔ `#expStepSlot`) — satu node DOM, jadi selektor `#lotInput` tetap sah, tapi jangan cache `ElementHandle` melewati `renderOrderPanel`.
3. `module-hygiene.spec.js` akan merah kalau ada nama global ganda atau identifier lintas-file dipakai di top-level. Semua helper baru adalah `function` declaration di `sizing-pnl.js` dan hanya dipanggil dari dalam fungsi lain → aman.
4. **`setStatus` bukan bilah status.** `setStatus(t, err)` (`js/load-chart.js:119`) *diam* kalau `err` falsy, dan kalau truthy ia memanggil `toast(t,'error')` — tak ada elemen `#status` di `index.html`. Assertion untuk pesan penolakan harus menargetkan `#toast .toast-msg`.
5. Fixture `/api/order` di `tests/fixtures/api.js` membaca `body.dir`, padahal frontend mengirim `side`. Ini sudah begitu sebelum plan ini dan tak menghalangi test replay (replay tak menyentuh `/api`), tapi jangan bangun assertion Live baru di atasnya tanpa memperbaiki fixture-nya lebih dulu.
