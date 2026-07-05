# Spec: Posisi teks per-objek gambar (horizontal + vertikal)

Tanggal: 2026-07-05

## Tujuan

Setiap objek gambar yang bisa punya teks mendapat konfigurasi tambahan untuk **posisi teks** — horizontal (left/center/right) dan vertikal (top/middle/bottom) — diatur per-objek dari popup objek.

## Cakupan

Tiga overlay kustom yang merender teks dari `extendData`:

- `rect` — teks di dalam kotak
- `trendline` — teks pada garis
- `text` — teks berdiri sendiri di titik anchor

Objek lain (fib3, garis lurus, dateRange, long/short position, dll) tidak termasuk.

## Penyimpanan

Dua field baru di bag style per-objek `objStyle[id]`:

- `textAlign`: `'left' | 'center' | 'right'`
- `textValign`: `'top' | 'middle' | 'bottom'`

Alasan memilih `objStyle` (bukan `extendData`):

- `objStyle[id]` sudah dipersist (localStorage / store) dan direstore bersama objek.
- `setObjStyle(id, patch)` sudah menangani re-render (`overrideOverlay({id, points})` → memicu `createPointFigures`) **dan** `scheduleSaveDraws()`. Nol plumbing baru.
- `extendData` untuk ketiga objek ini berupa string teks polos; mengubahnya jadi objek `{text, align}` akan memaksa migrasi di banyak titik baca → risiko regresi. Ditolak.

Nilai kosong (belum pernah diset) = default per-objek di bawah.

## Default (menjaga tampilan yang ada sekarang)

| Objek | textAlign | textValign |
|---|---|---|
| `rect` | center | middle |
| `trendline` | center | top (teks di atas garis) |
| `text` | left | top |

Nilai default dibaca lewat helper, mis. `dstyle(o).textAlign ?? DEFAULT_TALIGN[o.name]`. Implementasi boleh menaruh default ini di `DRAW_DEFAULT[name]` (yang sudah di-merge oleh `dstyle`) selama tidak mengganggu konsumen style lain — pendekatan yang dipakai diserahkan ke rencana implementasi, asalkan default tabel di atas terjaga.

## Perilaku render

Padding tepi untuk `rect` memakai konstanta kecil (mis. `pad = 4px`) agar teks tidak menempel mentah ke garis border.

### rect (index.html ~1346–1349)

Horizontal (anchor x + `align` figur):

- left → `x + pad`, `align:'left'`
- center → `x + w/2`, `align:'center'` (sekarang)
- right → `x + w - pad`, `align:'right'`

Vertikal (anchor y baris pertama + `baseline`):

- top → `y + pad`, `baseline:'top'`
- middle → `y + h/2`, `baseline:'middle'` (sekarang)
- bottom → `y + h - pad`, `baseline:'bottom'`

Multi-baris: perhitungan `y0` awal tetap mengikuti valign; tiap baris turun `lh` seperti sekarang. Untuk `bottom`, blok teks di-offset ke atas sebanyak `(lines.length-1)*lh` agar baris terakhir yang menempel ke sisi bawah.

### trendline (index.html ~1363–1365)

Horizontal — titik di sepanjang garis (a = titik awal, b = titik akhir):

- left → titik `a`, `align:'left'`
- center → midpoint `((a+b)/2)`, `align:'center'` (sekarang)
- right → titik `b`, `align:'right'`

Vertikal — relatif terhadap garis pada titik anchor tersebut:

- top → di atas garis: `y - offset`, `baseline:'bottom'` (sekarang, offset ~4px)
- middle → pas di garis: `y`, `baseline:'middle'`
- bottom → di bawah garis: `y + offset`, `baseline:'top'`

### text (index.html ~1561–1564)

Horizontal — `align` figur = textAlign (x tetap = `C[0].x`, anchor):

- left (sekarang) / center / right

Vertikal — `baseline` baris pertama:

- top (sekarang) / middle / bottom

Multi-baris: sama seperti rect, untuk `bottom` offset blok ke atas `(lines.length-1)*lh`.

## UI

Di `showObjPopup()` (index.html ~3926), hanya saat `hasText` true, tambah dua baris chip setelah "Gaya garis", sebelum blok tombol aksi. Semua teks yang tampil berbahasa Inggris:

```
Horizontal   [ Left ] [ Center ] [ Right ]
Vertical     [ Top ]  [ Middle ] [ Bottom ]
```

- Pakai kelas chip yang sama (`pp-chip`) & pola `markOn` seperti kontrol "Tebal"/"Gaya garis".
- Chip aktif = nilai efektif saat ini (`dstyle(o)` + default).
- Klik chip horizontal → `setObjStyle(o.id, {textAlign: val})` + `markOn`.
- Klik chip vertikal → `setObjStyle(o.id, {textValign: val})` + `markOn`.
- Re-render & persist terjadi otomatis di dalam `setObjStyle`.

Ukuran popup: `objPop.style.top` clamp (`window.innerHeight - N`) mungkin perlu dinaikkan sedikit karena popup jadi lebih tinggi saat `hasText`.

## Non-goals (YAGNI)

- Rotasi teks.
- Offset piksel kustom / drag posisi teks bebas.
- Posisi teks untuk objek yang saat ini tidak punya teks.

## Verifikasi

- Buat rect, trendline, dan text; tambah teks (+ Add text / editor).
- Ubah tiap kombinasi horizontal × vertikal; pastikan teks pindah sesuai tabel.
- Reload halaman: posisi teks tersimpan & terpulihkan bersama objek.
- Objek lama (dibuat sebelum fitur, tanpa `textAlign`/`textValign`) tampil sama seperti sebelumnya (default).
- Teks multi-baris rata & ter-anchor benar di kesembilan posisi.
