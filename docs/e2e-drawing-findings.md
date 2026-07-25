# Temuan ronde pertama E2E drawing

Tanggal: 2026-07-25 · Suite: `npm test` (163 test, project `hermetic`)
Hasil ronde pertama: **112 lolos · 51 gagal** — semua kegagalan adalah temuan, bukan harness
yang rusak.

**Update 2026-07-25 (setelah perbaikan anchor sub-bar, Temuan 1):** suite naik jadi
**168 test · 157 lolos · 11 gagal**. Sisa merah seluruhnya masuk tiga kelompok yang memang
dibiarkan merah dengan sengaja — Temuan 2 (klik cepat, jumlah lolos berfluktuasi antar-run),
Temuan 3 (keterjangkauan `simpleAnnotation`/`simpleTag`), Temuan 4 (instant-drop `lastPtr`
basi) — plus 2 test `@integration` yang butuh server Go asli di `:8765` (tak tersedia di
lingkungan ini, di luar jalur hermetik). Tak ada regresi di luar itu.

Kebijakan spec (disetujui sebelum implementasi): toleransi presisi **≤1px untuk semua tool**,
kecuali tool yang snap-per-bar-nya disengaja & beralasan di kode. Merah di ronde pertama
memang diharapkan; melonggarkan toleransi supaya hijau justru menyembunyikan masalahnya.

---

## Temuan 1 — Menggambar tak mengikuti kursor: 20 dari 24 tool meleset ½ bar — SELESAI

**Status:** diperbaiki 2026-07-25, lihat
`docs/superpowers/specs/2026-07-25-drawing-subbar-anchor-design.md`.
Presisi sub-bar kini default untuk semua tool; snap per-bar disisakan sebagai daftar
pengecualian eksplisit `BAR_ANCHOR` (`index.html`) untuk `verticalStraightLine` dan
`long/shortPosition`.

**Gejala terukur.** Klik di sebuah pixel, objek mendarat **3–4px** di sampingnya
(= ½ `barSpace`; pada fixture `barSpace` = 8px). Berlaku untuk `rayLine`, `straightLine`,
`horizontalStraightLine`, `horizontalRayLine`, `priceLine`, `parallelStraightLine`,
`priceChannelLine`, `fib3`, `fibonacciLine`, `rect`, `circle`, `ellipse`, `arrow`,
`arrowMarkUp`, `arrowMarkDown`, `dateRange`, `text`, `callout`, `simpleAnnotation`,
`simpleTag`.

**Yang TIDAK terjadi.** Δparity = **0 di semua tool** — objek tak pernah "loncat" antara
preview dan hasil akhir. Kekhawatiran awal ("harus pas antara preview dan klik ke-2") sudah
aman. Yang bocor satu lapis di bawahnya: **rubber-band-nya sendiri** juga sudah meleset
(Δpreview = Δlanding = 3–4px), jadi preview dan final konsisten — konsisten-konsisten
salah tempat.

**Yang lolos.** `trendline` = **0px** di ketiga metrik. `verticalStraightLine` dan
`long/shortPosition` lolos hanya karena toleransinya sengaja dilonggarkan (½ bar + 1),
sesuai alasan yang tertulis di kode:
- `verticalStraightLine` — penanda waktu harus = waktu candle yang diklik (index.html:590)
- `long/shortPosition` — entry harus mendarat di center candle terpilih (index.html:3408-3412)

**Akar masalah.** klinecharts men-snap titik ke pusat bar. Hanya overlay `trendline` yang
punya penawarnya: hook `onDrawing` (index.html:965) menulis ulang titik in-progress sebagai
`dataIndex` **pecahan**, dan `onDrawEnd` (index.html:3070) meng-commit dengan `fidx` presisi
dari klik. Tool lain menyimpan `timestamp` sub-bar — presisi di data, tapi
`convertToPixel({timestamp})` **men-snap ke bar** saat render (dikonfirmasi komentar
index.html:587), jadi presisinya hilang di layar.

**Kalau mau diperbaiki:** pola penawarnya sudah ada di repo ini. Port pendekatan `trendline`
(anchor `dataIndex` pecahan + `onDrawing` yang menulis ulang titik in-progress) ke overlay
lain. Untuk 9 overlay built-in klinecharts, hook `onDrawing` bisa dipasang lewat
`overrideOverlay`/pendaftaran ulang; keputusan cakupannya ada di tangan kamu.

Test: `tests/drawing/20-parity.spec.js` · angka per tool: `report/gallery.html`

---

## Temuan 2 — Klik cepat menelan klik: menggambar cepat gagal jadi

**Gejala terukur.** Dua klik yang berjeda **< ~400ms** membuat klik ke-2 hilang; objek tak
pernah selesai. Jeda minimum yang berhasil terukur antara 350ms dan 400ms. Semua 14 tool
multi-titik terdampak.

**Bukan double-click browser.** Listener DOM di `#chart` menerima **dua `click` normal,
`detail=1` keduanya**. Yang menelan adalah lapisan synthetic-event klinecharts, yang
mendeteksi double-click **tanpa memeriksa jarak** — dua klik terpisah 300px pun dianggap
dobel.

**Dampak pengguna.** Menggambar cepat adalah kebiasaan wajar dan mulus di TradingView. Di
sini klik ke-2 hilang tanpa umpan balik; user mengklik lagi dan sering dapat objek di tempat
yang salah.

**Efek susulan.** Saat klik akhirnya masuk, `pendingClicks` sudah desync dengan titik
klinecharts → guard `refine` (index.html:3063) gugur → titik jatuh kembali ke snap-per-bar.
Itu sebabnya 8 tool juga gagal pada assertion presisi di jalur ini, bukan cuma "tak selesai".

Test: `tests/drawing/10-click-timing.spec.js`, `20-parity.spec.js` (describe "klik cepat")

---

## Temuan 3 — `simpleAnnotation` & `simpleTag` tak bisa dijangkau setelah tergambar

Kedua objek **tak bisa di-hover di titik mana pun** — sudah diprobe di titik-titiknya,
midpoint, pusat & tepi bounding box, dan beberapa offset vertikal. Konsekuensinya: tak bisa
dipilih, tak bisa di-drag, tak bisa dihapus dengan klik/Delete, tak bisa dibuka setting-nya.
Satu-satunya jalan keluar adalah Undo atau menu trash (hapus semua).

Keduanya juga memang tak ada di `DRAW_DEFAULT` (index.html:715) → tak punya panel setting.
Kombinasinya: sekali tergambar, objek itu praktis mati.

Test: `tests/drawing/40-modal-text.spec.js` (describe "keterjangkauan objek")

---

## Temuan 4 — Instant-drop memakai posisi kursor basi

`Alt+H` / `Alt+V` menjatuhkan garis di posisi kursor tanpa klik. Niat yang tertulis di kode
(index.html:3131-3137): bila kursor **di luar** chart, `instantDropPoint` mengembalikan null
→ jatuh ke mode gambar biasa. Tapi `lastPtr` hanya di-update oleh `mousemove` pada `#chart`
(index.html:3299), jadi ia **tak pernah** berisi koordinat di luar chart.

Akibatnya: menekan `Alt+H` sambil kursor berada di watchlist/header/panel tetap menjatuhkan
garis di posisi terakhir di dalam chart — tanpa diminta, di tempat yang tak dilihat user.
Fallback yang sudah ditulis itu efektif jadi kode mati.

Test: `tests/drawing/50-rail.spec.js`

---

## Temuan 5 (kecil) — dua sumber kebenaran untuk nama `arrow`

`arrow` terdaftar di grup **Cursor** ("Arrow (no crosshair)") dan grup **Shapes** ("Arrow").
`toolByName('arrow')` / `groupOfTool('arrow')` (index.html:3532, 3538) mengembalikan varian
**cursor** (yang pertama), sedangkan `OBJ_TITLE`/`OBJ_ICON` (index.html:5550) dibangun dengan
"definisi belakang menang" → varian **shape**.

Efek nyata: mem-favorite shape Arrow menghasilkan tombol favorites bar dengan tooltip
**cursor**. Kedua jalur pemakaian sendiri tetap berfungsi, jadi ini kelas kebersihan kode,
bukan kerusakan.

Test: `tests/drawing/50-rail.spec.js` (describe "tabrakan nama tool") — **lolos**, karena
menegaskan perilaku yang ada sekaligus mendokumentasikan inkonsistensinya.

---

## Yang terbukti sehat (112 lolos)

Bukan sekadar "tak error" — ini yang diperiksa dan benar:

- **Presisi `trendline`** — 0px di parity, preview, dan landing. Satu-satunya tool yang
  benar-benar mengikuti kursor.
- **Drag** — geser satu titik: titik itu mendarat tepat di kursor (≤1px) dan titik lain tak
  bergeming. Geser badan: semua titik bergeser sama besar (≤1.5px).
- **Hapus** — tiga jalur (tombol Delete, eraser-klik, trash di modal) semuanya bersih.
- **Undo/redo** — Ctrl+Z membuang, Ctrl+Y mengembalikan.
- **Hide/show** — menyembunyikan tanpa menghapus (`visible=false`, objek tetap ada).
- **Persist setelah reload** — `trendline`, `rect`, `horizontalStraightLine` kembali di
  **posisi pixel identik** (≤1px), dengan jumlah titik yang benar termasuk hasil ekspansi.
- **ESC** — membatalkan gambar in-progress tanpa menyisakan overlay sampah; pada objek
  terpilih hanya men-deselect, tidak menghapus.
- **Modal Style|Text** — 20 tool: terbuka, tab awal benar (Text untuk objek bisa-teks, Style
  untuk sisanya), ganti warna tersimpan, Delete berfungsi. Posisi dialihkan ke popup posisi.
- **Teks** — editor inline terbuka otomatis untuk `text`/`callout` dan teksnya tersimpan;
  `rect` kosong menerima teks lewat placeholder "+ Add text"; Escape pada `text` kosong
  menghapus objeknya (sesuai desain, diuji eksplisit).
- **Rail** — arm 1-klik, isi flyout tiap grup persis sesuai daftar tool, pilihan tool sticky
  setelah reload, favorites bintang → bar melayang yang bisa arm dan bisa digeser + tersimpan.
- **Shortcut** — 11 tool ber-`sc` (Alt+T/Y/E/H/V/P/F/R/O/A/X) semuanya meng-arm tool yang
  benar; H/V benar-benar instant-drop tanpa klik.
- **Mode cursor** — 4 varian menyetel crosshair sesuai harapan; ganti mode membatalkan gambar
  yang sedang berjalan.
- **Magnet** — titik menempel ke nilai O/H/L/C sungguhan; **preview juga sudah menempel**
  (mode `strong_magnet`), jadi tak ada lompatan saat commit; toggle saat menggambar langsung
  mengubah mode overlay in-progress.
- **Ganti TF** — objek tetap di harga yang identik dan waktu yang sama (≤1 bar TF baru).
- **Area future** — menggambar di kanan bar terakhir tidak "kelempar" ke tepi kiri; jaring
  pengaman di index.html:3081 bekerja.
- **11 area non-drawing** — watchlist, TF bar + dropdown, chart-type, indikator, bar replay,
  news kalender, price alerts, paper order, daftar instrumen, tema, pemuatan data. Semua
  hidup tanpa satu pun error JS tak tertangkap.

---

## Catatan metode

Tiga hal yang awalnya terlihat seperti bug aplikasi, tapi ternyata kesalahan test — dicatat
supaya tak diulang (detail di `tests/README.md`):

1. Klik "area future" yang sebenarnya mendarat di **sumbu harga** (sumbu ada di dalam
   `#chart`: plot 1172px dari container 1224px).
2. Double-click pada titik `ellipse`/`arrowMark` yang **bukan di atas bentuk** yang tergambar
   → dikira modal tak terbuka.
3. `horizontalRayLine`: Y klik ke-2 **wajib** diabaikan (garis harus tetap horizontal) →
   Δlanding Y 197px di situ bukan cacat.
