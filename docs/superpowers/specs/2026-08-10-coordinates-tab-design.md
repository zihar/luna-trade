# Tab Coordinates di modal objek gambar (ala TradingView)

Tanggal: 2026-08-10 · Status: disepakati, siap diimplementasi

## Masalah

Modal setelan objek gambar (`js/draw-style-modal.js`) punya tab **Style · Text · Alert**. Posisi
objek hanya bisa diubah dengan menyeretnya — tak ada cara memasukkan harga/waktu presisi. Tab
**Coordinates** sengaja ditunda saat modal itu dibuat (PR #116, alasan YAGNI); sekarang diminta.

## Acuan TradingView (terverifikasi dari dokumentasinya, jangan riset ulang)

- Trend line & extended line: *"Allows for the precise placement of the trendline's first point
  (Price 1) using a **bar number** and price"* — dua baris, `Price 1` & `Price 2`, masing-masing
  berisi harga + **nomor bar** (bukan tanggal / date-picker).
  `tradingview.com/support/solutions/43000518095-trend-line/`, `.../43000518131-extended-line/`
- Rectangle: posisi titik diatur lewat harga (skala harga) dan nomor bar (sumbu waktu).
  `.../43000516984-rectangle-drawing-tool/`
- Horizontal line: tab Coordinates hanya mengatur **harga**. `.../43000518124-horizontal-line/`

Keputusan: Luna menyalin bentuk ini — sumbu X = nomor bar, bukan tanggal.

## Keputusan desain

### 1. Isi tab per objek

Satu tabel deskriptor `COORD_SPEC` (satu baris per tool, pola yang sama dengan `TOOL_SPEC` di
test), bukan rantai `if`:

| Bentuk | Objek | Baris |
|---|---|---|
| `points` | trendline, rayLine, straightLine, arrow, circle, ellipse, fibonacciLine, dateRange, parallelStraightLine (3 titik), priceChannelLine (3 titik), text, callout, arrowMarkUp, arrowMarkDown | `Price N` + `Bar N` per titik |
| `price` | horizontalStraightLine, priceLine | `Price` saja — sumbu X tak bermakna |
| `bar` | verticalStraightLine | `Bar` saja |
| `hray` | horizontalRayLine | `Price` (satu, ditulis ke KEDUA titik) + `Bar 1` + `Bar 2` |
| `box` | rect, fib3 | `Price 1`/`Bar 1` (kiri-atas) + `Price 2`/`Bar 2` (kanan-bawah), turunan dari 8 titik |

`longPosition`/`shortPosition` di luar cakupan: setelannya memang dialihkan ke `showPosPopup`,
bukan modal ini. Urutan tab: **Style · Text · Coordinates · Alert** (TV menaruh Coordinates
sesudah Text).

### 2. Nomor bar = `dataIndex` apa adanya, pecahan 2 desimal

0 = bar tertua yang dimuat, sama seperti model internal dan sama semangatnya dengan TV yang
menghitung dari awal data. **Pecahan dipertahankan** — membulatkan ke integer saat modal dibuka
akan menggeser objek sub-bar hingga setengah lebar bar tanpa diminta, membatalkan presisi sub-bar
yang dibangun di PR #24. Titik di area future otomatis bernilai lebih besar dari indeks bar
terakhir. Konsekuensi yang diterima: angkanya bergeser bila history bertambah atau TF berganti —
di TV pun nomor bar berbeda antar-TF.

### 3. Hanya field yang diedit yang ditulis

Bukan optimasi, melainkan syarat kebenaran: di mode Live bar baru terus datang, jadi `dataIndex`
sebuah titik lama berubah artinya selama modal terbuka. Karena field yang tak disentuh tak pernah
ditulis balik, pergeseran itu tak bisa merusak titik lain. Nilai semua field dihitung ulang saat
tab dibuka dan sesudah tiap commit (agar normalisasi `writeBox` terlihat apa adanya).

### 4. Commit saat Enter atau blur

Live per-ketikan ditolak: mengetik `1.0978` akan melempar objek ke harga `1` lalu `1.0` lebih
dulu, dan tiap lompatan itu ikut tercatat sebagai riwayat undo serta masuk antrean sync server.

### 5. Tulis-balik ke model titik

- Bar → anchor memakai aturan yang sudah hidup di `buildDrawsFromArray` (`js/draw-persist.js`),
  tidak diduplikasi: tool sub-bar → `{dataIndex: fidx}`; `BAR_ANCHOR` (verticalStraightLine) →
  `{timestamp: fidxToTs(fidx)}`, kecuali di area future → `{dataIndex: fidx}`.
- `rect`/`fib3` ditulis lewat `writeBox()` (`js/box-resize.js`) supaya invarian 8 titik tetap
  utuh — bukan menyentuh satu titik lepas.
- Sesudah menulis: `chart.overrideOverlay({id, points})` lalu `scheduleSaveDraws()`. Undo
  (Ctrl+Z), sync server, dan `syncAlertAnchors()` ikut jalan tanpa kode tambahan.
- Objek terkunci → semua input `disabled`, sejalan dengan tombol Delete yang sudah dimatikan saat
  lock.

### 6. Validasi

Kosong / bukan angka → nilai lama dikembalikan + border merah (bertahan sampai diketik ulang,
lihat butir 7). Angka ekstrem (mis. bar
`41237`) **diterima apa adanya**: objeknya hanya keluar layar, dan Ctrl+Z sudah jadi jaringnya.
Menjepit diam-diam justru menyembunyikan salah ketik dari pengguna.

### 7. Field `type=text`, bukan `type=number` (ditemukan saat implementasi)

Chrome menampilkan **dan** mem-parse `input[type=number]` menurut locale browser: di locale
koma-desimal (id-ID, de-DE, …) nilai kita tampil `1,08900` dan pengguna yang mengetik `1.09`
ditolak diam-diam. Terlihat langsung di screenshot verifikasi. Jadi field-nya teks +
`inputmode="decimal"`, dengan parser sendiri yang menerima titik maupun koma. Pemisah ribuan
tidak diterima — `1,090` ambigu (seribu sembilan puluh vs 1,09).

Konsekuensi lain dari koreksi ini: border merah **bertahan sampai pengguna mengetik lagi**, bukan
hilang sendiri setelah beberapa ratus milidetik. Penanda yang menghilang sendiri membuat "kenapa
angkaku tak masuk" jadi tebakan, dan membuat testnya bergantung pada timer.

## Modul

`js/draw-coords.js` baru:

- `COORD_SPEC` — tabel di atas.
- `coordsPaneHTML(o)` — markup pane.
- `wireCoordsPane(panel, o)` — pasang handler; ikut menjaga `dmTarget.id === o.id` seperti
  `refreshAlertPane` (satu node modal dipakai ulang untuk objek apa pun).

Dipanggil dari `js/draw-style-modal.js` persis seperti `alertPaneHTML` / `wireAlertPane`. Dimuat
sebelum `draw-style-modal.js` di `index.html`. CSS `.dm-co-*` menyusul `.dm-*` di
`css/order-panel.css`. Entri `SENTINEL` di `tests/smoke/boot-integrity.spec.js` **wajib** — modul
baru tanpa sentinel membuat smoke merah.

## Verifikasi

- Kolom baru `coords` di `tests/helpers/spec.js`; satu test mengiterasi seluruh tool: tab ada
  (atau tak ada, untuk posisi), jumlah & jenis field sesuai spec.
- Test perilaku: edit harga → titik overlay pindah ke harga itu; edit bar → titik bergeser;
  input tak valid → nilai kembali & objek diam; `rect` tetap 8 titik dan tetap persegi.
- Satu test ringan di `tests/smoke` (trendline: edit harga → titik berubah). Sisanya di suite
  penuh yang dijalankan CI saat push ke `main`.
