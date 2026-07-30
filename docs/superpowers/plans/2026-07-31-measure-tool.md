# Measure tool (ruler) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan alat ukur ephemeral (ruler) ke chart — Δprice, Δ%, Δpip, jumlah bar, durasi — dengan dua pintu masuk: tombol rail (`Alt+M`) dan `Shift`+tekan-geser-lepas.

**Architecture:** Satu overlay klinecharts `measure` (didaftarkan di modul baru `js/measure.js`) dipakai kedua jalur, sehingga angka & visual mustahil menyimpang antar-jalur. Jalur rail memakai `createDraw()` yang sudah ada (dapat presisi sub-bar, preview, magnet, pembatalan dari `delHooks`); jalur Shift+drag memakai listener pointer fase capture di `#chart` yang menahan pan klinecharts. Objek tak pernah masuk `PERSIST_DRAW` dan tak mencemari history undo.

**Tech Stack:** Vanilla JS classic scripts (tanpa build step, tanpa ES modules), KLineCharts 9.8.10, Playwright (project `hermetic`).

Spec: `docs/superpowers/specs/2026-07-31-measure-tool-design.md`

## Global Constraints

- **Teks UI wajib bahasa Inggris** (CLAUDE.md). Komentar kode & pesan commit bahasa Indonesia.
- **Urutan `<script src>` mengikat** — tak ada hoisting antar-file. `js/measure.js` dimuat setelah `js/draw-rail.js`.
- **Jangan pakai `npm test`** (suite penuh ~7 menit). Sebelum push: `npx playwright test tests/smoke --project=hermetic`. Flag `--project=hermetic` WAJIB.
- Satu fitur = satu PR; commit conventional (Indonesian) + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Branch: `zihar/zihar/feat/measure-tool` (sudah dibuat, spec sudah di-commit).
- Semua akses `chart.*` dibungkus `try/catch` sesuai pola repo.

---

### Task 1: Statistik & format (fungsi murni) + `fmtDur` Inggris

**Files:**
- Create: `js/measure.js`
- Modify: `index.html` (satu `<script>` setelah `/js/draw-rail.js`, baris 438)
- Modify: `js/overlays-custom.js:369-376` (`fmtDur` → satuan Inggris)
- Test: `tests/smoke/measure.spec.js` (baru)

**Interfaces:**
- Consumes: `tsOf`, `fidxOf` (`js/util.js`), `INSTRUMENT`/`instSpec` (`js/sizing-pnl.js`), `fmtFor` (`js/broker-paper.js`), `inst` (`js/state.js`), `fmtDur` (`js/overlays-custom.js`)
- Produces: `measureStats(p0,p1) → {dPrice,dPct,dPips,bars,ms}|null` dan `fmtMeasure(stats) → [line1,line2]|null` (dipakai Task 2 & 3)

- [ ] **Step 1: Tulis test yang gagal** — `tests/smoke/measure.spec.js`

```js
// Measure tool (ruler) — alat ukur EPHEMERAL. Test ini di smoke (gerbang PR) karena
// measure menyentuh jalur pointer chart (Shift+drag menahan pan klinecharts): kalau
// intersepsinya salah, yang rusak bukan cuma measure tapi pan chart itu sendiri.
//
// Angka diuji lewat API resmi di page context (measureStats/fmtMeasure), BUKAN dengan
// membaca teks canvas — canvas tak punya DOM dan OCR bukan assertion.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test.describe('measure: statistik & format', () => {
  test('Δprice bertanda, %, pips, bar plural, durasi', async ({ page }) => {
    await gotoApp(page);

    const out = await page.evaluate(() => {
      const a = tfData[currentTF];
      const i = a.length - 20, j = a.length - 5;      // 15 bar terpisah
      const p0 = { timestamp: a[i].timestamp, value: 1.1 };
      const p1 = { timestamp: a[j].timestamp, value: 1.1012 };
      const st = measureStats(p0, p1);
      return { st, lines: fmtMeasure(st), pip: instSpec().pip, inst };
    });

    expect(out.st.bars, '15 bar terpisah di ruang indeks').toBe(15);
    expect(out.st.dPrice).toBeCloseTo(0.0012, 10);
    expect(out.st.dPct).toBeCloseTo(0.109, 2);
    expect(out.st.dPips).toBeCloseTo(0.0012 / out.pip, 6);
    expect(out.lines[0], 'Δprice harus bertanda + saat naik').toMatch(/^\+/);
    expect(out.lines[0], 'persen ikut di baris pertama').toContain('%');
    expect(out.lines[0], 'pips ada untuk instrumen FX').toContain('pips');
    expect(out.lines[1], 'plural bars').toMatch(/^15 bars · /);
    assertNoPageErrors(page);
  });

  test('turun → tanda minus; 1 bar singular; instrumen tanpa pip → tanpa segmen pips', async ({ page }) => {
    await gotoApp(page);

    const turun = await page.evaluate(() => {
      const a = tfData[currentTF];
      const p0 = { timestamp: a[a.length - 3].timestamp, value: 1.101 };
      const p1 = { timestamp: a[a.length - 2].timestamp, value: 1.1 };
      return fmtMeasure(measureStats(p0, p1));
    });
    expect(turun[0], 'turun → minus').toMatch(/^-/);
    expect(turun[1], 'satu bar → singular').toMatch(/^1 bar · /);

    // Instrumen di luar tabel INSTRUMENT (mis. saham) → pip tak punya arti → dPips null.
    const saham = await page.evaluate(() => {
      const prev = inst;
      inst = 'STOCK:BBCA.JK';
      const a = tfData[currentTF];
      const st = measureStats(
        { timestamp: a[a.length - 3].timestamp, value: 100 },
        { timestamp: a[a.length - 2].timestamp, value: 101 }
      );
      const lines = fmtMeasure(st);
      inst = prev;
      return { dPips: st.dPips, lines };
    });
    expect(saham.dPips, 'saham tak punya pip').toBeNull();
    expect(saham.lines[0], 'baris pertama tanpa segmen pips').not.toContain('pips');
    assertNoPageErrors(page);
  });

  test('fmtDur memakai satuan Inggris', async ({ page }) => {
    await gotoApp(page);
    const d = await page.evaluate(() => [
      fmtDur(45 * 6e4),                  // 45m
      fmtDur(3 * 36e5 + 45 * 6e4),       // 3h 45m
      fmtDur(2 * 864e5 + 4 * 36e5),      // 2d 4h
    ]);
    expect(d).toEqual(['45m', '3h 45m', '2d 4h']);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic`
Expected: FAIL — `measureStats is not defined` (dan `fmtDur` masih mengembalikan `3j 45m`).

- [ ] **Step 3: Buat `js/measure.js` dengan fungsi murninya**

```js
// ===================== Measure tool (ruler) — ephemeral =====================
// Alat ukur sekali pakai: memberi angka lalu hilang, tanpa meninggalkan objek. Beda dari
// semua tool gambar lain, ia TIDAK masuk PERSIST_DRAW & tidak mencemari history undo.
// Rancangan: docs/superpowers/specs/2026-07-31-measure-tool-design.md

// Statistik murni dari dua titik overlay. null bila salah satu titik belum punya harga atau
// waktu (mis. titik di area future tanpa data) → pemanggil menggambar kotak TANPA pill, bukan
// mencetak NaN.
function measureStats(p0, p1){
  if(!p0 || !p1 || p0.value==null || p1.value==null) return null;
  const t0=tsOf(p0), t1=tsOf(p1);
  if(t0==null || t1==null) return null;
  const dPrice=p1.value-p0.value;
  const dPct = p0.value ? dPrice/p0.value*100 : 0;
  // pip HANYA untuk instrumen yang speknya kita punya. Untuk saham (STOCK:…) instSpec()
  // jatuh ke input #pipSize dan akan mencetak "pip" yang tak punya arti di sana.
  const spec = INSTRUMENT[inst];
  const dPips = spec ? Math.abs(dPrice)/spec.pip : null;
  // bar dihitung di ruang INDEKS, jadi gap akhir pekan otomatis tak terhitung.
  const bars = Math.round(Math.abs(fidxOf(p1)-fidxOf(p0)));
  // durasi = rentang wall-clock NYATA, bukan bars × DUR (alasan sama dgn dateRange,
  // js/overlays-custom.js: bar MN panjangnya 28–31 hari).
  return {dPrice, dPct, dPips, bars, ms:Math.abs(t1-t0)};
}
// [line1, line2] siap dirender. Teks Inggris (aturan CLAUDE.md).
function fmtMeasure(st){
  if(!st) return null;
  const p=fmtFor(inst, st.dPrice);
  const priceTxt = st.dPrice>=0 ? '+'+p : p;                       // fmtFor sudah membawa '-'
  const pctTxt = (st.dPct>=0?'+':'')+st.dPct.toFixed(2)+'%';
  const pipTxt = st.dPips!=null ? ' · '+st.dPips.toFixed(1)+' pips' : '';
  const barTxt = st.bars===1 ? '1 bar' : st.bars+' bars';
  return [priceTxt+' ('+pctTxt+')'+pipTxt, barTxt+' · '+fmtDur(st.ms)];
}
```

- [ ] **Step 4: Daftarkan modul di `index.html`**

Sisipkan tepat setelah baris `<script src="/js/draw-rail.js"></script>`:

```html
<script src="/js/measure.js"></script>
```

- [ ] **Step 5: Ubah `fmtDur` ke satuan Inggris** — `js/overlays-custom.js:369`

```js
// Durasi ringkas, satuan Inggris (teks UI wajib Inggris — CLAUDE.md). Dipakai label dateRange
// & pill measure.
function fmtDur(ms){
  const m=Math.round(ms/6e4);
  if(m<60) return m+'m';
  const h=Math.floor(m/60), mm=m%60;
  if(h<24) return mm? h+'h '+mm+'m' : h+'h';
  const d=Math.floor(h/24), hh=h%24;
  return hh? d+'d '+hh+'h' : d+'d';
}
```

- [ ] **Step 6: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic`
Expected: 3 test PASS.

- [ ] **Step 7: Commit**

```bash
git add js/measure.js js/overlays-custom.js index.html tests/smoke/measure.spec.js
git commit -m "feat(measure): statistik & format alat ukur + fmtDur satuan Inggris

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Overlay `measure` + tombol rail + siklus hidup ephemeral

**Files:**
- Modify: `js/measure.js` (tambah `registerOverlay` + `measureId`/`clearMeasure`)
- Modify: `js/draw-catalog.js` (grup `measure`)
- Modify: `js/draw-tools.js` (`createDraw` → `clearMeasure()`; `onDrawEnd` → catat `measureId`)
- Modify: `js/draw-rail.js` (`setCursorMode` → `clearMeasure()`)
- Modify: `js/keyboard.js:69` (Esc → `clearMeasure()`)
- Modify: `js/switch-tf.js:28`, `js/load-chart.js:99` (`clearMeasure()`)
- Modify: `tests/helpers/spec.js` (satu baris `TOOL_SPEC`)
- Test: `tests/smoke/measure.spec.js` (tambah describe baru)

**Interfaces:**
- Consumes: `measureStats`/`fmtMeasure` (Task 1), `subBarCoords`, `alphaHex`, `POS_GREEN`, `POS_RED`, `createDraw`, `inProgressId`
- Produces: `measureId` (global, `null` bila tak ada), `clearMeasure()`, overlay bernama `'measure'`

- [ ] **Step 1: Tulis test yang gagal** — tambahkan di `tests/smoke/measure.spec.js`

```js
const { armTool, overlays } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

test.describe('measure: jalur rail & siklus hidup ephemeral', () => {
  test('Alt+M → 2 klik → measure ada; Esc membuangnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('measure');

    await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.55);
    await page.waitForTimeout(400);                       // jeda klik canvas (tests/README.md)
    await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    expect(await page.evaluate(() => measureId), 'measureId dicatat setelah objek jadi').not.toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(true);

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => measureId), 'Esc membuang measure').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);
    assertNoPageErrors(page);
  });

  test('measure tak ikut tersimpan & tak mencemari undo', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.55);
    await page.waitForTimeout(400);
    await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(500);                        // lewati debounce saveDraws (350ms)

    expect(await page.evaluate(() => Object.keys(PERSIST_DRAW)), 'measure tak boleh persist')
      .not.toContain('measure');
    expect(await page.evaluate(() => serializeDraws().some((d) => d.name === 'measure'))).toBe(false);
    expect(await page.evaluate(() => drawUndo.length), 'tak ada langkah undo kosong').toBe(0);
    assertNoPageErrors(page);
  });

  test('klik berikutnya di chart membuang measure, dan klik itu tetap sampai ke chart', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.55);
    await page.waitForTimeout(400);
    await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(400);

    await page.mouse.click(rect.x + rect.width * 0.75, rect.y + rect.height * 0.6);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => measureId), 'klik lain membuang measure').toBeNull();
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic`
Expected: FAIL — `Alt+M` tak meng-arm apa pun (`inProgressId` tetap null) karena grup rail & overlay belum ada.

- [ ] **Step 3: Daftarkan overlay + state ephemeral** — tambahkan di `js/measure.js`

```js
// ---- state ephemeral: hanya SATU hasil ukur hidup pada satu waktu ----
// measureId diisi HANYA di onDrawEnd (js/draw-tools.js). Konsekuensinya, saat measure masih
// digambar ia masih null → Esc jatuh ke cancelInProgressDraw() seperti tool lain.
let measureId=null;
function clearMeasure(){
  if(measureId==null) return;
  try{ chart.removeOverlay(measureId); }catch(_){}
  measureId=null;
}

// Warna = ARAH (naik/turun), bukan preferensi per-objek → measure sengaja TAK masuk
// DRAW_DEFAULT, jadi ia tak punya modal Style/Text.
const MEAS_UP=POS_GREEN, MEAS_DN=POS_RED;
// needDefaultPointFigure:false → tanpa handle titik & tanpa hit-test. Ini SENGAJA, dan bukan
// pengulangan Temuan 3 (simpleAnnotation/simpleTag ditarik karena tak terjangkau): objek itu
// PERSIST sehingga tak-terjangkau = nyangkut selamanya, sedangkan measure tak pernah tersimpan
// dan punya empat jalur keluar otomatis (Esc, klik lain, arm tool lain, ganti TF/instrumen).
klinecharts.registerOverlay({
  name:'measure', totalStep:3, needDefaultPointFigure:false,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1];
    if(!a||!b||a.x==null||b.x==null||!isFinite(a.x)||!isFinite(b.x)) return [];
    const v0=overlay.points[0]&&overlay.points[0].value, v1=overlay.points[1]&&overlay.points[1].value;
    const up = (v1!=null&&v0!=null) ? v1>=v0 : b.y<=a.y;
    const col = up?MEAS_UP:MEAS_DN;
    const xL=Math.min(a.x,b.x), xR=Math.max(a.x,b.x), yT=Math.min(a.y,b.y), yB=Math.max(a.y,b.y);
    const figs=[{type:'rect', attrs:{x:xL, y:yT, width:Math.max(1,xR-xL), height:Math.max(1,yB-yT)},
      styles:{style:'stroke_fill', color:col+alphaHex(12), borderColor:col, borderSize:1}}];
    // panah vertikal di tengah kotak: arah gerak terbaca sebelum angkanya dibaca
    const xc=(a.x+b.x)/2, dir=(b.y>=a.y)?1:-1, hs=6;
    figs.push({type:'line', attrs:{coordinates:[{x:xc,y:a.y},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    figs.push({type:'line', attrs:{coordinates:[{x:xc-hs,y:b.y-dir*hs},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    figs.push({type:'line', attrs:{coordinates:[{x:xc+hs,y:b.y-dir*hs},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    const lines=fmtMeasure(measureStats(overlay.points[0], overlay.points[1]));
    if(lines){
      // pill di sisi LUAR kotak (atas bila naik, bawah bila turun) → tak menutup candle yang diukur
      const w=Math.max(lines[0].length, lines[1].length)*6.4+16, h=34;
      const py = up ? yT-h-6 : yB+6;
      figs.push({type:'rect', attrs:{x:xc-w/2, y:py, width:w, height:h}, styles:{style:'fill', color:col}});
      figs.push({type:'text', attrs:{x:xc, y:py+11, text:lines[0], align:'center', baseline:'middle'},
        styles:{color:'#fff', size:11}});
      figs.push({type:'text', attrs:{x:xc, y:py+24, text:lines[1], align:'center', baseline:'middle'},
        styles:{color:'#fff', size:11}});
    }
    return figs;
  }
});

// Hasil ukur yang SUDAH jadi dibuang oleh mousedown berikutnya di chart. Listener ini sengaja
// TIDAK stopPropagation: klik itu harus tetap sampai ke chart & tool lain. Saat klik ke-2 jalur
// rail, measureId masih null (baru diisi di onDrawEnd) → klik penyelesai tak membuang dirinya.
$('#chart').addEventListener('mousedown',(e)=>{ if(!e.shiftKey) clearMeasure(); });
```

- [ ] **Step 4: Tambahkan grup rail** — `js/draw-catalog.js`, sisipkan sebelum grup `text`

```js
  // Measure (ruler): alat ukur EPHEMERAL — dapat baris rail sendiri, bukan numpang di grup
  // Positions, supaya memakainya tak mengubah arti tombol grup itu (lastToolOf).
  {key:'measure', title:'Measure', tools:[
    {name:'measure', sc:'M', title:'Measure', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9h18v6H3z"/><path d="M7 9v3M11 9v3M15 9v3M19 9v3"/></svg>'},
  ]},
```

- [ ] **Step 5: Sambungkan jalur keluar & pencatatan id**

`js/draw-tools.js` — di awal `createDraw()`, tepat setelah `track('draw',{tool:name});`:

```js
  try{ clearMeasure(); }catch(_){}   // gestur baru → hasil ukur sebelumnya tak relevan
```

`js/draw-tools.js` — di `onDrawEnd`, tepat sebelum `inProgressId=null; disarmIcons();`:

```js
    if(o && o.name==='measure') measureId=o.id;   // ephemeral: dipegang sampai jalur keluar mana pun
```

`js/draw-rail.js` — di awal `setCursorMode()`, sebelum `cancelInProgressDraw();`:

```js
  try{ clearMeasure(); }catch(_){}
```

`js/keyboard.js:69` — ganti baris Escape menjadi:

```js
  else if(e.key==='Escape'){ clearMeasure(); if(!cancelInProgressDraw() && selectedId){ deselectOverlay(); } }
```

`js/switch-tf.js` — di awal `switchTF()`, setelah `track('timeframe',{tf});`:

```js
  try{ clearMeasure(); }catch(_){}   // titik ukur ber-anchor indeks TF lama → tak bermakna di TF baru
```

`js/load-chart.js:99` — tepat sebelum `restoreDraws();`:

```js
  try{ clearMeasure(); }catch(_){}   // ganti instrumen → hasil ukur instrumen lama dibuang
```

- [ ] **Step 6: Tambahkan baris `TOOL_SPEC`** — `tests/helpers/spec.js`, setelah blok Positions

```js
  // ---- Measure ----
  // Ephemeral: tak tersimpan (persist:false), tak punya panel setting (tak ada di DRAW_DEFAULT),
  // dan dibuang oleh Esc / klik lain / arm tool lain / ganti TF-instrumen. Flag `ephemeral`
  // menandai itu untuk test yang mensyaratkan objek tetap hidup setelah gestur lain.
  { name: 'measure', group: 'measure', groupTitle: 'Measure', title: 'Measure', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: null, persist: false, ephemeral: true, sc: 'M' },
```

- [ ] **Step 7: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic`
Expected: 6 test PASS.

- [ ] **Step 8: Jalankan test drawing yang ikut terpengaruh TOOL_SPEC**

Run: `npx playwright test tests/drawing/50-rail.spec.js tests/drawing/20-parity.spec.js --project=hermetic`
Expected: PASS — grup "Measure" muncul di rail, `Alt+M` meng-arm, landing 2 klik ≤1px.
Bila ada test yang mensyaratkan objek bertahan setelah gestur lain dan gagal untuk `measure`, gerbangi dengan `spec.ephemeral` (jangan melemahkan assertion tool lain).

- [ ] **Step 9: Commit**

```bash
git add js/measure.js js/draw-catalog.js js/draw-tools.js js/draw-rail.js js/keyboard.js js/switch-tf.js js/load-chart.js tests/helpers/spec.js tests/smoke/measure.spec.js
git commit -m "feat(measure): overlay ruler + tombol rail Alt+M + siklus hidup ephemeral

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Jalur `Shift`+tekan-geser-lepas

**Files:**
- Modify: `js/measure.js` (listener pointer)
- Test: `tests/smoke/measure.spec.js` (tambah describe baru)

**Interfaces:**
- Consumes: `fracAnchorFromPx`, `pxToValue`, `tsOf`, `magnetSnap` (`js/util.js`), `magnetOn`, `eraserOn`, `inProgressId`, `clearMeasure`/`measureId` (Task 2)
- Produces: tak ada simbol baru untuk task lain

- [ ] **Step 1: Tulis test yang gagal** — tambahkan di `tests/smoke/measure.spec.js`

```js
const { barSpaceApi } = require('../helpers/chart');

test.describe('measure: Shift+drag', () => {
  test('hidup selama menggeser, hilang saat dilepas, dan chart TIDAK nge-pan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    // Bukti pan tertahan: barSpace + posisi-x candle terakhir harus sama sebelum & sesudah.
    const bsBefore = await barSpaceApi(page);
    const xBefore = await page.evaluate(() => {
      const a = tfData[currentTF];
      let c = chart.convertToPixel({ timestamp: a[a.length - 1].timestamp, value: 0 },
        { paneId: 'candle_pane', absolute: true });
      if (Array.isArray(c)) c = c[0];
      return c.x;
    });

    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.6, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35, { steps: 8 });

    expect(await page.evaluate(() => measureId), 'measure hidup selama menggeser').not.toBeNull();
    const pts = await page.evaluate(() => chart.getOverlayById(measureId).points.length);
    expect(pts, 'dua titik: awal & posisi kursor').toBe(2);

    await page.mouse.up();
    await page.keyboard.up('Shift');

    expect(await page.evaluate(() => measureId), 'dilepas → hilang').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);

    const bsAfter = await barSpaceApi(page);
    const xAfter = await page.evaluate(() => {
      const a = tfData[currentTF];
      let c = chart.convertToPixel({ timestamp: a[a.length - 1].timestamp, value: 0 },
        { paneId: 'candle_pane', absolute: true });
      if (Array.isArray(c)) c = c[0];
      return c.x;
    });
    expect(bsAfter.bar, 'barSpace tak berubah').toBeCloseTo(bsBefore.bar, 5);
    expect(Math.abs(xAfter - xBefore), 'chart tak boleh ikut nge-pan').toBeLessThan(1);
    assertNoPageErrors(page);
  });

  test('drag TANPA Shift tetap nge-pan chart seperti biasa', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const xBefore = await page.evaluate(() => {
      const a = tfData[currentTF];
      let c = chart.convertToPixel({ timestamp: a[a.length - 1].timestamp, value: 0 },
        { paneId: 'candle_pane', absolute: true });
      if (Array.isArray(c)) c = c[0];
      return c.x;
    });

    await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const xAfter = await page.evaluate(() => {
      const a = tfData[currentTF];
      let c = chart.convertToPixel({ timestamp: a[a.length - 1].timestamp, value: 0 },
        { paneId: 'candle_pane', absolute: true });
      if (Array.isArray(c)) c = c[0];
      return c.x;
    });
    expect(Math.abs(xAfter - xBefore), 'pan biasa harus tetap jalan').toBeGreaterThan(20);
    expect(await page.evaluate(() => measureId), 'drag biasa tak membuat measure').toBeNull();
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic -g "Shift"`
Expected: FAIL — `measureId` tetap null saat menggeser (belum ada listener), dan chart justru nge-pan.

- [ ] **Step 3: Implementasikan jalur Shift+drag** — tambahkan di akhir `js/measure.js`

```js
// ---- Shift + tekan-geser-lepas: ukur kilat tanpa menyentuh rail ----
// mousedown dipasang di fase CAPTURE lalu stopPropagation → handler klinecharts (terpasang di
// canvas, fase bubble) tak pernah melihatnya, jadi chart TIDAK nge-pan. Trik & alasan yang sama
// dipakai Shift+wheel untuk skala harga (js/price-scale.js).
// mousemove/mouseup di WINDOW, bukan #chart: kalau tombol dilepas di luar chart, mouseup pada
// #chart tak pernah datang dan overlay akan nyangkut.
(function attachMeasureDrag(){
  const el=$('#chart'); if(!el) return;
  let dragging=false;
  function ptFromEvent(e){
    const r=el.getBoundingClientRect();
    const xa=fracAnchorFromPx(e.clientX-r.left);
    let v=pxToValue(e.clientY-r.top);
    if(!xa || v==null) return null;
    // magnet dihormati di jalur ini juga — kalau tidak, dua pintu masuk bisa memberi angka
    // berbeda untuk gestur yang sama.
    if(magnetOn){ const t=tsOf(xa);
      if(t!=null){ const s=magnetSnap(t, v, e.clientX-r.left, e.clientY-r.top); if(s) v=s.value; } }
    return Object.assign({value:v}, xa);
  }
  el.addEventListener('mousedown',(e)=>{
    if(!e.shiftKey || e.button!==0) return;
    if(inProgressId || eraserOn) return;                 // sedang menggambar / mode hapus → jangan rebut
    const tgt=e.target; if(!tgt || tgt.tagName!=='CANVAS') return;
    const p=ptFromEvent(e); if(!p) return;
    e.preventDefault(); e.stopPropagation();
    clearMeasure();
    try{ measureId=chart.createOverlay({name:'measure', points:[p,p], lock:true}); }catch(_){ measureId=null; }
    dragging=(measureId!=null);
  },{capture:true});
  window.addEventListener('mousemove',(e)=>{
    if(!dragging || measureId==null) return;
    const p=ptFromEvent(e); if(!p) return;
    try{ const o=chart.getOverlayById(measureId);
      if(o&&o.points&&o.points.length) chart.overrideOverlay({id:measureId, points:[o.points[0], p]});
    }catch(_){}
  },{capture:true});
  const stop=()=>{ if(!dragging) return; dragging=false; clearMeasure(); };
  window.addEventListener('mouseup', stop, {capture:true});
  window.addEventListener('blur', stop);
})();
```

- [ ] **Step 4: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/measure.spec.js --project=hermetic`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add js/measure.js tests/smoke/measure.spec.js
git commit -m "feat(measure): Shift+drag ukur kilat tanpa membuat chart nge-pan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Dokumentasi & verifikasi akhir

**Files:**
- Modify: `docs/drawing-tools-gap-plan.md` (tandai T1.1 selesai)
- Modify: `ROADMAP.md` (bagian "Drawing tools — gap vs TradingView")
- Modify: `tests/README.md` (satu baris: measure = tool ephemeral pertama, jangan diasumsikan bertahan)

- [ ] **Step 1: Tandai T1.1 selesai di `docs/drawing-tools-gap-plan.md`**

Ubah baris T1.1 di tabel Tier 1 menjadi:

```markdown
| T1.1 | ~~**Measure tool (ruler)**~~ — ✅ SELESAI (spec `docs/superpowers/specs/2026-07-31-measure-tool-design.md`) | Masuk 5 tool wajib; di TV juga hotkey Shift+drag | `js/measure.js`: overlay ephemeral, rail grup "Measure" + Alt+M, Shift+drag; Δharga/Δ%/Δpip/bar/durasi |
```

- [ ] **Step 2: Perbarui `ROADMAP.md`**

Di daftar "Drawing tools — gap vs TradingView", ganti butir Measure menjadi:

```markdown
- ✅ ~~**Measure tool (ruler)**~~ — SELESAI: `js/measure.js`, grup rail "Measure" + `Alt+M` + `Shift`+drag,
  readout Δprice/Δ%/Δpip/bar/durasi, ephemeral (tak masuk `PERSIST_DRAW`, tak mencemari undo).
```

- [ ] **Step 3: Catat sifat ephemeral di `tests/README.md`**

Tambahkan satu butir di bagian jebakan/catatan:

```markdown
- **`measure` adalah tool EPHEMERAL pertama** (`TOOL_SPEC.ephemeral`). Ia dibuang oleh Esc, klik
  berikutnya di chart, arm tool lain, dan ganti TF/instrumen — jadi jangan menulis assertion yang
  menganggap objeknya masih ada setelah gestur lain.
```

- [ ] **Step 4: Verifikasi penuh sebelum push**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: seluruh smoke (22 test lama + 8 baru) PASS.

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: PASS. (Ini di luar kebiasaan "smoke saja" karena PR ini menambah baris `TOOL_SPEC` yang dibaca 5 spec drawing — lebih murah menemukannya sekarang daripada setelah merge.)

- [ ] **Step 5: Commit & buka PR**

```bash
git add docs/drawing-tools-gap-plan.md ROADMAP.md tests/README.md
git commit -m "docs: tandai measure tool selesai (T1.1) & catat sifat ephemeral di tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin zihar/zihar/feat/measure-tool
gh pr create --base main --title "feat(measure): measure tool (ruler) ephemeral ala TradingView" --body "…"
```

PR body memuat: ringkasan, dua pintu masuk, sifat ephemeral, alasan `needDefaultPointFigure:false` aman (kontras Temuan 3), bukti verifikasi (output test), dan `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Merge setelah CI hijau**

Run: `scripts/merge-pr.sh <n>` (menolak PR merah/pending/ketinggalan `main` — CLAUDE.md).
Go-live tetap MANUAL: Actions → Release → Run workflow.
