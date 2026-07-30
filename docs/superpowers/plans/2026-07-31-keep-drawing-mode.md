# Keep drawing mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool gambar tetap aktif setelah objeknya jadi selama toggle "Stay in drawing mode" nyala, meniru TradingView.

**Architecture:** Satu state `keepDrawOn` (persist `localStorage br_keepdraw`) + ingatan `lastDrawTool` yang diisi `createDraw()`, dan `rearmDraw()` yang dijadwalkan async dari dua titik "objek selesai" (`onDrawEnd` dan cabang instant-drop). Tombol toggle di rail mengikuti pola `magBtn` yang sudah ada. Tak ada perubahan Go.

**Tech Stack:** Vanilla JS classic scripts (tanpa build step), KLineCharts 9.8.10, Playwright (project `hermetic`).

Spec: `docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md`

## Global Constraints

- **Teks UI wajib bahasa Inggris** (CLAUDE.md). Komentar kode & pesan commit bahasa Indonesia.
- **Default toggle MATI.** 253 test yang ada mengandalkan tool disarm setelah objek jadi.
- **Urutan `<script src>` mengikat** — `draw-tools.js` dimuat sebelum `draw-rail.js`; state `keepDrawOn` hidup di `draw-tools.js` dan dibaca tombol di `draw-rail.js`.
- **Jangan pakai `npm test`.** Sebelum push: `npx playwright test tests/smoke --project=hermetic`; tambah `tests/drawing` sekali sebelum PR karena perubahan menyentuh `createDraw`/`onDrawEnd` milik semua tool.
- Branch: `zihar/zihar/feat/keep-drawing-mode` (sudah dibuat, spec sudah di-commit).
- Commit conventional (Indonesian) + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Toggle + persistensi (belum ada rearm)

**Files:**
- Modify: `js/draw-tools.js` (deklarasi `keepDrawOn`, `lastDrawTool`)
- Modify: `js/draw-rail.js` (tombol `#keepDrawBtn`, disisipkan antara magnet & hide-all)
- Test: `tests/smoke/keep-drawing.spec.js` (baru)

**Interfaces:**
- Produces: `keepDrawOn` (boolean global), `lastDrawTool` (`{name,btn}|null`), elemen `#keepDrawBtn`

- [ ] **Step 1: Tulis test yang gagal** — `tests/smoke/keep-drawing.spec.js`

```js
// Keep drawing mode ("Stay in Drawing Mode" ala TradingView): tool tetap aktif setelah objek jadi.
//
// Di smoke (gerbang PR) karena ia menyentuh createDraw/onDrawEnd — jalur yang dipakai SEMUA tool
// gambar. Kalau rearm-nya salah, yang rusak bukan cuma fitur ini tapi setiap tool.
//
// Rancangan: docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test.describe('keep drawing: toggle & persistensi', () => {
  test('default mati; klik menyalakan, menulis localStorage, dan bertahan setelah reload', async ({ page }) => {
    await gotoApp(page);

    expect(await page.evaluate(() => keepDrawOn), 'default harus mati (sama dgn TradingView)').toBe(false);
    const btn = page.locator('#keepDrawBtn');
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveClass(/armed/);
    expect(await btn.getAttribute('title'), 'teks UI wajib Inggris').toMatch(/drawing mode/i);

    await btn.click();
    expect(await page.evaluate(() => keepDrawOn)).toBe(true);
    await expect(btn).toHaveClass(/armed/);
    expect(await page.evaluate(() => localStorage.getItem('br_keepdraw'))).toBeTruthy();

    await page.reload();
    await page.waitForFunction(() => typeof keepDrawOn !== 'undefined');
    expect(await page.evaluate(() => keepDrawOn), 'status bertahan setelah reload').toBe(true);
    await expect(page.locator('#keepDrawBtn')).toHaveClass(/armed/);

    await page.locator('#keepDrawBtn').click();
    expect(await page.evaluate(() => keepDrawOn), 'klik kedua mematikan').toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('br_keepdraw'))).toBeFalsy();
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/keep-drawing.spec.js --project=hermetic`
Expected: FAIL — `keepDrawOn is not defined` / `#keepDrawBtn` tak ada.

- [ ] **Step 3: Tambahkan state di `js/draw-tools.js`**

Tepat di bawah baris `let selectedId=null, hoverId=null, …`:

```js
// Keep drawing mode ("Stay in Drawing Mode" ala TradingView): tool tetap aktif setelah objek jadi.
// State-nya hidup di sini (bukan di draw-rail.js) karena yang memakainya adalah createDraw/onDrawEnd;
// tombolnya cuma UI. Default MATI, sama seperti TV.
let keepDrawOn = !!localStorage.getItem('br_keepdraw');
let lastDrawTool = null;      // {name, btn} — siapa yang di-rearm setelah objek selesai
```

- [ ] **Step 4: Tambahkan tombol di `js/draw-rail.js`**

Tepat setelah blok `_mag.onclick=…` dan SEBELUM baris `_dt.appendChild(_mag); …`:

```js
// toggle Keep drawing ("Stay in Drawing Mode" ala TradingView) — tool tetap aktif setelah objek jadi.
// Ikon pensil + gembok, seperti TV. Tanpa hotkey: TV pun tak punya, dan Ctrl/⌘ di TV justru milik
// magnet sementara (jangan dirampas).
const KEEPDRAW_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 21l1.2-3.6L12 9.6l2.4 2.4L6.6 19.8z"/><path d="M17 4.5V3.6a1.9 1.9 0 0 1 3.8 0v.9"/><rect x="16" y="4.5" width="5.8" height="5" rx="1"/></svg>';
const _kd=document.createElement('button'); _kd.id='keepDrawBtn'; _kd.className='dtool';
_kd.title='Stay in drawing mode: keep the tool active after each drawing (on/off)';
_kd.setAttribute('aria-label','Stay in drawing mode');
_kd.innerHTML=KEEPDRAW_SVG;
if(keepDrawOn) _kd.classList.add('armed');
_kd.onclick=()=>{ keepDrawOn=!keepDrawOn;
  try{ localStorage.setItem('br_keepdraw', keepDrawOn?'1':''); }catch(_){}
  _kd.classList.toggle('armed', keepDrawOn); };
```

Lalu ubah baris urutan tombol (urutan TV: magnet → stay-in-drawing → hide → remove):

```js
// urutan tombol bawah (atas→bawah): magnet, keep-drawing, hide, trash
_dt.appendChild(_mag); _dt.appendChild(_kd); _dt.appendChild(_hd); _dt.appendChild(_tr);
```

- [ ] **Step 5: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/keep-drawing.spec.js --project=hermetic`
Expected: 1 PASS.

- [ ] **Step 6: Commit**

```bash
git add js/draw-tools.js js/draw-rail.js tests/smoke/keep-drawing.spec.js
git commit -m "feat(draw): tombol toggle Stay in drawing mode + persistensi

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rearm setelah objek selesai

**Files:**
- Modify: `js/draw-tools.js` (`rearmDraw()`, catatan `lastDrawTool`, guard overlay telantar, dua titik pemanggilan)
- Test: `tests/smoke/keep-drawing.spec.js` (tambah describe)

**Interfaces:**
- Consumes: `keepDrawOn`, `lastDrawTool` (Task 1), `createDraw`, `cancelInProgressDraw`, `inProgressId`
- Produces: `rearmDraw()`

- [ ] **Step 1: Tulis test yang gagal** — tambahkan di `tests/smoke/keep-drawing.spec.js`

```js
const { overlays } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

/** Dua klik pada posisi berbeda (jeda 400ms — jebakan klik canvas, tests/README.md). */
async function twoClicks(page, rect, ax = 0.35, ay = 0.6, bx = 0.55, by = 0.4) {
  await page.mouse.click(rect.x + rect.width * ax, rect.y + rect.height * ay);
  await page.waitForTimeout(400);
  await page.mouse.click(rect.x + rect.width * bx, rect.y + rect.height * by);
}

test.describe('keep drawing: rearm', () => {
  test('nyala → dua trendline berturut-turut tanpa menyentuh rail lagi', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await twoClicks(page, rect);
    // objek pertama jadi → tool HARUS aktif lagi (rearm async, beri waktu satu tick)
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('trendline');

    await page.waitForTimeout(400);
    await twoClicks(page, rect, 0.6, 0.7, 0.78, 0.5);
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    // dua trendline JADI (yang ketiga masih in-progress & belum punya 2 titik)
    const jadi = (await overlays(page)).filter((o) => o.name === 'trendline' && o.points.length >= 2);
    expect(jadi.length, 'dua objek selesai tanpa mengklik rail lagi').toBe(2);
    assertNoPageErrors(page);
  });

  test('mati (default) → tool disarm setelah objek jadi (perilaku lama)', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(300); // beri kesempatan rearm yang tak boleh terjadi
    expect(await page.evaluate(() => inProgressId), 'toggle mati → tetap disarm').toBeNull();
    assertNoPageErrors(page);
  });

  test('Alt+H saat nyala → satu garis jatuh, tool armed kembali TANPA menjatuhkan garis kedua', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.45, { steps: 4 });
    await page.keyboard.press('Alt+H');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await page.waitForTimeout(400);

    const hlines = (await overlays(page)).filter((o) => o.name === 'horizontalStraightLine');
    // 1 garis yang sudah jatuh + 1 overlay in-progress hasil rearm
    expect(hlines.length, 'rearm non-instant: tak ada garis kedua yang jatuh sendiri').toBe(2);
    const prog = await page.evaluate(() => inProgressId);
    expect(hlines.filter((o) => o.id !== prog).length, 'tepat satu garis yang benar-benar jatuh').toBe(1);
    assertNoPageErrors(page);
  });

  test('measure tak di-rearm walau toggle nyala', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => inProgressId), 'measure ephemeral → tak di-rearm').toBeNull();
    assertNoPageErrors(page);
  });

  test('Esc membatalkan objek in-progress tapi toggle tetap nyala', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => inProgressId), 'Esc membatalkan gambar in-progress').toBeNull();
    expect(await page.evaluate(() => keepDrawOn), 'Esc TIDAK mematikan preferensi').toBe(true);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan test → harus GAGAL**

Run: `npx playwright test tests/smoke/keep-drawing.spec.js --project=hermetic`
Expected: FAIL pada test rearm (tool tetap disarm setelah objek jadi); test "mati (default)" & "measure" sudah lulus sejak awal (mereka penjaga perilaku lama).

- [ ] **Step 3: Tambahkan `rearmDraw()`** — `js/draw-tools.js`, tepat sebelum `function delHooks()`

```js
// Keep drawing mode: setelah objek SELESAI, arm ulang tool yang sama.
//
// ASYNC (setTimeout 0) dan bukan panggilan langsung: onDrawEnd masih berada di dalam dispatch event
// klinecharts untuk overlay yang baru selesai — membuat overlay baru di detik itu mengacak state
// internalnya. Dua guard di dalam callback bukan hiasan: dalam jeda satu tick itu pengguna bisa
// mematikan toggle atau meng-arm tool lain.
//
// `instant` TAK PERNAH diteruskan: untuk H/V, rearm ber-instant akan menjatuhkan garis lagi di
// posisi kursor yang sama, seketika, berantai. Yang benar = tool kembali armed, garis berikutnya
// jatuh saat pengguna mengklik.
function rearmDraw(){
  if(!keepDrawOn || !lastDrawTool) return;
  const t=lastDrawTool;
  if(t.name==='measure') return;   // ephemeral: objeknya dibuang mousedown berikutnya (js/measure.js)
  setTimeout(()=>{ if(keepDrawOn && !inProgressId) createDraw(t.name, t.btn); }, 0);
}
```

- [ ] **Step 4: Catat tool & bersihkan overlay telantar di `createDraw()`**

Ganti dua baris pertama isi `createDraw()` menjadi:

```js
function createDraw(name,btn,extra,instant){
  track('draw',{tool:name});
  lastDrawTool={name,btn};             // siapa yang di-rearm bila keep drawing nyala
  // Buang gambar in-progress yang telantar sebelum memulai yang baru. Sebelum keep-drawing ini
  // jarang terjadi (arm tool A lalu B tanpa menggambar); dengan keep-drawing "tool selalu armed"
  // membuatnya jalur biasa — mis. Alt+H lalu Alt+H lagi.
  if(inProgressId) try{ cancelInProgressDraw(); }catch(_){}
  try{ clearMeasure(); }catch(_){}   // gestur baru → hasil ukur sebelumnya tak relevan (js/measure.js)
```

- [ ] **Step 5: Panggil `rearmDraw()` di dua titik "selesai"**

`onDrawEnd`, ganti baris penutupnya:

```js
    inProgressId=null; disarmIcons(); try{hideMagDot();}catch(_){} scheduleSaveDraws(); rearmDraw(); return false; },
```

Cabang instant-drop di `createDraw()`:

```js
      if(dropped){   // sudah jadi (bukan mode gambar): onDrawEnd TAK terpanggil → tangani manual
        inProgressId=null; disarmIcons();
        try{ applyXDateFlag(chart.getOverlayById(id)); }catch(_){}   // spt jalur restore
        selectedId=id; scheduleSaveDraws();                          // pilih + persist + catat history utk undo
        rearmDraw();                                                 // keep drawing: tool siap lagi (non-instant)
      }
```

- [ ] **Step 6: Jalankan test → harus LULUS**

Run: `npx playwright test tests/smoke/keep-drawing.spec.js --project=hermetic`
Expected: 6 PASS.

- [ ] **Step 7: Commit**

```bash
git add js/draw-tools.js tests/smoke/keep-drawing.spec.js
git commit -m "feat(draw): arm ulang tool setelah objek jadi saat keep drawing nyala

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Dokumentasi & verifikasi akhir

**Files:**
- Modify: `docs/drawing-tools-gap-plan.md` (T1.2 selesai)
- Modify: `tests/README.md` (catatan: toggle harus dianggap MATI oleh test lain)
- Modify: `ROADMAP.md` (lokal, tak ter-commit — tetap diperbarui untuk konsistensi catatan)

- [ ] **Step 1: Tandai T1.2 di `docs/drawing-tools-gap-plan.md`**

```markdown
| T1.2 | ~~**Keep drawing mode**~~ — ✅ **SELESAI** 2026-07-31 | Tool selalu `disarmIcons()` setelah objek jadi → gambar 5 zona = 5× klik rail | `keepDrawOn` + `rearmDraw()` (`js/draw-tools.js`) + tombol `#keepDrawBtn` (pensil+gembok, pola `magBtn`). Default mati, persist `br_keepdraw`. Spec: `docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md` |
```

- [ ] **Step 2: Catat di `tests/README.md`** (setelah catatan measure)

```markdown
Tambahan 3: **keep drawing mode default MATI** (`keepDrawOn`, tombol `#keepDrawBtn`). Banyak test
menunggu `inProgressId == null` setelah objek jadi; itu benar HANYA saat toggle mati. Kalau sebuah
test menyalakannya, matikan lagi sebelum memakai `drawTool()`/`measureParity()`.
```

- [ ] **Step 3: Verifikasi penuh**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: seluruh smoke PASS (44 lama + 6 baru).

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: PASS — wajib di sini karena `createDraw`/`onDrawEnd` milik semua tool ikut berubah.

- [ ] **Step 4: Commit, PR, merge**

```bash
git add docs/drawing-tools-gap-plan.md tests/README.md
git commit -m "docs: tandai keep drawing mode selesai (T1.2) & catat default mati di tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin zihar/zihar/feat/keep-drawing-mode
gh pr create --base main --title "feat(draw): keep drawing mode (Stay in Drawing Mode ala TradingView)" --body "…"
```

Setelah CI hijau: `scripts/merge-pr.sh <n>`. Go-live tetap MANUAL (Actions → Release).
**Jangan `git add -A`** — folder `scratchpad/` sudah di-`.gitignore` sejak PR #167, tapi tetap add per-file.
