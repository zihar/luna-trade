# Shift = kunci sudut saat menggambar/menyeret garis

Tanggal: 2026-08-07 · Status: disetujui, siap dikerjakan

Menahan `Shift` saat menggambar trendline (atau menyeret ujungnya) mengunci garis ke sudut
kelipatan 45° — horizontal, vertikal, dan diagonal rapi. Perilaku TradingView.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Sudut mana | **Kelipatan 45°** (0/45/90/135) | satu modifier menutup horizontal, vertikal, dan diagonal; TV sama |
| Ruang hitung | **Piksel**, bukan harga/waktu | "lurus" itu properti visual. Konsekuensi diterima: ubah zoom → sudut berubah (TV juga) |
| Tool yang kena | `trendline`, `rayLine`, `straightLine` (Extended), `arrow`, `parallelStraightLine`, `priceChannelLine` | tool garis; bentuk (rect/circle) & fib/position/text di luar cakupan |
| Kapan | saat **menggambar** dan saat **menyeret satu ujung** objek yang sudah jadi | garis yang sudah rapi tetap bisa dirapikan ulang |
| vs magnet | **Shift menang** — titik yang sedang ditarik lepas dari magnet | "auto lurus" hanya bermakna kalau sudutnya persis; magnet yang ikut menarik membuatnya miring lagi |
| vs measure (`Shift`+drag) | measure **mundur bila kursor di atas objek** (`hoverId != null`) | Shift+drag di ruang kosong tetap penggaris; di atas objek jadi geser-terkunci |

## Perilaku

- Sudut dihitung dari **titik jangkar**: saat menggambar = titik sebelumnya; saat menyeret = ujung
  seberang. Posisi kursor **diproyeksikan tegak lurus** ke sinar 45° terdekat (bukan menyalin |dx|
  ke dy) supaya titik tak melompat jauh dari kursor.
- Channel 3 titik: kunci berlaku pada segmen pertama saja (#1→#2). Titik #3 hanya mengatur jarak
  paralel — tak punya makna sudut.
- Shift dievaluasi **terus-menerus**. Dilepas di tengah gerakan → garis bebas lagi seketika.
- Reticle (`mag-dot`) ikut terkunci: penanda dan garis tak boleh menunjuk tempat berbeda.

## Arsitektur

Modul baru **`js/draw-constrain.js`** — permukaan kecil, berdiri sendiri, tak menambah beban
`js/draw-tools.js` yang sudah padat:

- `shiftHeld` — dilacak lewat `keydown`/`keyup` di window **dan** disegarkan dari `e.shiftKey`
  tiap event mouse. Yang kedua wajib: bila Shift dilepas saat window kehilangan fokus, `keyup`
  tak pernah datang dan state jadi basi (garis nyangkut terkunci).
- `constrainPx(ax, ay, x, y)` → `{x, y}` hasil proyeksi ke sinar 45° terdekat dari jangkar.
- `ANGLE_LOCK` — himpunan nama tool di atas.

### Titik sentuh

| Berkas | Perubahan |
|---|---|
| `js/draw-tools.js` `onDrawing` | jangkar = titik sebelumnya → `constrainPx` sebelum anchor dihitung; lewati magnet saat terkunci |
| `js/draw-tools.js` `onPressedMoving` | jangkar = ujung seberang; hanya cabang "seret SATU ujung", bukan translasi badan |
| `js/draw-pointer.js` `updateMagDot` | reticle ikut terkunci |
| `js/measure.js` | gate `hoverId != null` → mundur di atas objek |

## Verifikasi

`tests/drawing/80-shift-constrain.spec.js`:

1. Gambar dengan Shift ditahan di beberapa arah → sudut piksel garis persis 0/45/90/135 (toleransi
   ≤1px, kebijakan suite yang ada).
2. Lepas Shift di tengah gerakan → titik kembali mengikuti kursor.
3. Seret ujung objek jadi dengan Shift → sudut terkunci.
4. Magnet ON + Shift → sudut persis, titik #1 tetap di OHLC.
5. **Regresi:** Shift+drag di ruang kosong tetap memunculkan measure.
6. Tool di luar daftar (`rect`) tak terpengaruh Shift.

## Di luar cakupan

- **Penanda angka di tengah garis** (sudut / Δharga / Δ% / jumlah bar). Dilewati atas permintaan
  pemilik — sumber angkanya belum pasti; layak jadi PR sendiri kalau nanti diputuskan.
- Shift pada bentuk (rect → persegi, ellipse → lingkaran).
- Listing behaviour TradingView lain — disiapkan terpisah supaya satu PR = satu tujuan (CLAUDE.md #1).
