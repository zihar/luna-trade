# Long/Short Position — tab Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Inputs ala TradingView untuk Long/Short Position (Account, Lot, Risk %/USD, Entry, Profit/Stop Ticks↔Price, Qty precision) + label Qty/P&L di chart.

**Architecture:** Modul baru `js/draw-position-inputs.js` berisi setelan per objek (disimpan di `objStyle[id]`) dan hitungan murni (`posCalc`, `posPillTexts`). `js/draw-style-modal.js` merender & mengabeli tab Inputs; `js/overlays-custom.js` (`posFigures`) hanya mengambil teks pill dari `posPillTexts`.

**Tech Stack:** vanilla JS + klinecharts 9.8.10, Playwright (`--project=hermetic`).

**Spec:** `docs/superpowers/specs/2026-11-24-position-tool-inputs-design.md`

## Global Constraints

- Teks UI bahasa Inggris; komentar/commit boleh Indonesian. Commit conventional + trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Setelan per objek di `objStyle[id]` lewat `setObjStyle` (ikut persist, sync, copy/paste, clone — `js/draw-clone.js:31` sudah menyalin `objStyle`).
- Field angka `type="text" inputmode="decimal"` + `parseCoordNum` (jebakan locale, `js/draw-coords.js`); `onkeydown` stopPropagation kecuali Escape (hotkey chart).
- Level yang menyeberangi Entry DITOLAK (class `bad`, nilai kembali), tidak di-clamp.
- Tick size: `XAU` → 0.01, lainnya `10^-priceDecimals()` (sama dengan `posFigures` sekarang).
- Matematika uang: `quoteToUsd` dari `js/sizing-pnl.js`. Akun USD saja.
- Key internal tab tetap `'levels'` (dipanggil `openObjSettings(o,x,y,'levels')` oleh tes & kode lain); labelnya jadi "Inputs". ID `#ppTp`/`#ppSl` tetap = field Price.

## Review Focus

1. Account / Risk kosong, 0, negatif, atau bukan angka → field `bad`, setelan tak berubah, Qty tak jadi `NaN`/`Infinity`.
2. Ticks diketik pecahan / 0 / negatif → ditolak (`bad`); ticks harus bilangan bulat ≥ 1.
3. Ganti satuan Risk %↔USD → nominal risiko (USD) tetap sama, bukan angkanya.
4. Entry digeser hingga level jadi ≤ 0 → ditolak, objek tak bergerak.
5. Lot size default berbeda per instrumen; default "terakhir dipakai" untuk Lot disimpan per instrumen (XAU tak mewarisi 100000 dari EUR_USD).

---

### Task 1: Setelan & hitungan posisi (`js/draw-position-inputs.js`)

**Files:**
- Create: `js/draw-position-inputs.js`
- Modify: `index.html` — tambah `<script src="/js/draw-position-inputs.js"></script>` tepat sesudah `/js/draw-position-tool.js` (baris ~460)
- Test: `tests/smoke/position-inputs.spec.js` (baru)

**Interfaces:**
- Consumes: `objStyle`, `setObjStyle`, `dstyle` (draw-style.js); `quoteToUsd`, `INSTRUMENT` (sizing-pnl.js); `posLevels`, `applyPosLevel` (draw-position-tool.js); `priceDecimals`, `inst`, `$`.
- Produces:
  - `posTickSize(): number`
  - `posDefaultLot(instName?: string): number` — XAU/XAG → 100; kedua sisi `_` ∈ {USD,EUR,GBP,JPY,CHF,CAD,AUD,NZD} → 100000; lainnya 1.
  - `posSettings(o): {account:number, lot:number, risk:number, riskUnit:'%'|'USD', qtyPrec:number}` — urutan prioritas: field `objStyle` (`posAccount,posLot,posRisk,posRiskUnit,posQtyPrec`) → localStorage `luna_pos_defaults` → `#balance`, `posDefaultLot()`, `#riskPct`, `'%'`, `2`.
  - `setPosSettings(o, patch: Partial<settings>): boolean` — validasi (account>0, lot>0, risk>0, riskUnit ∈ {'%','USD'}, qtyPrec bulat 0–8); tolak → `false` tanpa menulis. Sukses → `setObjStyle` + simpan ke `luna_pos_defaults` (`lot` disimpan di `lot[inst]`).
  - `posRiskUsd(s): number` — `riskUnit==='%' ? account*risk/100 : risk`.
  - `convertRisk(value, from, to, account): number`.
  - `posCalc(o): null | {entry,tp,sl,tpTicks,slTicks,riskUsd,qtyUnits,qtyLots,pnlTp,pnlSl,rr}` — `qtyUnits = riskUsd / (|entry-sl|·quoteToUsd(entry))`, `qtyLots = qtyUnits/lot`, `pnlTp = qtyUnits·|tp-entry|·quoteToUsd(tp)`, `pnlSl = -qtyUnits·|entry-sl|·quoteToUsd(sl)`; ticks dibulatkan `Math.round`.
  - `applyPosEntry(o, v): boolean` — geser keenam titik sebesar `v-entry`; tolak bila `!isFinite(v)`, `v<=0`, atau TP/SL baru ≤ 0.
  - `applyPosTicks(o, which:'tp'|'sl', n): boolean` — `n` bulat ≥1, harga = entry ± n·tick menurut sisi (long: TP atas, SL bawah; short sebaliknya), lalu `applyPosLevel`.

- [ ] **Step 1: Tulis tes yang gagal** di `tests/smoke/position-inputs.spec.js` (pola `gotoApp`, `drawTool`, `overlays`, `assertNoPageErrors` seperti `tests/smoke/position-sltp-input.spec.js`; instrumen fixture = EUR_USD):

```js
test('posCalc: qty dari risk 1% akun 10000', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'longPosition');
  const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
    setPosSettings(o, { account: 10000, risk: 1, riskUnit: '%', lot: 100000 }); return posCalc(o); }, obj.id);
  expect(r.riskUsd).toBeCloseTo(100, 6);
  expect(r.qtyUnits).toBeCloseTo(100 / Math.abs(r.entry - r.sl), 3);
  expect(r.qtyLots).toBeCloseTo(r.qtyUnits / 100000, 9);
  expect(r.pnlSl).toBeCloseTo(-100, 4);
  expect(r.rr).toBeCloseTo(Math.abs(r.tp - r.entry) / Math.abs(r.entry - r.sl), 6);
});
test('setPosSettings menolak account/risk ≤0 & NaN', ...)          // false, posSettings tak berubah
test('convertRisk: 1% dari 10000 = 100 USD dan balik', ...)          // 100 & 1
test('applyPosEntry menggeser TP/SL dengan jarak tetap', ...)        // selisih tp-entry & entry-sl sama (toBeCloseTo 6)
test('applyPosEntry menolak hasil level ≤ 0', ...)                    // false, points tak berubah
test('applyPosTicks: 50 tick TP long = entry + 50·tick; 0/1.5/-3 ditolak', ...)  // long & short
test('default terakhir dipakai: posisi baru mewarisi account', ...)  // set 5000 → gambar posisi ke-2 → posSettings(o2).account===5000
test('posDefaultLot: EUR_USD 100000, XAU_USD 100, BTC_USD 1, SPX500_USD 1', ...)
```

- [ ] **Step 2:** `npx playwright test tests/smoke/position-inputs.spec.js --project=hermetic` → FAIL (`posCalc is not defined`).
- [ ] **Step 3:** Implementasikan fungsi-fungsi di Interfaces dalam `js/draw-position-inputs.js` + tag script di `index.html`. Jangan ada referensi eager ke nama dari file yang dimuat sesudahnya (module-hygiene).
- [ ] **Step 4:** `npx playwright test tests/smoke/position-inputs.spec.js tests/smoke/module-hygiene.spec.js --project=hermetic` → semua PASS.
- [ ] **Step 5:** Commit `feat(position): setelan akun/risiko per objek + posCalc`.

### Task 2: Tab Inputs di modal

**Files:**
- Modify: `js/draw-style-modal.js:52-87` (`posLevelsPaneHTML`, `wirePosPanes`) dan `:94` (label `'Levels'` → `'Inputs'`)
- Modify: CSS modal (file css yang memuat `.dm-co-row`) bila perlu baris dua kolom
- Test: `tests/smoke/position-inputs.spec.js`, `tests/smoke/position-sltp-input.spec.js` (tetap hijau)

**Interfaces:**
- Consumes: semua fungsi Task 1.
- Produces (ID field, dipakai tes): `#ppAcc`, `#ppLot`, `#ppRisk` + `#ppRiskUnit` (select `%`/`USD`), `#ppEntry`, `#ppTpTicks` + `#ppTp`, `#ppSlTicks` + `#ppSl`, `#ppQtyPrec`, dan baris readout `#ppQty` (teks `Qty <angka dengan qtyPrec desimal> lot`).

Urutan & label: `Account size`, `Lot size`, `Risk`, `Entry price`, `Profit level` (Ticks | Price), `Stop level` (Ticks | Price), `Qty precision`. Commit pada Enter/blur (pola `commit` yang ada); sukses → field-field lain di-refresh dari `posLevels`/`posSettings`/`posCalc` (ticks↔price, Qty); gagal → `bad` + nilai kembali. Ganti `#ppRiskUnit` → `#ppRisk` diisi `convertRisk(...)`. Lock objek → semua field `disabled` (perilaku lama untuk `#ppTp`).

- [ ] **Step 1: Tulis tes yang gagal** (di `position-inputs.spec.js`, buka via `openObjSettings(o,300,200,'levels')`):
  - tab berlabel `Inputs`; `#ppAcc` = nilai `#balance`, `#ppRisk` = `#riskPct`, `#ppRiskUnit` = `%`.
  - isi `#ppTpTicks` `50` + Enter → `#ppTp` = `(entry+50·tick).toFixed(dec)` dan titik 1&3 bergeser.
  - isi `#ppTp` harga baru + Enter → `#ppTpTicks` = `round(|tp-entry|/tick)`.
  - isi `#ppEntry` entry+0.001 + Enter → titik 0..5 bergeser 0.001, ticks TP/SL tak berubah.
  - account `10000`, risk `1`, ganti unit ke `USD` → `#ppRisk` = `100`.
  - account `0` → `#ppAcc` class `bad`, nilai kembali.
  - `#ppQty` berubah setelah `#ppQtyPrec` `4` (4 desimal).
- [ ] **Step 2:** Jalankan spec → FAIL.
- [ ] **Step 3:** Implementasi di `draw-style-modal.js` (render & wiring).
- [ ] **Step 4:** `npx playwright test tests/smoke/position-inputs.spec.js tests/smoke/position-sltp-input.spec.js --project=hermetic` → PASS.
- [ ] **Step 5:** Commit `feat(position): tab Inputs ala TV di modal Long/Short`.

### Task 3: Label Qty & P&L di chart

**Files:**
- Modify: `js/draw-position-inputs.js` (tambah `posPillTexts`)
- Modify: `js/overlays-custom.js:276-333` (`posFigures`: tick size via `posTickSize()`, teks pill via `posPillTexts`)
- Test: `tests/smoke/position-inputs.spec.js`, `tests/drawing/32-position-handles.spec.js`

**Interfaces:**
- Produces: `posPillTexts(o): {target:string, stop:string, center:string}` dari points di `o` (objek overlay yang sedang dirender, bukan `getOverlayById`, karena dipanggil dari `createPointFigures`). Format:
  - target: `Target 1.09000   50p · 500t (0.459%)  +$300.00`
  - stop: `Stop 1.08500   20p · 200t (0.183%)  -$100.00`
  - center: `LONG · Qty 0.50 lot · RR 1:2.50` (Qty pakai `qtyPrec`; satuan `lot` bila lot>1, `units` bila lot===1)
  - Nominal: `$` + 2 desimal, pemisah ribuan `en-US`.

- [ ] **Step 1: Tes gagal:** `posPillTexts` untuk long dengan account 10000/risk 1% berisi `-$100.00` di `stop`, `Qty ` + `qtyLots.toFixed(2)` di `center`, dan `+$` + `pnlTp.toFixed(2)` di `target`; short berisi `SHORT`.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi `posPillTexts`; `posFigures` memakainya (pill fase satu-titik/tanpa SL tetap seperti sekarang).
- [ ] **Step 4:** `npx playwright test tests/smoke/position-inputs.spec.js tests/drawing/32-position-handles.spec.js --project=hermetic` → PASS; cek manual di browser bahwa pill tak terpotong.
- [ ] **Step 5:** Commit `feat(position): label Qty & P&L nominal di chart`.

### Task 4: Verifikasi menyeluruh & PR

Perubahan menyentuh drawing → kategori besar (CLAUDE.md).

- [ ] `npx playwright test tests/smoke --project=hermetic` → hijau.
- [ ] `npx playwright test --project=hermetic` (timeout Bash 600000) → hijau, kecuali flaky yang tercatat (`replay-play.spec.js:51`) — laporkan apa adanya.
- [ ] `git fetch origin && git rebase origin/main`, push, buka PR ke `main` dengan daftar tes yang dijalankan & hasilnya.
