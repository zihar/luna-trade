# Trendline Sub-Bar Precision — Design

**Tanggal:** 2026-07-10
**Status:** Disetujui (brainstorming)
**Scope:** Overlay `trendline` saja (rect/fib/dateRange menyusul bila pola terbukti)

## Masalah

Saat menggambar trendline, titik "kegeser ke kiri" — tidak mendarat di titik yang di-klik.
Penyebabnya bukan kode luna, melainkan cara klinecharts 9.8.10 mengonversi titik overlay
ber-`timestamp` menjadi koordinat X: `timestamp → timestampToDataIndex (binarySearchNearest)
→ indeks integer → pusat bar` (`index.esm.js:8767`). Pergeseran bisa sampai ±½ lebar bar.

`subBarCoords` dulu dibuat untuk menggambar garis di posisi sub-bar, tapi dijadikan no-op
(`index.html:1493`) karena handle default klinecharts tetap di-snap ke pusat bar → bentuk garis
dan handle jadi divergen (lihat komentar `index.html:1485-1492`).

## Temuan kunci klinecharts 9.8.10 (dari source `index.esm.js`)

1. **Render** (`_drawOverlay`, 8763): jika titik punya `timestamp`, ia **menang** dan meng-snap ke
   integer. Jika titik hanya punya `dataIndex`, `convertToPixel(dataIndex)` menerima **pecahan** →
   garis **dan** handle default (pakai `coordinates` yang sama) dirender **presisi**.
2. **Drag per-titik** (`pressedMouseMoveEvent`, 8508): hanya `figureType===Point` (dari handle
   default) yang memicu geser-satu-titik. Figure custom selalu `Other` → geser seluruh overlay.
   Karena handle default sudah presisi bila anchor pecahan, kita **tetap pakai handle default**
   (`needDefaultPointFigure:true`).
3. **`onPressedMoving` yang `return true`** membuat klinecharts **melewati** `_coordinateToPoint`
   bawaannya yang meng-snap ke integer (`index.esm.js:8511`). Ini pintu untuk drag presisi.
4. **`updatePointPosition`** (5963): untuk titik tanpa timestamp, klinecharts mengisi
   `point.timestamp = dataList[point.dataIndex]?.timestamp`. Untuk index **pecahan**,
   `dataList[3.4]` = `undefined` → timestamp tidak terisi → titik tetap pecahan (aman).
   Shift index hanya terjadi pada load histori lama (type `Forward`) dan sudah ditangani engine.

## Pendekatan terpilih: anchor `dataIndex` pecahan + intercept `onPressedMoving`

Alternatif yang ditolak:
- **A. Hidupkan `subBarCoords`** — mengulang kegagalan lama (garis presisi, handle snap → divergen).
- **B. Gambar handle custom** — kehilangan `figureType=Point`, drag per-titik tak berfungsi.

## Desain

### 1. Model anchor
Titik trendline disimpan sebagai `{dataIndex: <pecahan>, value}` (tanpa `timestamp`) selama runtime.
Durabilitas lintas TF/refresh dijaga oleh `vt` (wall-clock timestamp) yang sudah dipersist.

### 2. Jalur menggambar
- `xAnchorFromPx()` mengembalikan `{dataIndex: floatIdx}` untuk titik in-data (bukan `{timestamp}`);
  untuk future tetap `{dataIndex}` — jadi seragam.
- `pendingClicks` otomatis membawa index pecahan.
- `onDrawEnd` meng-override titik hasil-snap klinecharts dengan `pendingClicks` presisi (mekanisme
  refine yang sudah ada; hanya isi anchor yang berubah dari timestamp → dataIndex pecahan).

### 3. Jalur edit/drag (baru) — hook di template `trendline`
- `onPressedMoveStart(ev)`: rekam `points` awal + pointer awal `{x,y}` (untuk translasi badan garis).
- `onPressedMoving(ev)`:
  - `xa = xAnchorFromPx(ev.x)` (pecahan), `v = pxToValue(ev.y)`.
  - Jika `ev.figureKey` berawalan `overlay_figure_point_` → set titik ke-`figureIndex` = `{dataIndex, value}`.
  - Selain itu (badan garis) → translasi semua titik dengan delta dataIndex & value dari start.
  - `chart.overrideOverlay({id, points})`; **`return true`** (skip snap bawaan).
- `onPressedMoveEnd(ev)`: snapshot `vt` semua titik; panggil `refineMagnetPoints` (reuse).

### 4. Durabilitas (perluas mesin yang ada)
- `snapshotFuturePoints`/`reanchorFuturePoints`: perluas dari "hanya future" ke **semua titik**
  trendline. Saat ganti-TF & restore-localStorage, `vt → dataIndex` pecahan via interpolasi
  terhadap bar termuat (`li + (vt - lastTs)/DUR`, dan interpolasi in-range untuk vt < lastTs).
- Helper baru `tsToFracIndex(vt)` untuk konversi tersebut.

### 5. Risiko & mitigasi
- **Ruang koordinat `ev.x/ev.y`** di `onPressedMoving` (pane- vs chart-relative): verifikasi sekali
  saat implementasi; sesuaikan sebelum dipakai `xAnchorFromPx`/`pxToValue`.
- **`updatePointPosition` mengisi timestamp**: dijaga dengan memastikan index selalu pecahan.
- **Magnet**: tetap tidak diterapkan ke titik future (guard yang ada dipertahankan).
- **Regresi drag/select** overlay lain: perubahan diisolasi ke template `trendline` saja.

## Verifikasi (definition of done)
1. Gambar trendline di paruh kanan sebuah candle → titik mendarat tepat di kursor (bukan pusat bar).
2. Drag ujung garis ke posisi antar-bar → mendarat presisi, handle menempel di ujung garis.
3. Drag badan garis → kedua ujung ikut presisi.
4. Ganti TF lalu kembali → garis tetap di harga & waktu yang sama.
5. Refresh halaman → garis ter-restore di posisi yang sama.
6. Mode live (bar baru masuk) → garis tidak bergeser.
7. Overlay lain (rect/fib/position) tidak berubah perilakunya.
