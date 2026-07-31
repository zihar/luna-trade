# Lock objek gambar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Objek gambar bisa dikunci (per objek & semua sekaligus) sehingga tak bisa kegeser dan tak bisa terhapus tak sengaja.

**Architecture:** Kunci = properti `lock` milik overlay klinecharts (bukan state paralel), diubah lewat `chart.overrideOverlay({id,lock})` dan ikut tersimpan di `br_draws_<INSTRUMENT>`. Logikanya di modul baru `js/draw-lock.js`; UI-nya tombol Lock di modal Style + tombol rail Lock-all. Proteksi hapus dipasang di jalur pengguna (`Delete`, eraser, Remove-all), **bukan** di `clearDrawings()` yang dipakai undo & ganti instrumen.

**Tech Stack:** Vanilla JS classic scripts, KLineCharts 9.8.10, Playwright (project `hermetic`).

Spec: `docs/superpowers/specs/2026-07-31-lock-drawings-design.md`

## Global Constraints

- **Teks UI wajib bahasa Inggris.** Komentar & commit bahasa Indonesia.
- **`clearDrawings()` TIDAK BOLEH menghormati lock** — dipakai `applyDrawsSnapshot()` (undo) & `loadChart()` (ganti instrumen). Aksi pengguna memakai `removeAllDrawings()`.
- **Urutan `<script src>` mengikat**: `js/draw-lock.js` setelah `js/draw-persist.js`.
- Sebelum push: `npx playwright test tests/smoke --project=hermetic`; tambah `tests/drawing` sekali sebelum PR.
- Branch `zihar/zihar/feat/lock-drawings` (sudah ada, spec sudah di-commit). **Jangan `git add -A`.**

---

### Task 1: Inti kunci + persistensi

**Files:**
- Create: `js/draw-lock.js`
- Modify: `index.html` (script tag setelah `/js/draw-persist.js`)
- Modify: `js/draw-persist.js` (`serializeDraws` menyimpan `lock`; `buildDrawsFromArray` memulihkan + isyarat visual)
- Modify: `tests/smoke/boot-integrity.spec.js` (entri SENTINEL `draw-lock.js`)
- Test: `tests/smoke/lock-drawing.spec.js` (baru)

**Interfaces:**
- Consumes: `drawIds`, `chart`, `OVERLAY_POINT`/`HIDDEN_POINT` (`js/chart-styles.js`), `scheduleSaveDraws`, `toast`
- Produces: `isLocked(id)`, `applyLockVisual(id,on)`, `setDrawLock(id,on)`, `toggleDrawLock(id)`, `lockedDrawCount()`, `setLockAllDrawings(on)`, `removeAllDrawings()`, `blockedByLock(id)`

- [ ] **Step 1: Tulis test yang gagal** — `tests/smoke/lock-drawing.spec.js`

```js
// Lock objek gambar. Di smoke (gerbang PR) karena proteksinya menyentuh jalur hapus milik SEMUA
// tool (Delete, eraser, Remove-all) dan jalur persist.
//
// Assertion lewat PERILAKU (objek tak bergeser / tak terhapus), bukan cuma membaca flag.
//
// Rancangan: docs/superpowers/specs/2026-07-31-lock-drawings-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

test.describe('lock: inti & persistensi', () => {
  test('objek terkunci tak bisa digeser; yang tak terkunci bergeser dgn gestur sama', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');

    // pembanding dulu: gestur ini MEMANG menggeser objek saat tak terkunci
    const before = await page.evaluate((id) => JSON.stringify(chart.getOverlayById(id).points), obj.id);
    const mid = await page.evaluate((id) => {
      const p = chart.getOverlayById(id).points;
      const c = p.map((q) => chart.convertToPixel({ timestamp: q.timestamp, dataIndex: q.dataIndex, value: q.value }, { paneId: 'candle_pane', absolute: true }));
      const f = (a) => (Array.isArray(a) ? a[0] : a);
      const a = f(c[0]), b = f(c[1]);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }, obj.id);
    await page.mouse.move(rect.x + mid.x, rect.y + mid.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + mid.x + 40, rect.y + mid.y + 30, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate((id) => JSON.stringify(chart.getOverlayById(id).points), obj.id);
    expect(moved, 'gestur pembanding harus benar-benar menggeser').not.toBe(before);

    // kunci, lalu ulangi gestur yang sama
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    expect(await page.evaluate((id) => isLocked(id), obj.id)).toBe(true);
    const locked = await page.evaluate((id) => JSON.stringify(chart.getOverlayById(id).points), obj.id);
    await page.mouse.move(rect.x + mid.x + 40, rect.y + mid.y + 30, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + mid.x + 90, rect.y + mid.y + 70, { steps: 6 });
    await page.mouse.up();
    expect(
      await page.evaluate((id) => JSON.stringify(chart.getOverlayById(id).points), obj.id),
      'objek terkunci tak boleh bergeser'
    ).toBe(locked);
    assertNoPageErrors(page);
  });

  test('handle disembunyikan saat terkunci, kembali saat dibuka', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'rect');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    expect(await page.evaluate((id) => chart.getOverlayById(id).styles.point.color, obj.id)).toBe('transparent');
    await page.evaluate((id) => setDrawLock(id, false), obj.id);
    expect(await page.evaluate((id) => chart.getOverlayById(id).styles.point.color, obj.id)).not.toBe('transparent');
    assertNoPageErrors(page);
  });

  test('status kunci bertahan setelah reload', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    await page.waitForTimeout(500); // debounce saveDraws 350ms

    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 1, null, { timeout: 8000 });
    const o = (await overlays(page))[0];
    expect(o.lock, 'lock ikut tersimpan & dipulihkan').toBe(true);
    expect(await page.evaluate(() => chart.getOverlayById(drawIds[0]).styles.point.color)).toBe('transparent');
    assertNoPageErrors(page);
  });

  test('undo tak menghasilkan objek dobel walau ada yang terkunci', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    await page.waitForTimeout(500);
    await drawTool(page, 'rect');
    await page.waitForTimeout(500);
    expect((await overlays(page)).length).toBe(2);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect((await overlays(page)).length, 'clearDrawings internal harus tetap tanpa syarat').toBe(1);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/lock-drawing.spec.js --project=hermetic`
Expected: FAIL — `setDrawLock is not defined`.

- [ ] **Step 3: Buat `js/draw-lock.js`**

```js
// ===================== Lock objek gambar (per objek & semua) =====================
// Kunci BUKAN state paralel: ia properti `lock` milik overlay klinecharts, diubah lewat
// chart.overrideOverlay dan ikut tersimpan di br_draws_<INSTRUMENT>. Di klinecharts 9.8.10
// `lock` men-short-circuit dispatch pressed-move (hook onPressedMoving Luna tak dipanggil sama
// sekali), tapi TIDAK menggerbang klik/hover/select — jadi modal Style tetap bisa dibuka, dan
// itulah jalan untuk membuka kuncinya. Proteksi hapus harus kita buat sendiri.
// Rancangan: docs/superpowers/specs/2026-07-31-lock-drawings-design.md

function isLocked(id){ try{ const o=chart.getOverlayById(id); return !!(o&&o.lock); }catch(_){ return false; } }
// Isyarat visual: objek terkunci tak menampilkan buletan handle → afordansi "bisa digenggam"
// hilang sesuai kenyataannya. setStyles klinecharts me-MERGE, jadi ini tak menyentuh gaya garis.
function applyLockVisual(id,on){ try{ chart.overrideOverlay({id, styles:{point: on?HIDDEN_POINT:OVERLAY_POINT}}); }catch(_){} }
function setDrawLock(id,on){
  if(id==null) return;
  try{ chart.overrideOverlay({id, lock:!!on}); }catch(_){}
  applyLockVisual(id,!!on);
  try{ scheduleSaveDraws(); }catch(_){}      // kunci ikut snapshot → bisa di-undo spt perubahan gaya
  try{ syncLockAllBtn(); }catch(_){}
}
function toggleDrawLock(id){ setDrawLock(id, !isLocked(id)); }
function lockedDrawCount(){ return drawIds.filter(isLocked).length; }
function setLockAllDrawings(on){ drawIds.slice().forEach(id=>{ try{ chart.overrideOverlay({id, lock:!!on}); applyLockVisual(id,!!on); }catch(_){} });
  try{ scheduleSaveDraws(); }catch(_){}
  try{ syncLockAllBtn(); }catch(_){}
}
// Aksi pengguna "buang semua gambar". SENGAJA terpisah dari clearDrawings(): yang itu dipakai
// applyDrawsSnapshot (undo) & loadChart (ganti instrumen) dan HARUS tanpa syarat — kalau ia
// menghormati lock, undo menghasilkan objek dobel dan ganti instrumen menyeret gambar lama.
function removeAllDrawings(){
  const keep=drawIds.filter(isLocked).length;
  drawIds.slice().forEach(id=>{ if(isLocked(id)) return; try{ chart.removeOverlay(id); }catch(_){} });
  selectedId=hoverId=null;
  try{ syncLockAllBtn(); }catch(_){}
  if(keep) try{ toast(keep+' locked drawing'+(keep===1?'':'s')+' kept','info'); }catch(_){}
}
// Gerbang untuk jalur hapus per objek (Delete, eraser). true = dihentikan.
function blockedByLock(id){
  if(id==null || !isLocked(id)) return false;
  try{ toast('Drawing is locked — unlock it first','warn'); }catch(_){}
  return true;
}
```

- [ ] **Step 4: Daftarkan modul di `index.html`**

Sisipkan setelah `<script src="/js/draw-persist.js"></script>`:

```html
<script src="/js/draw-lock.js"></script>
```

- [ ] **Step 5: Persist di `js/draw-persist.js`**

Di `serializeDraws()`, tambahkan `lock` ke objek yang di-push:

```js
    out.push({ name:o.name, points:pts, lock:o.lock?1:0,
      extendData:(o.extendData!==undefined?o.extendData:null), style:objStyle[id]||null });
```

Di `buildDrawsFromArray()`, setelah `const base={name:d.name, points:pts};`:

```js
    if(d.lock) base.lock=true;      // kunci dipulihkan bersama objeknya
```

…dan di dalam `if(id){ … }`, setelah `applyXDateFlag(...)`:

```js
      if(d.lock) try{ applyLockVisual(id,true); }catch(_){}   // muncul tanpa handle sejak awal
```

- [ ] **Step 6: Entri SENTINEL** — `tests/smoke/boot-integrity.spec.js`, dekat entri `measure.js`

```js
  // Lock objek gambar — modul domain baru.
  'draw-lock.js': 'setDrawLock',
```

- [ ] **Step 7: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/lock-drawing.spec.js tests/smoke/boot-integrity.spec.js --project=hermetic`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/draw-lock.js js/draw-persist.js index.html tests/smoke/lock-drawing.spec.js tests/smoke/boot-integrity.spec.js
git commit -m "feat(draw): inti kunci objek + persistensi

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: UI (modal + rail) & proteksi hapus

**Files:**
- Modify: `js/draw-style-modal.js` (tombol Lock/Unlock; Delete dimatikan saat terkunci)
- Modify: `js/draw-rail.js` (tombol `#lockAllBtn` + `syncLockAllBtn()`)
- Modify: `js/keyboard.js` (`Delete`/`Backspace` melewati yang terkunci)
- Modify: `js/draw-tools.js` (eraser melewati yang terkunci)
- Modify: `js/context-menu.js` (tiga item Remove → `removeAllDrawings`)
- Test: `tests/smoke/lock-drawing.spec.js` (tambah describe)

**Interfaces:**
- Consumes: seluruh API Task 1
- Produces: `syncLockAllBtn()`, elemen `#lockAllBtn`, tombol `.dm-lock` di modal

- [ ] **Step 1: Tulis test yang gagal** — tambahkan di `tests/smoke/lock-drawing.spec.js`

```js
test.describe('lock: UI & proteksi hapus', () => {
  test('tombol Lock di modal mengunci & mematikan Delete', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    await page.evaluate((id) => openDrawModal(chart.getOverlayById(id), 'style'), obj.id);
    const lockBtn = page.locator('.dmodal .dm-lock');
    await expect(lockBtn).toBeVisible();
    expect(await lockBtn.textContent()).toMatch(/lock/i);

    await lockBtn.click();
    expect(await page.evaluate((id) => isLocked(id), obj.id)).toBe(true);
    await expect(page.locator('.dmodal .dm-del')).toBeDisabled();
    expect(await page.locator('.dmodal .dm-del').getAttribute('title')).toMatch(/unlock/i);

    await lockBtn.click();
    expect(await page.evaluate((id) => isLocked(id), obj.id)).toBe(false);
    await expect(page.locator('.dmodal .dm-del')).not.toBeDisabled();
    assertNoPageErrors(page);
  });

  test('Delete & eraser melewati objek terkunci, jalan lagi setelah dibuka', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);

    await page.evaluate((id) => { selectedId = id; }, obj.id);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect((await overlays(page)).length, 'Delete tak boleh membuang objek terkunci').toBe(1);

    await page.evaluate((id) => setDrawLock(id, false), obj.id);
    await page.evaluate((id) => { selectedId = id; }, obj.id);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect((await overlays(page)).length, 'setelah dibuka, Delete bekerja').toBe(0);
    assertNoPageErrors(page);
  });

  test('Remove-all menyisakan objek terkunci', async ({ page }) => {
    await gotoApp(page);
    const a = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), a.obj.id);
    await drawTool(page, 'rect');
    expect((await overlays(page)).length).toBe(2);

    await page.evaluate(() => removeAllDrawings());
    await page.waitForTimeout(200);
    const sisa = await overlays(page);
    expect(sisa.length, 'yang terkunci disisakan').toBe(1);
    expect(sisa[0].name).toBe('trendline');
    expect(sisa[0].lock).toBe(true);
    assertNoPageErrors(page);
  });

  test('tombol rail Lock all mengunci semua, klik lagi membuka semua', async ({ page }) => {
    await gotoApp(page);
    await drawTool(page, 'trendline');
    await drawTool(page, 'rect');

    const btn = page.locator('#lockAllBtn');
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('title'), 'teks UI Inggris').toMatch(/lock/i);
    await expect(btn).not.toHaveClass(/armed/);

    await btn.click();
    expect(await page.evaluate(() => drawIds.every(isLocked)), 'semua terkunci').toBe(true);
    await expect(btn).toHaveClass(/armed/);

    await btn.click();
    expect(await page.evaluate(() => drawIds.some(isLocked)), 'semua terbuka').toBe(false);
    await expect(btn).not.toHaveClass(/armed/);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/lock-drawing.spec.js --project=hermetic`
Expected: FAIL pada empat test baru (`.dm-lock` & `#lockAllBtn` tak ada; Delete masih membuang objek terkunci).

- [ ] **Step 3: Tombol Lock di modal** — `js/draw-style-modal.js`

Ganti baris `dm-foot` menjadi:

```js
    +`<div class="dm-foot"><button class="dm-lock"></button><button class="dm-del">${TRASH_SVG}<span>Delete</span></button><button class="dm-close">Close</button></div>`;
```

Setelah blok `panel.querySelector('.dm-del').onclick=…`, tambahkan:

```js
  // Lock objek: terkunci = tak bisa digeser & tak bisa terhapus. Delete dimatikan selama terkunci
  // supaya "buka kunci" jadi langkah sadar, bukan sekali klik yang sama.
  const lockBtn=panel.querySelector('.dm-lock');
  const syncLock=()=>{ const on=isLocked(o.id);
    lockBtn.textContent = on?'Unlock':'Lock';
    lockBtn.classList.toggle('on',on);
    const del=panel.querySelector('.dm-del');
    del.disabled=on; del.title = on?'Unlock to delete':'';
  };
  lockBtn.onclick=()=>{ toggleDrawLock(o.id); syncLock(); };
  syncLock();
```

- [ ] **Step 4: Tombol rail** — `js/draw-rail.js`, setelah blok `_hd.onclick=…`

```js
// toggle Lock all drawings — objek terkunci tak bisa digeser & tak bisa terhapus tak sengaja.
// Statusnya TURUNAN dari objeknya (armed = ada gambar & semuanya terkunci), bukan state sendiri:
// kunci per objek bisa diubah dari modal, jadi satu sumber kebenaran = properti lock overlay.
const LOCK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9.5" rx="1.6"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/></svg>';
const _lk=document.createElement('button'); _lk.id='lockAllBtn'; _lk.className='dtool';
_lk.setAttribute('aria-label','Lock all drawings');
_lk.innerHTML=LOCK_SVG;
function syncLockAllBtn(){
  const n=drawIds.length, locked=lockedDrawCount(), all=(n>0&&locked===n);
  _lk.classList.toggle('armed',all);
  _lk.title = all?'Unlock all drawings':'Lock all drawings';
  _lk.disabled = (n===0);
}
_lk.onclick=()=>{ const n=drawIds.length; if(!n) return;
  setLockAllDrawings(lockedDrawCount()!==n); };
```

…lalu ubah baris urutan tombol:

```js
// urutan tombol bawah (atas→bawah): magnet, keep-drawing, lock-all, hide, trash
_dt.appendChild(_mag); _dt.appendChild(_kd); _dt.appendChild(_lk); _dt.appendChild(_hd); _dt.appendChild(_tr);
syncLockAllBtn();
```

- [ ] **Step 5: Proteksi `Delete`** — `js/keyboard.js`

```js
  else if(e.key==='Delete'||e.key==='Backspace'){ const id=selectedId||hoverId; if(id){ e.preventDefault(); if(blockedByLock(id)) return; try{chart.removeOverlay(id);}catch(_){} } }
```

- [ ] **Step 6: Proteksi eraser** — `js/draw-tools.js`, di `delHooks().onClick`

```js
  onClick:(e)=>{ if(eraserOn){ if(!blockedByLock(e.overlay.id)) try{chart.removeOverlay(e.overlay.id);}catch(_){} return false; }
```

- [ ] **Step 7: Remove-all pakai jalur yang menghormati kunci** — `js/context-menu.js`

Ganti ketiga rujukan `clearDrawings` **hanya di menu pengguna** (`removeMenuItems()` dua tempat + item context-menu) menjadi `removeAllDrawings`:

```js
    {label:`Remove ${nd} ${dL}`,               disabled:nd===0,       fn:removeAllDrawings},
    {label:`Remove ${ni} ${iL}`,               disabled:ni===0,       fn:removeAllInd},
    {label:`Remove ${nd} ${dL} & ${ni} ${iL}`, disabled:(nd+ni)===0,  fn:()=>{ removeAllDrawings(); removeAllInd(); }},
```

```js
  if(drawIds.length){ const nd=drawIds.length; items.push({label:`🗑 Remove all drawings (${nd})`, fn:removeAllDrawings}); }
```

- [ ] **Step 8: Jaga tombol tetap sinkron** — `js/draw-tools.js`

Di `delHooks().onRemoved` dan di akhir `onDrawEnd`, panggil `syncLockAllBtn()`; juga di
`buildDrawsFromArray()` setelah loop (restore). Semuanya dibungkus `try{}catch(_){}` karena
`draw-rail.js` dimuat setelah `draw-tools.js`.

- [ ] **Step 9: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/lock-drawing.spec.js --project=hermetic`
Expected: 8 PASS.

- [ ] **Step 10: Commit**

```bash
git add js/draw-style-modal.js js/draw-rail.js js/keyboard.js js/draw-tools.js js/context-menu.js js/draw-persist.js tests/smoke/lock-drawing.spec.js
git commit -m "feat(draw): tombol Lock di modal + Lock all di rail + proteksi hapus

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Dokumentasi & verifikasi akhir

- [ ] **Step 1: `docs/drawing-tools-gap-plan.md`** — tandai T1.3 selesai (sebutkan: per objek via modal, lock-all via rail, proteksi hapus, isyarat handle disembunyikan, dan bahwa Object Tree tetap Tier 2).

- [ ] **Step 2: `tests/README.md`** — catat: `clearDrawings()` tanpa syarat vs `removeAllDrawings()` yang menghormati kunci; test yang membersihkan gambar harus memilih yang tepat.

- [ ] **Step 3: Verifikasi penuh**

Run: `npx playwright test tests/smoke --project=hermetic` → semua PASS.
Run: `npx playwright test tests/drawing --project=hermetic` → semua PASS (wajib: `delHooks.onClick`, persist, dan modal milik semua tool ikut berubah).

- [ ] **Step 4: PR & merge**

```bash
git add docs/drawing-tools-gap-plan.md tests/README.md
git commit -m "docs: tandai lock objek selesai (T1.3) & catat dua jalur hapus di tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin zihar/zihar/feat/lock-drawings
gh pr create --base main --title "feat(draw): lock objek gambar (per objek + lock all)" --body "…"
```

Setelah CI hijau: `scripts/merge-pr.sh <n>`. Go-live tetap MANUAL.
