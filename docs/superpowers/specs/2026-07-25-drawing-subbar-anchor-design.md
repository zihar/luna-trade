# Sub-Bar Anchor untuk Semua Tool Drawing — Design

**Tanggal:** 2026-07-25
**Status:** Disetujui (brainstorming)
**Scope:** Temuan 1 `docs/e2e-drawing-findings.md` — 20 dari 24 tool drawing meleset ½ bar
**Lanjutan dari:** `2026-07-10-trendline-precision-design.md` ("rect/fib/dateRange menyusul
bila pola terbukti") — pola itu kini terbukti dan diukur oleh suite E2E
**Dependency:** PR #119 (suite E2E Playwright) harus merge lebih dulu — test-nya adalah
kriteria terima pekerjaan ini

## Masalah

Klik di sebuah pixel, objek mendarat 3–4px di sampingnya (= ½ `barSpace`; pada fixture
`barSpace` = 8px). Berlaku untuk 20 tool: `rayLine`, `straightLine`,
`horizontalStraightLine`, `horizontalRayLine`, `priceLine`, `parallelStraightLine`,
`priceChannelLine`, `fib3`, `fibonacciLine`, `rect`, `circle`, `ellipse`, `arrow`,
`arrowMarkUp`, `arrowMarkDown`, `dateRange`, `text`, `callout`, `simpleAnnotation`,
`simpleTag`.

Penyebabnya bukan "preview ≠ final" — Δparity = 0 di semua tool. Yang meleset adalah
rubber-band **dan** hasil akhirnya secara bersamaan: keduanya menambatkan X sebagai
`timestamp`, dan `convertToPixel({timestamp})` men-snap ke pusat bar saat render
(`index.html:587`; mekanismenya dibedah di `2026-07-10-trendline-precision-design.md`
"Temuan kunci klinecharts 9.8.10" poin 1).

`trendline` adalah satu-satunya tool yang punya penawarnya: anchor `dataIndex` **pecahan**
alih-alih `timestamp`.

## Prinsip: balik defaultnya

Hari ini "snap per-bar" adalah default, dan presisi adalah allowlist berisi satu nama:
tiga literal `name === 'trendline'` yang tersebar (commit, reticle, restore) ditambah satu
hook `onDrawing` yang hanya hidup di registrasi `trendline`. Desain ini membaliknya:

```js
// Tool yang penambatan X-nya SENGAJA per-bar (alasan tertulis di kode); sisanya presisi sub-bar.
const BAR_ANCHOR = { verticalStraightLine:1, longPosition:1, shortPosition:1 };
const subBar = (name) => !BAR_ANCHOR[name];
```

Pengetahuan "tool mana yang presisi" pindah dari empat titik tersebar ke satu konstanta, dan
konstanta itu menjadi pasangan langsung kolom `TOOL_SPEC.anchor` di `tests/helpers/spec.js`.

Pengecualian dan alasannya (keduanya sudah tertulis di kode sebelum pekerjaan ini):

- `verticalStraightLine` — penanda waktu harus = waktu candle yang diklik (`index.html:590`)
- `longPosition` / `shortPosition` — entry harus mendarat di center candle terpilih
  (`index.html:3408-3412`)

## Komponen: tujuh lapis

| # | Lapis | Lokasi | Perubahan |
|---|---|---|---|
| 1 | Tangkap klik presisi (`fidx`) | `index.html:3258` | **tak ada** — sudah generik, semua tool sudah merekam `fidx` |
| 2 | Preview rubber-band (`onDrawing`) | `index.html:964-975` | **pindahkan** ke `delHooks()` (`index.html:3044`); hapus versi trendline |
| 3 | Commit (`onDrawEnd`) | `index.html:3072` | `o.name==='trendline'` → `subBar(o.name)` |
| 4 | Reticle titik (`updateMagDot`) | `index.html:3290` | idem |
| 5 | Restore dari localStorage | `index.html:3194` | idem |
| 6 | `refineMagnetPoints` | `index.html:689` | gate `p.timestamp!=null` → `tsOf(p)`; hanya tulis ulang `value` |
| 7 | Jalur drag (`onPressedMoveStart` / `onPressedMoving` / `onPressedMoveEnd`) | `index.html:977-1001` | **pindahkan** ke `delHooks()` dengan guard `subBar`, sejalan dengan lapis 2 |

Lapis 2 adalah kunci ekonomisnya. `delHooks()` dikirim per-instance lewat `createOverlay`,
dan hook lain di objek yang sama (`onDrawStart`, `onDrawEnd`, `onClick`, …) terbukti
dihormati klinecharts. Bila `onDrawing` juga dihormati, satu hook generik menutup 11 overlay
custom **dan** 9 overlay built-in tanpa registrasi ulang satu pun.

Lapis 6 adalah konsekuensi wajib, bukan tambahan opsional: `refineMagnetPoints` mensyaratkan
`p.timestamp != null`, jadi begitu sebuah titik beranchor `dataIndex` ia diam-diam menjadi
no-op. Tanpa lapis 6, 13 tool kehilangan penyempurnaan harga presisi-M5 saat magnet aktif di
TF besar. Perbaikannya justru menyederhanakan fungsi itu dan sejalan dengan kebijakan magnet
yang sudah tertulis di `index.html:970` ("magnet hanya menyetel VALUE; X tetap ikut kursor"),
sekaligus menutup follow-up yang menggantung di `index.html:685-687`.

Lapis 7 ditambahkan setelah spec awal disetujui, saat membaca suite lebih teliti. Dua alasan.
`20-parity.spec.js:106` punya blok describe "press-drag" yang menaruh titik terakhir lewat
tekan-geser-lepas untuk semua tool multi-titik; jalur itu lewat `onPressedMoving`, yang sama
seperti `onDrawing` hanya terdaftar di `trendline` — jadi memindahkan `onDrawing` saja belum
memenuhi kriteria terima. Sekaligus ia menutup celah kedua: `30-interaction.spec.js:15` hanya
menguji drag-setelah-jadi untuk `trendline`, sehingga 20 tool lain tak teruji dan kemungkinan
besar masih snap per-bar. Apakah lapis ini benar-benar perlu ditentukan oleh pengukuran, bukan
tebakan — spike yang menjawabnya.

## Aliran data setelah perubahan

```
klik (mousedown)  →  pendingClicks[k] = {timestamp|dataIndex, value, fidx}   [tak berubah]
menggambar        →  onDrawing menulis ulang points[k] = {dataIndex: fidx, value}
klik terakhir     →  onDrawEnd meng-commit points[k] = {dataIndex: fidx, value}
render            →  convertToPixel({dataIndex}) menerima pecahan → presisi
simpan            →  serializeDraws → {vt: tsOf(p), value}          [tak berubah]
muat ulang        →  tsToFracIndex(vt) → {dataIndex, value}
ganti TF          →  snapshotFuturePoints / reanchorFuturePoints    [tak berubah, name-agnostic]
```

Dua lapis terakhir sudah bekerja tanpa modifikasi: `serializeDraws` (`index.html:3163`)
menyimpan wall-clock lewat `tsOf(p)` yang sudah menangani `dataIndex` → `fidxToTs`, dan
`snapshotFuturePoints` (`index.html:1783`) menyaring titik dengan
`p.timestamp==null && p.dataIndex!=null` — filter berbasis bentuk, bukan nama, sehingga tool
yang baru beralih otomatis tercakup saat ganti TF.

## Yang sengaja tidak berubah

- Tiga tool di `BAR_ANCHOR` tetap snap per-bar.
- Temuan 2 (klik cepat menelan klik), 3 (`simpleAnnotation`/`simpleTag` tak terjangkau),
  4 (instant-drop pakai `lastPtr` basi), 5 (dua sumber kebenaran nama `arrow`) — PR terpisah,
  sesuai CLAUDE.md aturan 1.
- **Tak ada ekspektasi test yang diubah.** `TOOL_SPEC` sudah menyatakan `anchor: 'subbar'` untuk
  ke-20 tool, jadi test yang merah hari ini adalah spesifikasi yang benar. Satu file test
  **ditambah** (`tests/drawing/70-reticle.spec.js`): reticle preview belum teruji sama sekali
  padahal lapis 4 membuatnya load-bearing. Menambah cakupan bukan melonggarkan ekspektasi.

## Risiko

1. **`onDrawing` per-instance mungkin tak dihormati klinecharts untuk overlay built-in.** Ini
   satu-satunya unknown yang menentukan bentuk PR, dan ditutup lewat spike sebelum apa pun
   ditulis. Bila gagal: 9 built-in butuh registrasi ulang dan dipecah ke PR sendiri.
2. **Built-in dengan logika titik internal** (`parallelStraightLine` titik ke-3,
   `priceChannelLine`) — menulis ulang `points[k]` saat menggambar bisa mengganggu turunannya.
   Mitigasi: hook hanya menulis anchor X + `value`, tak pernah mengubah jumlah titik.
   Diverifikasi mata lewat `report/gallery.html`.
3. **`expandBox` / `expandPosition`** (`rect` & `fib3` mengembang 2 → 8 titik) menurunkan titik
   tengah dari dua sudut. `midAnchor` (`index.html:585`) sudah lewat `fidxOf()`, jadi sudah
   aman terhadap anchor `dataIndex`.
4. **`horizontalStraightLine` / `priceLine`** — X tak relevan secara visual (garis membentang
   penuh), tapi menentukan posisi handle dan anchor persist. Tetap disertakan agar
   mekanismenya seragam; tak ada cabang khusus.
5. **`simpleAnnotation` / `simpleTag`** ikut presisi, tapi tetap tak bisa dijangkau setelah
   tergambar — itu Temuan 3, di luar cakupan.

## Verifikasi

`npm test` (hermetik). Baseline terverifikasi di branch ini setelah #119 merge: **113 lolos**,
dengan kegagalan terkumpul di `20-parity.spec.js` (34), `40-modal-text.spec.js` (2, Temuan 3),
dan `50-rail.spec.js` (1, Temuan 4). Dua test `@integration` gagal karena butuh server Go asli
di `:8765` — bukan bagian dari jalur hermetik.

Kriteria terima:

- Δparity, Δpreview, dan Δlanding ≤1px untuk ke-20 tool pada blok utama
  `tests/drawing/20-parity.spec.js`.
- Tiga tool `BAR_ANCHOR` tetap lolos pada toleransi ½ barSpace + 1 (tak ada regresi).
- Blok describe **"klik cepat" tetap merah** — itu Temuan 2, ekspektasi yang diketahui, bukan
  regresi. Dicatat eksplisit di deskripsi PR agar tak terbaca sebagai kegagalan.
- `tests/drawing/60-magnet-tf.spec.js` tetap hijau (lapis 6 tak boleh meregresi magnet).
- `report/gallery.html` ditinjau mata untuk hal yang tak bisa diassert: arah arrowhead, garis
  yang tak kelihatan, bentuk yang terdistorsi.

## Rencana PR

- **PR-0 — spike, tak di-merge.** Pasang `onDrawing` generik hanya untuk `rayLine`, ukur Δ di
  tiga mode (klik normal, press-drag, klik cepat).
  Menjawab risiko 1 dan 2 sekaligus. Hasilnya menentukan bentuk PR-1.
- **PR-1 — mekanisme generik + lapis 6.** Bila spike gagal, PR-1 mengecil jadi 11 overlay
  custom dan **PR-2** menangani 9 built-in lewat registrasi ulang.
