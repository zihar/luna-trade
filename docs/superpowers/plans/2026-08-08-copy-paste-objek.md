# Copy/Paste Objek Gambar (A3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Ctrl/⌘+C` menyalin objek gambar yang terpilih; `Ctrl/⌘+V` (dan item **Paste** di menu klik-kanan chart) menempatkan salinannya di posisi kursor, lintas instrumen & timeframe.

**Architecture:** Satu modul baru `js/draw-copy-paste.js` memegang clipboard aplikasi (`drawClip`, variabel memori) berisi deskripsi objek + **offset piksel** tiap titik relatif titik ke-1. Paste mengubah kursor+offset jadi anchor lewat jalur yang identik dengan `instantDropPoint`, lalu membuat overlay lewat `createFromDesc()` — inti `cloneOverlay` yang dipecah keluar di Task 1 supaya bisa dipakai clipboard yang objek sumbernya mungkin sudah tak ada. Pemanggil disisipkan lewat gerbang kecil di `js/keyboard.js` dan `js/context-menu.js`.

**Tech Stack:** JavaScript classic script (tanpa modul/bundler), klinecharts@9.8.10 (dipin lewat CDN), Playwright E2E (`--project=hermetic`).

**Spec:** `docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md` — baca dulu; setiap keputusan di plan ini berasal dari sana.

## Global Constraints

- **Teks UI bahasa Inggris.** Label menu, tooltip, apa pun yang tampil ke pengguna. Komentar kode & pesan commit boleh Indonesian (`CLAUDE.md`).
- **Komentar kode menjelaskan KENAPA**, bukan apa — ikuti kepadatan & gaya `js/draw-clone.js` / `js/magnet-temp.js`. Setiap gerbang yang tampak aneh wajib punya satu kalimat alasan.
- **Modul baru WAJIB dapat entri `SENTINEL`** di `tests/smoke/boot-integrity.spec.js`. Tanpa itu smoke merah — itu penjaga yang memang dipasang untuk ini.
- **Tanpa baris `TOOL_SPEC`** di `tests/helpers/spec.js`: ini gestur, bukan tool gambar baru.
- **Toleransi presisi drawing ≤1px** (kebijakan opsi A suite E2E). Kalau assertion meleset, cari sebabnya — jangan longgarkan angkanya.
- **Perintah test WAJIB pakai `--project=hermetic`**, bukan `npm test`.
- Branch sudah ada: `zihar/zihar/feat/copy-paste-objek` (spec sudah di-commit di sana, `974b64f`). Commit conventional Indonesian + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pecah `cloneOverlay` jadi deskripsi + pembuat (refactor murni)

Clipboard bisa hidup lebih lama dari objek sumbernya (objek dihapus, atau instrumen berganti sehingga overlay-nya tak ada lagi), sedangkan `cloneOverlay(id, pts)` membaca sumbernya lewat `chart.getOverlayById(id)`. Task ini memecah intinya keluar **tanpa mengubah perilaku apa pun** — jaringnya adalah suite clone yang sudah ada.

**Files:**
- Modify: `js/draw-clone.js:20-43`
- Test: `tests/drawing/81-clone-drag.spec.js` (yang sudah ada — harus tetap hijau, tak diubah)

**Interfaces:**
- Produces:
  - `descOf(id) → {name, styles, extendData, objStyle, points} | null` — deskripsi objek yang berdiri sendiri
  - `createFromDesc(desc, pts) → newId | null` — membuat overlay dari deskripsi; `pts` wajib berisi titik final
  - `cloneOverlay(id, pts) → newId | null` — **tanda tangan tak berubah**, kini tipis di atas dua fungsi di atas

- [ ] **Step 1: Ganti badan `cloneOverlay` di `js/draw-clone.js`**

Ganti seluruh blok dari komentar `// Salin objek \`id\` menjadi overlay baru…` sampai akhir berkas dengan:

```js
// Deskripsi objek yang BERDIRI SENDIRI — cukup untuk membuat ulang objek tanpa objek aslinya.
// Dipisah dari createFromDesc karena clipboard (js/draw-copy-paste.js) bisa hidup lebih lama dari
// objeknya: objek dihapus, atau instrumen berganti sehingga overlay-nya sudah tak ada.
function descOf(id){
  const o=chart.getOverlayById(id); if(!o||!o.points||!o.points.length) return null;
  return {name:o.name, styles:o.styles||null, extendData:o.extendData,
          objStyle:objStyle[id]?Object.assign({},objStyle[id]):null, points:o.points};
}

// Buat overlay baru dari deskripsi, dengan titik `pts` (wajib — pemanggil yang menentukan posisi).
// Mengembalikan id objek baru, atau null bila gagal.
function createFromDesc(desc, pts){
  if(!desc||!pts||!pts.length) return null;
  const base={name:desc.name, points:pts.map(p=>Object.assign({},p))};
  if(desc.extendData!==undefined) base.extendData=desc.extendData;   // teks "Add text" ikut tersalin
  if(desc.styles) base.styles=desc.styles;
  // delHooks(): salinan harus punya hook yang SAMA dgn objek biasa (drag presisi sub-bar, magnet,
  // kunci sudut, simpan-otomatis). Tanpa itu ia jadi objek kelas dua yang perilakunya beda.
  const nid=chart.createOverlay(Object.assign(base, delHooks()));
  if(!nid) return null;
  drawIds.push(nid);
  // Gaya per-objek hidup di peta terpisah (objStyle), jadi ia tak ikut lewat createOverlay.
  // Pola override-setelah-set menyusul js/draw-persist.js: overlay custom membaca gayanya saat
  // render, jadi ia perlu satu putaran render lagi; garis built-in sudah membawa `styles` di atas.
  if(desc.objStyle){ objStyle[nid]=Object.assign({}, desc.objStyle);
    if(!BUILTIN_LINE[desc.name]) try{ chart.overrideOverlay({id:nid, points:base.points}); }catch(_){} }
  return nid;
}

// Salin objek `id` di titik `pts` (default: titik objek itu sendiri).
//
// `pts` sengaja bisa dioper: pemanggilnya (drag) sudah memegang snapshot posisi AWAL gestur, dan
// itu yang harus ditinggalkan — membaca o.points di sini akan bergantung pada apakah drag sudah
// sempat menulis titik baru atau belum.
function cloneOverlay(id, pts){
  const d=descOf(id); if(!d) return null;
  return createFromDesc(d, pts||d.points);
}
```

- [ ] **Step 2: Jalankan suite clone — harus tetap hijau**

Run: `npx playwright test tests/drawing/81-clone-drag.spec.js --project=hermetic`
Expected: **8 passed** (7 test + 1 varian modifier). Refactor ini tak boleh mengubah satu pun perilaku; kalau ada yang merah, `descOf`/`createFromDesc` menyimpang dari badan lama — bandingkan baris per baris dengan `git show HEAD:js/draw-clone.js`.

- [ ] **Step 3: Commit**

```bash
git add js/draw-clone.js
git commit -m "$(cat <<'EOF'
refactor(draw): pecah cloneOverlay jadi descOf + createFromDesc

Clipboard copy/paste bisa hidup lebih lama dari objek sumbernya, jadi
inti pembuat overlay harus bisa dipanggil dari DESKRIPSI, bukan dari id.
Tanda tangan cloneOverlay(id, pts) tak berubah — jalur drag clone di
draw-tools.js tak tersentuh.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Modul clipboard — `copyOverlay()` + `pasteOverlayAt()`

Inti fitur, diuji lewat API (tanpa hotkey — itu Task 3).

**Files:**
- Create: `js/draw-copy-paste.js`
- Modify: `index.html:432` (tambah `<script>` **sesudah** `draw-clone.js`)
- Modify: `tests/smoke/boot-integrity.spec.js:93-95` (entri `SENTINEL`)
- Test: `tests/drawing/83-copy-paste.spec.js` (baru)

**Interfaces:**
- Consumes: `descOf(id)`, `createFromDesc(desc, pts)` (Task 1); `anchorPx(p)` (`js/draw-constrain.js:29`); `pxToValue(y)`, `fracAnchorFromPx(x)`, `xAnchorFromPx(x)`, `snapTimeToBar(t)` (`js/util.js`); `subBar(name)` (`js/replay-forming-bar.js:110`); `selectedId`, `scheduleSaveDraws()`.
- Produces:
  - `drawClip` — `{name, styles, extendData, objStyle, off:[{dx,dy}]} | null`
  - `copyOverlay() → boolean`
  - `pasteOverlayAt(px, py) → newId | null` — `px/py` **container-relative** terhadap `#chart`
  - `pastePoint() → {x,y} | null` — titik jatuh untuk hotkey (dipakai Task 3)

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/drawing/83-copy-paste.spec.js`:

```js
// Ctrl/⌘+C & Ctrl/⌘+V objek gambar — clipboard aplikasi, paste mendarat di kursor.
// Spec: docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

/** Gambar satu trendline di posisi yang bisa diprediksi, kembalikan objek + pixel titiknya. */
async function drawLine(page, rect) {
  const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
  const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  const obj = (await overlays(page))[0];
  return { obj, px: await toPixels(page, obj.points) };
}

/** Objek selain `id` — yang baru lahir dari paste. */
async function otherThan(page, id) {
  const all = await overlays(page);
  const o = all.find((x) => x.id !== id);
  return o ? { obj: o, px: await toPixels(page, o.points) } : null;
}

test.describe('copy/paste objek: API', () => {
  test('copy lalu paste → 2 objek, bentuk sama, titik-1 mendarat di titik paste', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    expect(await page.evaluate(() => copyOverlay()), 'copyOverlay harus true untuk objek terpilih').toBe(true);

    const target = { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.7) };
    await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'paste harus menambah satu objek').toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - target.x), 'titik-1 tak mendarat di X titik paste').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - target.y), 'titik-1 tak mendarat di Y titik paste').toBeLessThanOrEqual(1);
    // Bentuk = jarak antar titik dalam PIKSEL, persis yang direkam saat copy.
    expect(Math.abs((baru.px[1].x - baru.px[0].x) - (px[1].x - px[0].x)), 'lebar bentuk berubah').toBeLessThanOrEqual(1);
    expect(Math.abs((baru.px[1].y - baru.px[0].y) - (px[1].y - px[0].y)), 'tinggi bentuk berubah').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  test('tanpa objek terpilih: copy gagal & paste tak membuat apa pun', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.keyboard.press('Escape'); // lepas pilihan
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => selectedId), 'prasyarat: tak ada objek terpilih').toBeNull();

    expect(await page.evaluate(() => copyOverlay()), 'copy tanpa seleksi harus false').toBe(false);
    expect(await page.evaluate(() => drawClip), 'clipboard tak boleh terisi').toBeNull();
    expect(await page.evaluate(() => pasteOverlayAt(50, 50)), 'paste dgn clipboard kosong harus null').toBeNull();
    expect(await overlays(page), 'tak boleh ada objek baru').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('salinan mewarisi gaya & teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    await page.evaluate((id) => {
      setObjStyle(id, { color: '#ff00aa', size: 4, style: 'dashed' });
      chart.overrideOverlay({ id, extendData: 'HALO' });
    }, obj.id);
    await page.waitForTimeout(120);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(80, 80); });
    await page.waitForTimeout(150);

    const baru = await otherThan(page, obj.id);
    const salinan = await page.evaluate((id) => {
      const o = chart.getOverlayById(id);
      return { style: objStyle[id] || null, text: o && typeof o.extendData === 'string' ? o.extendData : null };
    }, baru.obj.id);
    expect(salinan.style, 'salinan kehilangan gaya per-objek').toBeTruthy();
    expect(salinan.style.color, 'warna tak tersalin').toBe('#ff00aa');
    expect(salinan.style.size, 'tebal tak tersalin').toBe(4);
    expect(salinan.text, 'teks tak tersalin').toBe('HALO');
    // `lock` sengaja TIDAK ikut tersalin: salinan yang lahir terkunci hanya menjebak.
    expect(await page.evaluate((id) => !!(chart.getOverlayById(id) || {}).lock, baru.obj.id), 'hasil paste tak boleh terkunci').toBe(false);
    assertNoPageErrors(page);
  });

  test('paste dua kali di dua posisi → 3 objek, masing-masing di tempatnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const a = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.25) };
    const b = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.75) };
    const ids = await page.evaluate(([pa, pb]) => {
      copyOverlay();
      return [pasteOverlayAt(pa.x, pa.y), pasteOverlayAt(pb.x, pb.y)];
    }, [a, b]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'dua paste harus menghasilkan 3 objek').toHaveLength(3);
    expect(ids[0], 'paste pertama tak mengembalikan id').toBeTruthy();
    expect(ids[1], 'paste kedua tak mengembalikan id').toBeTruthy();
    expect(ids[0], 'dua paste menghasilkan id yang sama').not.toBe(ids[1]);
    const all = await overlays(page);
    for (const [id, t] of [[ids[0], a], [ids[1], b]]) {
      const p = await toPixels(page, all.find((o) => o.id === id).points);
      expect(Math.abs(p[0].y - t.y), `objek ${id} tak mendarat di Y-nya`).toBeLessThanOrEqual(1);
    }
    assertNoPageErrors(page);
  });

  test('objek hasil paste TERPILIH, tanpa membuka editor teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const nid = await page.evaluate(() => { copyOverlay(); return pasteOverlayAt(90, 90); });
    await page.waitForTimeout(400); // editor teks inline muncul lewat timer 220ms — beri ruang lewat

    expect(await page.evaluate(() => selectedId), 'objek hasil paste harus terpilih').toBe(nid);
    expect(await page.locator('textarea.text-editor').count(), 'paste tak boleh membuka editor teks inline').toBe(0);
    assertNoPageErrors(page);
  });

  test('hasil paste selamat dari reload & bisa di-undo', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(70, 70); });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(2);
    await page.waitForTimeout(600); // scheduleSaveDraws (350ms) harus sempat menulis

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(1);

    await page.keyboard.press('Control+Shift+z'); // redo → kembali 2
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(2);
    await page.waitForTimeout(600);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined',
      null,
      { timeout: 20000 }
    );
    await expect.poll(async () => (await overlays(page)).length, { timeout: 5000 }).toBe(2);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic`
Expected: **6 failed**, semuanya karena `copyOverlay is not defined` / `pasteOverlayAt is not defined`.

- [ ] **Step 3: Buat `js/draw-copy-paste.js`**

```js
// [copy/paste] Ctrl/⌘+C menyalin objek TERPILIH ke clipboard aplikasi; Ctrl/⌘+V menaruh salinannya
// di posisi kursor. Rancangan & keputusannya:
// docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md
//
// Bentuk objek direkam sebagai offset PIKSEL antar titik (saat copy), BUKAN delta bar/harga: itu
// satu-satunya satuan yang tetap masuk akal saat di-paste ke instrumen lain — delta harga 0.0050
// milik EUR tak berarti apa-apa di XAU. Konsekuensi yang diterima: paste sesudah zoom berubah
// menghasilkan objek yang mencakup lebih banyak/sedikit bar — ia mendarat seperti yang TERLIHAT.
//
// Clipboard hidup di memori saja: ia sengaja tak selamat dari reload (clipboard yang mengingat
// objek dari kemarin mengagetkan, untungnya tipis).
let drawClip=null;   // {name, styles, extendData, objStyle, off:[{dx,dy}]}

// Salin objek TERPILIH. Hanya `selectedId` — hover sengaja TIDAK dipakai (walau Delete memakainya):
// menyalin objek yang cuma kelewatan kursor tak punya niat di baliknya. Objek terkunci boleh
// disalin: menyalin tak mengubah apa pun.
function copyOverlay(){
  const id=selectedId; if(!id) return false;
  const d=descOf(id); if(!d) return false;
  const px=d.points.map(anchorPx);
  if(px.some(p=>!p)) return false;   // ada titik yang tak terkonversi → jangan simpan bentuk separuh
  drawClip={ name:d.name, styles:d.styles, extendData:d.extendData, objStyle:d.objStyle,
             off:px.map(p=>({dx:p.x-px[0].x, dy:p.y-px[0].y})) };
  return true;
}

// Tempatkan isi clipboard sehingga TITIK KE-1 mendarat di (px,py) container-relative terhadap
// #chart. Mengembalikan id objek baru, atau null.
function pasteOverlayAt(px,py){
  if(!drawClip) return null;
  const pts=[];
  for(const o of drawClip.off){
    const x=px+o.dx, y=py+o.dy;
    const v=pxToValue(y); if(v==null) return null;
    // Jalur anchor IDENTIK dgn instantDropPoint (js/draw-tools.js): tool sub-bar → dataIndex
    // PECAHAN supaya mendarat presisi, BAR_ANCHOR → timestamp lalu snap ke bar (x-nya memang
    // harus align ke candle). Menyimpang dari jalur itu = salinan yang "loncat" saat dibuat.
    const xa = subBar(drawClip.name) ? fracAnchorFromPx(x) : xAnchorFromPx(x); if(!xa) return null;
    const np=Object.assign({value:v}, xa);
    if(drawClip.name==='verticalStraightLine' && np.timestamp!=null) np.timestamp=snapTimeToBar(np.timestamp);
    pts.push(np);
  }
  const nid=createFromDesc(drawClip, pts);
  if(!nid) return null;
  // Dua hal yang clone dapat GRATIS dari drag-nya, dan paste harus kerjakan sendiri:
  scheduleSaveDraws();   // tanpa ini objek hilang saat reload & Ctrl+Z tak bisa membatalkannya
  selectPastedOverlay(nid);
  return nid;
}

// Pilih objek yang baru di-paste — kebalikan deselectOverlay() (js/draw-tools.js), lewat jalur
// internal klinecharts@9.8.10 yang sama.
//
// onClick di-lepas SEMENTARA karena setClickInstanceInfo memanggilnya, dan onClick kita punya dua
// efek samping yang keliru di sini: mode eraser akan langsung MENGHAPUS objek yang baru lahir, dan
// objek kosong yang kursornya kebetulan di atas placeholder akan membuka editor teks inline.
// Yang kita mau cuma state seleksinya; onSelected (yang menyetel selectedId) tetap terpanggil.
function selectPastedOverlay(id){
  try{
    const inst=chart.getOverlayById(id); if(!inst) return;
    const oc=inst.onClick; inst.onClick=null;
    try{
      chart.getChartStore().getOverlayStore().setClickInstanceInfo(
        {paneId:'candle_pane', instance:inst, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}, {}
      );
    } finally { inst.onClick=oc; }
  }catch(_){}   // internal berubah → paste tetap jadi, cuma tak terpilih
}

// Titik jatuh untuk Ctrl/⌘+V: posisi kursor bila ia di atas chart, selain itu TENGAH area chart.
//
// Gerbangnya `ptrOverChart`, BUKAN membandingkan lastPtr dengan rect: lastPtr hanya di-update
// mousemove DI DALAM #chart, jadi ia tak pernah berisi koordinat di luar dan cek rect tak akan
// pernah gugur (Temuan 4 E2E — fallback instantDropPoint pernah jadi kode mati justru karena itu).
// Cek rect tetap dipertahankan sebagai lapis kedua, mis. chart menyusut sesudah pointer tercatat.
//
// Tengah chart dipilih sebagai fallback, bukan "posisi asal + offset": sesudah clipboard lintas
// instrumen, posisi asal bisa tak ada di layar — bahkan tak ada di data instrumen ini.
function pastePoint(){
  const el=$('#chart'); if(!el) return null;
  const r=el.getBoundingClientRect();
  if(ptrOverChart){
    const x=lastPtr.x-r.left, y=lastPtr.y-r.top;
    if(x>=0 && y>=0 && x<=r.width && y<=r.height) return {x,y};
  }
  return {x:r.width/2, y:r.height/2};
}
```

- [ ] **Step 4: Muat modulnya**

Di `index.html`, sesudah baris `<script src="/js/draw-clone.js"></script>` (baris 432), sisipkan:

```html
<script src="/js/draw-copy-paste.js"></script>
```

Urutan wajib **sesudah** `draw-clone.js` (memakai `descOf`/`createFromDesc`) dan sesudah `draw-constrain.js` (memakai `anchorPx`).

- [ ] **Step 5: Tambah entri SENTINEL**

Di `tests/smoke/boot-integrity.spec.js`, tepat sesudah baris `'magnet-temp.js': 'magnetActive',`:

```js
  'draw-copy-paste.js': 'copyOverlay',
```

- [ ] **Step 6: Jalankan test — harus LULUS**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic`
Expected: **6 passed**.

Kalau test "titik-1 mendarat di titik paste" meleset >1px: periksa apakah `subBar()` untuk `trendline` benar bernilai true (kalau tidak, jalurnya jatuh ke `xAnchorFromPx` dan X ter-snap ke pusat bar — itu bug di gerbangnya, bukan alasan melonggarkan toleransi).

- [ ] **Step 7: Commit**

```bash
git add js/draw-copy-paste.js index.html tests/smoke/boot-integrity.spec.js tests/drawing/83-copy-paste.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): clipboard objek gambar — copyOverlay & pasteOverlayAt

Bentuk direkam sebagai offset PIKSEL saat copy, jadi paste tetap benar
lintas instrumen & sesudah zoom berubah. Paste memanggil scheduleSaveDraws
sendiri (clone dapat itu dari drag-nya) dan memilih objek barunya, dengan
onClick dilepas sementara supaya mode eraser tak menghapusnya seketika.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Hotkey `Ctrl/⌘+C` & `Ctrl/⌘+V`

**Files:**
- Modify: `js/keyboard.js:48-52` (cabang `if(e.ctrlKey||e.metaKey)`)
- Test: `tests/drawing/83-copy-paste.spec.js` (tambah `describe` kedua)

**Interfaces:**
- Consumes: `copyOverlay()`, `pasteOverlayAt(px,py)`, `pastePoint()`, `drawClip` (Task 2)

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `tests/drawing/83-copy-paste.spec.js` (di luar `describe` yang sudah ada):

```js
test.describe('copy/paste objek: hotkey', () => {
  for (const mod of ['Control', 'Meta']) {
    test(`${mod}+C lalu ${mod}+V → salinan mendarat di kursor`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      const { obj, px } = await drawLine(page, rect);

      await page.keyboard.press(`${mod}+c`);
      expect(await page.evaluate(() => drawClip != null), `${mod}+C tak mengisi clipboard`).toBe(true);

      const target = { x: Math.round(rect.width * 0.22), y: Math.round(rect.height * 0.72) };
      await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 4 });
      await page.keyboard.press(`${mod}+v`);
      await page.waitForTimeout(200);

      expect(await overlays(page), `${mod}+V harus menambah satu objek`).toHaveLength(2);
      const baru = await otherThan(page, obj.id);
      expect(Math.abs(baru.px[0].x - target.x), 'tak mendarat di X kursor').toBeLessThanOrEqual(1);
      expect(Math.abs(baru.px[0].y - target.y), 'tak mendarat di Y kursor').toBeLessThanOrEqual(1);
      expect(Math.abs((baru.px[1].x - baru.px[0].x) - (px[1].x - px[0].x)), 'bentuk berubah').toBeLessThanOrEqual(1);
      assertNoPageErrors(page);
    });
  }

  test('Ctrl+V tanpa copy: tak terjadi apa-apa', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 4 });
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    expect(await overlays(page), 'paste dgn clipboard kosong tak boleh membuat objek').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('kursor di LUAR chart: salinan mendarat di tengah chart', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    await page.keyboard.press('Control+c');
    // Keluar dari #chart → ptrOverChart harus padam (mouseleave), bukan sekadar koordinat berubah.
    await page.mouse.move(rect.x + rect.width / 2, Math.max(2, rect.y - 30), { steps: 6 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => ptrOverChart), 'prasyarat: pointer harus tercatat di luar chart').toBe(false);

    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    expect(await overlays(page)).toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - rect.width / 2), 'tak mendarat di tengah X').toBeLessThanOrEqual(2);
    expect(Math.abs(baru.px[0].y - rect.height / 2), 'tak mendarat di tengah Y').toBeLessThanOrEqual(2);
    assertNoPageErrors(page);
  });

  // Menyalin harga dari panel trades tak boleh diam-diam berubah jadi menyalin objek gambar.
  test('ada teks terseleksi di halaman: Ctrl+C dibiarkan ke browser', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.evaluate(() => {
      const s = document.createElement('span');
      s.id = 'e2e-sel';
      s.textContent = 'harga 1.2345';
      document.body.appendChild(s);
      const r = document.createRange();
      r.selectNodeContents(s);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });

    await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => drawClip), 'clipboard objek tak boleh terisi saat ada teks terseleksi').toBeNull();
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic -g "hotkey"`
Expected: **4 failed** (2 varian modifier + 2 test lain) karena tak ada yang menangani `Ctrl+C`/`Ctrl+V`; test "tanpa copy" mungkin lulus kebetulan — itu wajar, ia menjaga regresi.

- [ ] **Step 3: Sisipkan hotkey di `js/keyboard.js`**

Di dalam blok `if(e.ctrlKey||e.metaKey){ … }`, tepat sesudah baris `if(k==='y'){ e.preventDefault(); redoDraw(); return; }`:

```js
    // copy/paste objek gambar (js/draw-copy-paste.js). Teks yang sedang terseleksi menang:
    // menyalin harga dari panel trades tak boleh berubah jadi menyalin objek gambar.
    if(k==='c'){ let sel=''; try{ sel=String(getSelection()||''); }catch(_){}
      if(sel.trim()) return;
      if(copyOverlay()) e.preventDefault(); return; }
    if(k==='v'){ const p=pastePoint(); if(p && pasteOverlayAt(p.x,p.y)) e.preventDefault(); return; }
```

`e.preventDefault()` hanya bila benar-benar terjadi sesuatu — kalau tak ada yang tersalin/ter-paste, biarkan browser mengurus tombolnya seperti biasa.

- [ ] **Step 4: Jalankan test — harus LULUS**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic`
Expected: **10 passed** (6 dari Task 2 + 4 hotkey).

- [ ] **Step 5: Commit**

```bash
git add js/keyboard.js tests/drawing/83-copy-paste.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): hotkey Ctrl/⌘+C & Ctrl/⌘+V untuk objek gambar

Paste mendarat di kursor; kursor di luar chart → tengah chart, digerbangi
ptrOverChart (bukan cek rect, yang tak akan pernah gugur). Ctrl+C mengalah
pada teks yang sedang terseleksi di halaman.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Item **Paste** di menu klik-kanan chart

TradingView punya item Paste di menu klik-kanan chart, dan Luna sudah punya menu itu — jadi ini juga yang menggantikan toast "Copied" sebagai penanda bahwa clipboard berisi.

**Files:**
- Modify: `js/context-menu.js:54-59` (daftar `items` di handler `contextmenu`)
- Test: `tests/drawing/83-copy-paste.spec.js` (tambah `describe` ketiga)

**Interfaces:**
- Consumes: `drawClip`, `pasteOverlayAt(px,py)` (Task 2); `showCtx(x,y,items)` dengan `{label, disabled, fn}` (`js/context-menu.js:6`)

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `tests/drawing/83-copy-paste.spec.js`:

```js
test.describe('copy/paste objek: menu klik-kanan', () => {
  /** Klik-kanan di area kosong chart, kembalikan daftar item menu yang terlihat. */
  async function openMenuAt(page, rect, p) {
    await page.mouse.click(rect.x + p.x, rect.y + p.y, { button: 'right' });
    await page.waitForTimeout(200);
    return page.$$eval('.ctxmenu .ctxitem', (els) =>
      els.map((el) => ({ label: el.textContent, disabled: el.classList.contains('disabled') }))
    );
  }

  test('item Paste redup saat clipboard kosong, aktif sesudah copy', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const kosong = { x: Math.round(rect.width * 0.12), y: Math.round(rect.height * 0.15) };

    let items = await openMenuAt(page, rect, kosong);
    let paste = items.find((i) => /paste/i.test(i.label));
    expect(paste, 'item Paste tak ada di menu klik-kanan').toBeTruthy();
    expect(paste.disabled, 'Paste harus redup saat clipboard kosong').toBe(true);

    // Tutup menu dgn klik kiri (hideCtx dipasang di event `click` window — Escape tak menutupnya),
    // supaya menu yang masih terbuka tak menelan klik pertama saat menggambar.
    await page.mouse.click(rect.x + Math.round(rect.width * 0.8), rect.y + Math.round(rect.height * 0.85));
    await page.waitForTimeout(150);
    const { obj } = await drawLine(page, rect);
    await page.keyboard.press('Control+c');

    items = await openMenuAt(page, rect, kosong);
    paste = items.find((i) => /paste/i.test(i.label));
    expect(paste.disabled, 'Paste harus aktif sesudah copy').toBe(false);
    expect(await page.evaluate((id) => selectedId === id, obj.id), 'prasyarat: objek yang disalin memang terpilih').toBe(true);
    assertNoPageErrors(page);
  });

  test('Paste dari menu menempatkan objek di titik yang diklik-kanan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);
    await page.keyboard.press('Control+c');

    const titik = { x: Math.round(rect.width * 0.14), y: Math.round(rect.height * 0.2) };
    await page.mouse.click(rect.x + titik.x, rect.y + titik.y, { button: 'right' });
    await page.waitForTimeout(200);
    const idx = await page.$$eval('.ctxmenu .ctxitem', (els) => els.findIndex((el) => /paste/i.test(el.textContent)));
    expect(idx, 'item Paste tak ketemu').toBeGreaterThanOrEqual(0);
    await page.locator('.ctxmenu .ctxitem').nth(idx).click();
    await page.waitForTimeout(250);

    expect(await overlays(page), 'Paste dari menu harus menambah objek').toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - titik.x), 'tak mendarat di X titik klik-kanan').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - titik.y), 'tak mendarat di Y titik klik-kanan').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic -g "menu klik-kanan"`
Expected: **2 failed** — `item Paste tak ada di menu klik-kanan`.

- [ ] **Step 3: Tambah item di `js/context-menu.js`**

Di handler `contextmenu`, sesudah blok alert (`items.push({label:`🔔 Create alert at …`…})`) dan **sebelum** `if(drawIds.length){ … }`:

```js
  // Paste objek gambar di titik yang diklik — pintu masuk kedua selain Ctrl/⌘+V, sekaligus
  // penanda satu-satunya bahwa clipboard berisi (Ctrl+C sengaja tak memberi toast, ikut TV).
  items.push({label:'📋 Paste drawing', disabled:!drawClip, fn:()=>{
    const rr=$('#chart').getBoundingClientRect();
    pasteOverlayAt(e.clientX-rr.left, e.clientY-rr.top);
  }});
```

- [ ] **Step 4: Jalankan seluruh berkas test — harus LULUS**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js --project=hermetic`
Expected: **12 passed**.

- [ ] **Step 5: Commit**

```bash
git add js/context-menu.js tests/drawing/83-copy-paste.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): item Paste di menu klik-kanan chart

Pintu masuk kedua selain Ctrl/⌘+V — dan satu-satunya penanda bahwa
clipboard berisi, karena Ctrl+C sengaja tanpa toast (mengikuti TV).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verifikasi & PR

**Files:** tak ada perubahan kode; hanya menjalankan gerbang & membuka PR.

- [ ] **Step 1: Smoke (gerbang wajib sebelum push)**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: **22 passed** (~40 detik). Kalau `boot-integrity` merah dengan "belum punya entri di SENTINEL", entri Task 2 Step 5 belum masuk.

- [ ] **Step 2: Regresi tetangga terdekat**

Run: `npx playwright test tests/drawing/81-clone-drag.spec.js tests/drawing/83-copy-paste.spec.js --project=hermetic`
Expected: **20 passed** (8 clone + 12 copy/paste). Suite penuh diserahkan ke CI saat push ke `main` — jangan bakar 5–7 menit lokal untuk sesuatu yang sudah otomatis.

- [ ] **Step 3: Verifikasi MANUAL lintas instrumen (tak tercakup E2E)**

Klaim "clipboard lintas instrumen" tak diuji suite hermetik: harness hanya menstub satu instrumen, dan menambah instrumen kedua hanya demi satu assertion tak sepadan. Karena itu diperiksa manual, dan **kegagalannya harus dilaporkan apa adanya** — bukan diasumsikan jalan karena "secara konstruksi benar":

1. `PORT=8765 ./luna-trade` (butuh `.env`), buka `localhost:8765`, login.
2. Gambar trendline di EUR_USD → klik objeknya → `⌘C`.
3. Ganti instrumen ke XAU_USD (harga jauh berbeda ordenya) → arahkan kursor ke tengah chart → `⌘V`.
4. Yang harus terlihat: garis dengan **bentuk & panjang layar yang sama**, mendarat di kursor, tak ada error di console.
5. Catat hasilnya di badan PR (satu kalimat). Kalau garisnya rata/tak terlihat, offset piksel tak terpakai — periksa `pxToValue` mengembalikan harga instrumen yang BARU.

- [ ] **Step 4: Push & buka PR**

```bash
git push -u origin zihar/zihar/feat/copy-paste-objek
gh pr create --base main --title "feat(draw): Ctrl/⌘+C & Ctrl/⌘+V objek gambar (A3)" --body "$(cat <<'EOF'
Menyalin objek gambar yang terpilih dan menempatkannya di posisi kursor —
lewat hotkey maupun item **Paste** di menu klik-kanan chart. Melengkapi clone
Ctrl+drag (#175/#177) yang hanya bisa menyalin sejauh satu gestur seret, pada
instrumen yang sama.

Bentuk objek direkam sebagai **offset piksel** saat copy, bukan delta bar/harga:
itu satu-satunya satuan yang tetap masuk akal lintas instrumen — delta harga
0.0050 milik EUR tak berarti apa-apa di XAU.

Spec: `docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md`
Test: `tests/drawing/83-copy-paste.spec.js` (12 test)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Tunggu CI hijau, lalu merge**

```bash
gh pr checks --watch
scripts/merge-pr.sh <nomor-pr>
```

Jangan `gh pr merge` langsung — skrip itu yang menolak PR dengan check merah/pending **dan** PR yang ketinggalan dari `main` (`CLAUDE.md` aturan 8).

- [ ] **Step 6: Go-live**

Merge ke `main` **tidak** berarti sampai ke pengguna sejak PR #162. Tunggu CI penuh 3 shard di push `main` hijau, lalu GitHub → Actions → **Release** → *Run workflow*. Verifikasi antrean kosong lagi sesudahnya: `git fetch && git log --oneline origin/release..origin/main`.
