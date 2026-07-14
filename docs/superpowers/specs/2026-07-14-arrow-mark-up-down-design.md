# Arrow Mark Up & Down — Design

Tanggal: 2026-07-14
Status: disetujui (siap plan implementasi)

## Tujuan

Menambah dua tool gambar sekali-klik ala TradingView "Arrow Mark Up" & "Arrow Mark
Down": pilih tool → klik satu titik di chart → muncul panah kecil solid berukuran
tetap menunjuk ke atas (bullish, hijau) atau ke bawah (bearish, merah). Marker
menempel di harga+waktu titik itu, ikut pan/zoom, bisa digeser, dihapus, undo/redo,
dan tersimpan seperti drawing lain.

Beda dari tool `arrow` yang sudah ada: `arrow` adalah panah **2-titik** (pangkal→ujung,
arah bebas). Yang ini **single-point**, arah tetap up/down, ukuran konstan (tak
bergantung jarak).

## Perilaku

- **Interaksi:** satu klik menaruh marker (overlay `totalStep:2`). Tak butuh tarikan.
- **Arah:** `arrowMarkUp` menunjuk ke atas; `arrowMarkDown` menunjuk ke bawah. Arah
  fixed, bukan mengikuti sudut.
- **Ukuran:** konstan dalam pixel (tidak berubah saat zoom).
- **Warna default:** up = `#089981` (hijau), down = `#f23645` (merah). Masih bisa
  diubah lewat style picker yang ada.
- **Persistensi:** tersimpan di localStorage draws, ikut undo/redo, restore saat reload.

## Komponen (semua di `index.html`)

1. **Dua overlay custom baru** — didaftarkan via `klinecharts.registerOverlay(...)`
   tepat setelah overlay `arrow` (sekitar baris 2275).
   - `name:'arrowMarkUp'` dan `name:'arrowMarkDown'`, `totalStep:2`,
     `needDefaultPointFigure:true`.
   - `createPointFigures:({overlay,coordinates})` — jika `coordinates` kosong `return []`.
     Ambil titik presisi `subBarCoords(overlay,coordinates)[0]`, resolusi style via
     `dstyle(overlay)`. Gambar panah berukuran pixel tetap di titik itu: batang (`type:'line'`)
     + kepala segitiga terisi (`type:'polygon'`), diarahkan up atau down. Warna dari
     `st.color`, ketebalan dari `st.size`.

2. **Warna default di `DRAW_STYLE`** (sekitar baris 2138, dekat entry `arrow`):
   - `arrowMarkUp:{color:'#089981',size:2,style:'solid'}`
   - `arrowMarkDown:{color:'#f23645',size:2,style:'solid'}`

3. **Dua tool di rail** — tambahkan ke `DRAW_GROUPS` grup `shapes` (setelah baris 4806,
   entry `arrow`):
   - `{name:'arrowMarkUp', title:'Arrow Mark Up', svg:'<svg…panah↑…>'}`
   - `{name:'arrowMarkDown', title:'Arrow Mark Down', svg:'<svg…panah↓…>'}`
   - Tanpa shortcut (`sc`) untuk hindari bentrok; `A` sudah dipakai `arrow`.

4. **Persistensi** — tambahkan `arrowMarkUp:1, arrowMarkDown:1` ke `PERSIST_DRAW`
   (baris 4478).

## Di luar cakupan (YAGNI)

- Tidak ada label/teks pada marker (marker murni).
- Tidak menyentuh tag axis (marker tak perlu pill harga/waktu).
- Tidak pakai `INSTANT_DROP`/shortcut — klik biasa cukup untuk single-point.

## Verifikasi (manual, browser)

Server lokal `PORT=8765 ./luna-trade`, buka chart:
1. Pilih "Arrow Mark Up" → klik chart → panah hijau ke atas muncul di titik klik.
2. Pilih "Arrow Mark Down" → klik chart → panah merah ke bawah muncul.
3. Zoom in/out → ukuran panah tetap, posisi menempel di harga+waktu.
4. Geser marker → pindah; hapus (eraser/Delete) → hilang; undo/redo → benar.
5. Reload halaman → marker ter-restore.
6. Console tanpa error JS.
