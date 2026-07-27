# Gating Undangan "+ Add text" pada Rect Kecil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rectangle yang terlalu kecil untuk memuat label `+ Add text` tidak lagi menampilkan
label itu — dan tidak lagi mencuri klik yang dimaksudkan untuk memilih/melebarkan kotaknya.

**Architecture:** Dua tempat memakai ukuran tetap di atas objek berukuran bebas: figure teks
di `createPointFigures` rect dan hit-area `overPlaceholder()`. Satu pasang konstanta ambang
(`ADDTEXT_MIN_W/H`) mematikan keduanya bersamaan, dan hit-area yang tersisa dipotong ke dalam
kotak (`ADDTEXT_PAD`) agar klik di handle tepi tak salah terbaca. Konversi sudut rect →
pixel dipecah lebih dulu jadi satu helper (`rectBoxPx`) supaya gerbang visual dan gerbang
hit-area tak bisa menyimpang.

**Tech Stack:** `index.html` monolitik (classic script, tanpa build step), klinecharts 9.8.10
(UMD dari CDN), Playwright untuk E2E.

**Spec:** `docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md`

## Global Constraints

- Semua teks yang tampil ke pengguna berbahasa **Inggris**; komentar kode & pesan commit
  boleh Indonesian (`CLAUDE.md` → "Teks UI").
- Tanpa build step: `index.html` diedit langsung, reload browser langsung menampilkannya.
- Satu fitur = satu PR; branch dari & PR ke `main`; pola nama
  `zihar/zihar/<tipe>/<slug>`; commit conventional + trailer
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm test` hermetik: stub semua `/api` + fixture candle, tak butuh `.env`/OANDA/binary Go.
- Viewport test 1600×900 dengan `deviceScaleFactor: 1` (`playwright.config.js:29`) → CSS px
  = device px, jadi ambang px sama persis di kedua jalur konversi.
- Jangan ubah cabang teks nyata (`t!==''`) di rect: itu konten pengguna, bukan undangan.
- `trendline` dan `callout` **di luar cakupan** (lihat spec, bagian "Di luar cakupan").

## File Structure

- **Modify** `index.html` — tiga titik sentuh:
  - `~841` `showAddTextHint` + `overPlaceholder`: konstanta ambang & gerbang hit-area.
  - `~865` cabang placeholder di `createPointFigures` rect: gerbang visual.
  - `~3485` `overlayTextAnchor`: memakai helper `rectBoxPx` alih-alih menghitung sudut sendiri.
- **Modify** `tests/drawing/40-modal-text.spec.js` — satu test baru di dalam
  `test.describe('teks inline', …)`, tepat setelah test `rect kosong: hover menawarkan …`
  (berakhir di baris 180) dan sebelum `});` penutup describe di baris 181.

---

### Task 1: Satu sumber konversi kotak rect → pixel

Refactor tanpa perubahan perilaku. Dikerjakan lebih dulu karena Task 2 butuh ukuran kotak
dalam pixel di `overPlaceholder`, dan menghitungnya di sana dari nol berarti dua salinan
logika sudut rect yang bisa menyimpang (representasi titik rect pernah berubah: 2 titik →
8 setelah `expandBox`).

**Files:**
- Modify: `index.html:3485-3495` (`overlayTextAnchor`)
- Test: `tests/drawing/40-modal-text.spec.js` (test yang sudah ada dipakai sebagai jaring)

**Interfaces:**
- Consumes: `keyOf(p)`, `chart.convertToPixel`, `$('#chart')` — semuanya sudah ada.
- Produces:
  - `ptToClientPx(p) → {x,y} | null` — titik overlay `{value, timestamp|dataIndex}` menjadi
    pixel **client** (sudah ditambah offset `#chart`).
  - `rectBoxPx(o) → {cx,cy,w,h} | null` — kotak rect dalam pixel client: pusat + ukuran.
    `null` bila titik belum lengkap atau konversi gagal. Task 2 memakai `w`, `h`.

- [ ] **Step 1: Pindahkan pekerjaan ke branch bertipe `fix`**

Spec-nya sudah ter-commit di branch bernama `docs/…`, padahal PR ini akan berisi perbaikan
kode juga. Branch belum pernah di-push, jadi rename aman:

```bash
git branch -m zihar/zihar/fix/rect-addtext-small-box
git status --porcelain   # harus bersih kecuali untracked mml.pine & scratchpad/
```

- [ ] **Step 2: Jalankan test yang akan jadi jaring refactor ini, pastikan HIJAU dulu**

Refactor ini tak boleh mengubah apa pun. Yang membuktikannya adalah test yang menekan
`overlayTextAnchor` lewat jalur rect: klik tengah kotak besar → editor inline terbuka di
titik itu.

Run: `npx playwright test tests/drawing/40-modal-text.spec.js -g "rect kosong"`
Expected: PASS (1 passed). Kalau sudah merah sebelum disentuh, berhenti dan laporkan —
jangan refactor di atas dasar yang sudah rusak.

- [ ] **Step 3: Tambahkan dua helper tepat SEBELUM `function overlayTextAnchor(o){`**

```js
// titik overlay → pixel CLIENT (viewport), atau null bila konversi gagal.
function ptToClientPx(p){
  if(!p) return null;
  let px=null; try{ px=chart.convertToPixel(Object.assign(keyOf(p),{value:p.value}),{paneId:'candle_pane',absolute:true}); }catch(e){}
  if(Array.isArray(px)) px=px[0];
  if(!px) return null;
  const r=$('#chart').getBoundingClientRect();
  return {x:r.left+px.x, y:r.top+px.y};
}
// Kotak `rect` dalam pixel client: pusat + ukuran. Sudut diambil dari 2 titik berlawanan —
// TL & BR bila titiknya sudah mengembang jadi 8 (expandBox), atau 2 titik awal saat baru
// digambar. SATU sumber, dipakai bareng overlayTextAnchor & overPlaceholder: gerbang visual
// dan gerbang hit-area undangan "+ Add text" wajib sepakat soal ukuran kotak.
function rectBoxPx(o){
  const pts=(o&&o.points)||[]; if(pts.length<2) return null;
  const a=ptToClientPx(pts[0]), b=ptToClientPx(pts[pts.length>=8?4:1]); if(!a||!b) return null;
  return {cx:(a.x+b.x)/2, cy:(a.y+b.y)/2, w:Math.abs(b.x-a.x), h:Math.abs(b.y-a.y)};
}
```

- [ ] **Step 4: Alihkan cabang `rect` di `overlayTextAnchor` ke helper itu**

Ganti baris ini (`index.html:3491`, komentar di atasnya dibiarkan):

```js
  if(o.name==='rect' && pts.length>=2){ const a=toPx(pts[0]), b=toPx(pts[pts.length>=8?4:1]); if(a&&b) return {x:rect.left+(a.x+b.x)/2, y:rect.top+(a.y+b.y)/2}; }
```

menjadi:

```js
  if(o.name==='rect'){ const b=rectBoxPx(o); if(b) return {x:b.cx, y:b.cy}; }
```

Perilaku jatuh-ke-bawah dipertahankan: bila `rectBoxPx` mengembalikan `null` (titik belum
lengkap / konversi gagal), fungsi lanjut ke jalur generik `pts[0]` di bawahnya, sama seperti
sebelumnya. Jangan hapus `toPx` — cabang `trendline` & `callout` masih memakainya.

- [ ] **Step 5: Jalankan berkas test itu utuh, pastikan tetap hijau**

Run: `npx playwright test tests/drawing/40-modal-text.spec.js`
Expected: PASS, jumlah test sama seperti sebelum refactor.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
refactor(draw): satu sumber ukuran kotak rect dlm pixel (rectBoxPx)

Konversi 2 sudut rect → pixel dipecah jadi ptToClientPx + rectBoxPx supaya
gerbang visual & gerbang hit-area undangan "+ Add text" memakai angka yang
sama. Tanpa perubahan perilaku.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Ambang ukuran mematikan label & hit-area bersamaan

**Files:**
- Modify: `index.html:839-845` (konstanta + `overPlaceholder`)
- Modify: `index.html:865` (cabang placeholder `createPointFigures` rect)
- Test: `tests/drawing/40-modal-text.spec.js` (test baru, disisipkan di baris 180/181)

**Interfaces:**
- Consumes: `rectBoxPx(o) → {cx,cy,w,h} | null` dari Task 1; `showAddTextHint(overlay)`,
  `overlayTextAnchor(o)`, `lastPtr` yang sudah ada.
- Produces: konstanta `ADDTEXT_MIN_W = 90`, `ADDTEXT_MIN_H = 28`, `ADDTEXT_PAD = 8`.

- [ ] **Step 1: Tulis test yang gagal**

Sisipkan di `tests/drawing/40-modal-text.spec.js`, setelah test `rect kosong: hover
menawarkan "+ Add text", klik membuka editor inline` berakhir (baris 180) dan sebelum `});`
penutup `test.describe('teks inline', …)` di baris 181. `dblclickObject` sudah tersedia di
level modul berkas itu (baris 24) — tak perlu impor tambahan.

```js
  test('rect kecil: undangan "+ Add text" & hit-area-nya mati, teks tetap lewat modal', async ({ page }) => {
    // Kotak yang lebih sempit dari labelnya (~66px) membuat "+ Add text" meluber & menutupi
    // handle → kotak susah dilebarkan (ADDTEXT_MIN_W/H di index.html). Placeholder digambar
    // di canvas, jadi yang bisa dihakimi dari DOM adalah AKIBATNYA: klik di tengah kotak
    // kecil tak membuka editor inline, klik itu jatuh sebagai "pilih objek", dan jalan
    // menambah teks (modal tab Text) tetap terbuka.
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'rect', {
      targets: [{ x: 200, y: 200 }, { x: 255, y: 220 }],   // 55×20 px → di bawah kedua ambang
    });
    expect(obj, 'objek harus terbentuk lebih dulu').toBeTruthy();

    // Ukuran nyata diperiksa, bukan diasumsikan: expandBox memaksa lebar minimum 1 bar
    // (index.html:832), jadi pada barSpace yang besar kotak uji ini bisa jadi melebar
    // melampaui ambang. Kalau itu terjadi, test harus GAGAL berisik di sini — bukan lolos
    // diam-diam karena mengukur kotak yang ternyata besar.
    const px = await toPixels(page, obj.points);
    const w = Math.abs(px[4].x - px[0].x), h = Math.abs(px[4].y - px[0].y);
    expect(w, 'kotak uji harus lebih sempit dari ADDTEXT_MIN_W').toBeLessThan(90);
    expect(h, 'kotak uji harus lebih pendek dari ADDTEXT_MIN_H').toBeLessThan(28);

    const cx = (px[0].x + px[4].x) / 2, cy = (px[0].y + px[4].y) / 2;
    await page.mouse.move(rect.x + cx, rect.y + cy, { steps: 8 });
    await page.mouse.down();
    await page.mouse.up();

    // Editor inline dibuka oleh timer 220ms (index.html:3237) — tunggu melampauinya, supaya
    // "tak muncul" bukan sekadar karena keburu diperiksa.
    await page.waitForTimeout(600);
    expect(
      await page.locator('textarea.text-editor').count(),
      'editor inline tak boleh terbuka di kotak kecil',
    ).toBe(0);
    expect(await page.evaluate(() => selectedId), 'klik harus jatuh sebagai "pilih objek"').toBe(obj.id);

    // Jalan menambah teks untuk kotak kecil: double-click → modal, tab awal Text.
    await dblclickObject(page, obj, rect);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal, 'modal harus terbuka').toBeVisible();
    await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', 'text');
    assertNoPageErrors(page);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/drawing/40-modal-text.spec.js -g "rect kecil"`
Expected: FAIL pada assertion `editor inline tak boleh terbuka di kotak kecil` — dapat `1`,
diharapkan `0`. Itulah bug-nya: hit-area `±55 × ±16` menelan seluruh kotak 55×20.

Kalau gagalnya di assertion ukuran (`w`/`h`) sebelum itu, targetnya perlu dirapatkan lebih
dulu — bukan ambangnya yang salah.

- [ ] **Step 3: Tambahkan konstanta ambang**

Sisipkan tepat setelah baris `function showAddTextHint(overlay){ … }` (`index.html:841`) dan
sebelum komentar `// apakah kursor terakhir berada di atas area undangan …`:

```js
// Undangan hanya muat di kotak yg cukup besar: label "+ Add text" ~66px lebar pada
// 12px/AXIS_FONT, plus ~12px napas per sisi. Di bawah ambang ini kotak dibiarkan BERSIH,
// dan label + hit-area mati BERSAMAAN: kalau cuma labelnya yg disembunyikan, tersisa area
// hantu — klik di tengah kotak kecil tetap membuka editor tanpa sebab yg terlihat.
// Rancangan: docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md
const ADDTEXT_MIN_W=90, ADDTEXT_MIN_H=28;
const ADDTEXT_PAD=8;    // jarak aman hit-area label dari tepi/handle kotak
```

- [ ] **Step 4: Gerbang hit-area**

Ganti `overPlaceholder` (`index.html:844-845`) seutuhnya:

```js
function overPlaceholder(o){ try{ const a=overlayTextAnchor(o); if(!a) return false;
  let hw=55, hh=16;
  if(o.name==='rect'){ const b=rectBoxPx(o); if(!b) return false;
    if(b.w<ADDTEXT_MIN_W || b.h<ADDTEXT_MIN_H) return false;   // kotak kecil: tak ada undangan → tak ada hit-area
    // potong ke DALAM kotak: kotak lebar-tapi-tipis (mis. 300×30) memuat labelnya, tapi
    // toleransi ±16 melampaui tingginya → klik persis di handle tepi atas/bawah salah
    // terbaca "tambah teks". Gerbang ukuran di atas menjamin sisanya positif.
    hw=Math.min(hw, b.w/2-ADDTEXT_PAD); hh=Math.min(hh, b.h/2-ADDTEXT_PAD); }
  return Math.abs(lastPtr.x-a.x)<=hw && Math.abs(lastPtr.y-a.y)<=hh;
}catch(e){ return false; } }
```

Komentar di atas fungsi ini sekarang kurang tepat ("Toleransi kira-kira selebar label" —
untuk rect toleransinya juga dibatasi kotaknya). Ganti baris komentar KEDUA
(`index.html:843`) dari:

```js
// "tambah teks" dari klik "pilih objek"). Toleransi kira-kira selebar label.
```

menjadi:

```js
// "tambah teks" dari klik "pilih objek"). Toleransi kira-kira selebar label — utk rect juga
// dibatasi ukuran kotaknya (ADDTEXT_MIN_*), sejalan dgn gerbang visual di createPointFigures.
```

- [ ] **Step 5: Gerbang visual**

Di `createPointFigures` rect, ganti baris `else if` (`index.html:865`):

```js
    else if(showAddTextHint(overlay))    // kosong + hover/terpilih → undangan "+ Add text" menyatu di tengah kotak (ala TradingView)
```

menjadi:

```js
    else if(showAddTextHint(overlay) && w>=ADDTEXT_MIN_W && h>=ADDTEXT_MIN_H)    // kosong + hover/terpilih & kotak sanggup memuat label → undangan "+ Add text" menyatu di tengah (ala TradingView); kotak kecil dibiarkan bersih
```

Ambangnya diuji terhadap **pixel** (`w`/`h` dari `subBarCoords`), bukan satuan harga: yang
menutupi handle adalah pixel. Efek sampingan yang diinginkan — zoom-out sampai kotak
menyusut → label hilang sendiri; zoom-in → muncul lagi.

- [ ] **Step 6: Jalankan test baru, pastikan LULUS**

Run: `npx playwright test tests/drawing/40-modal-text.spec.js -g "rect kecil"`
Expected: PASS (1 passed).

- [ ] **Step 7: Jalankan suite drawing utuh — kotak besar tak boleh ikut mati**

Run: `npx playwright test tests/drawing/`
Expected: PASS semua. Yang paling penting hijau: `rect kosong: hover menawarkan "+ Add
text", klik membuka editor inline` (rect default test 24%×31% ukuran chart → jauh di atas
ambang; kalau ini merah, ambangnya kelewat besar, bukan test-nya yang salah) dan
`rect: double-click membuka modal, tab awal Text`.

- [ ] **Step 8: Jalankan seluruh suite**

Run: `npm test`
Expected: PASS semua. Catat jumlah lulus/gagal apa adanya di laporan; jangan mengklaim
lulus tanpa menempelkan hasilnya.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/drawing/40-modal-text.spec.js
git commit -m "$(cat <<'EOF'
fix(draw): undangan "+ Add text" tak lagi menutupi rect kecil

Label 12px (~66px lebar) & hit-area tetap ±55×±16 px dipakai di atas kotak
berukuran bebas: rect kecil jadi ketutupan labelnya sendiri dan klik di
handle terbaca "tambah teks". Ambang ADDTEXT_MIN_W/H (90×28 px) mematikan
label & hit-area bersamaan, plus hit-area dipotong ke dalam kotak
(ADDTEXT_PAD) utk kasus lebar-tapi-tipis. Teks kecil tetap bisa ditambah
lewat double-click → modal tab Text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Verifikasi manual & buka PR

**Files:** tak ada perubahan kode; hanya menjalankan & melaporkan.

- [ ] **Step 1: Jalankan server lokal**

```bash
PORT=8765 ./luna-trade
```

Butuh `.env` (`OANDA_TOKEN`, dll) supaya candle termuat; login memakai akun testing lokal.
Kalau `.env` tak tersedia, lewati Step 2–3 dan **katakan** bahwa verifikasi manual dilewati
— jangan mengarang hasilnya.

- [ ] **Step 2: Periksa empat hal di browser (`http://localhost:8765`)**

1. Rect besar kosong → hover/pilih: `+ Add text` tampil di tengah, klik membuka editor inline.
2. Rect kecil (± 50×20 px) → hover: tak ada label, bentuk & handle terbaca, handle sudut bisa
   ditarik untuk melebarkan kotak.
3. Rect kecil → double-click: modal terbuka di tab **Text**, teks tersimpan & tampil.
4. Rect lebar-tapi-tipis (± 300×30 px) → klik persis di handle tepi atas/bawah: yang terjadi
   drag/pilih, bukan editor teks.

- [ ] **Step 3: Zoom-out sampai rect besar menyusut di bawah ambang**

Label harus hilang sendiri, lalu muncul lagi saat zoom-in. Tak boleh ada error di console.

- [ ] **Step 4: Push & buka PR**

```bash
git push -u origin zihar/zihar/fix/rect-addtext-small-box
gh pr create --base main --title 'fix(draw): undangan "+ Add text" tak lagi menutupi rect kecil' --body "$(cat <<'EOF'
## Masalah

Rectangle kecil ketutupan label undangannya sendiri: figure teks `+ Add text` (12px,
~66px lebar) dan hit-area tetap `±55 × ±16 px` dipakai di atas kotak berukuran bebas.
Bentuk aslinya tak terbaca dan handle-nya tertutup → kotak susah dilebarkan.

## Perubahan

- `rectBoxPx()` — satu sumber ukuran kotak rect dalam pixel, dipakai bareng gerbang visual
  & gerbang hit-area (tanpa itu keduanya bisa menyimpang).
- Ambang `ADDTEXT_MIN_W/H` = 90×28 px mematikan label **dan** hit-area bersamaan. Kotak
  kecil bersih total; teks tetap bisa ditambahkan via double-click → modal tab Text.
- Hit-area dipotong ke dalam kotak (`ADDTEXT_PAD` 8px) untuk kotak lebar-tapi-tipis.

Rancangan: `docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md`.
`trendline` punya bug yang sama dan sengaja di luar cakupan PR ini.

## Verifikasi

- `npm test` — hijau, termasuk test baru `rect kecil: undangan "+ Add text" & hit-area-nya
  mati, teks tetap lewat modal`.
- Manual: rect besar tetap menawarkan label & editor inline; rect kecil bisa dilebarkan;
  zoom-out membuat label hilang sendiri saat kotak menyusut di bawah ambang.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Catatan untuk reviewer

Angka `90×28` berasal dari lebar label terukur (~66px pada 12px/`AXIS_FONT`) + ~12px napas
per sisi. Kalau ukuran/font placeholder berubah, ambang ini harus ikut — atau diganti
pengukuran `measureText` (ditimbang & ditolak di spec karena stringnya tetap).
