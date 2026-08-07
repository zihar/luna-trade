# Ctrl/⌘ ditahan = magnet sementara (A2)

Tanggal: 2026-08-08 · Status: disetujui, siap dikerjakan

Menahan `Ctrl` (Windows/Linux) atau `⌘` (Mac) saat menggambar **membalik** setelan magnet untuk
selama modifier itu ditahan.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Saat magnet sudah ON | Ctrl **mematikan** magnet sementara (membalik, bukan sekadar menyalakan) | satu modifier menutup dua kebutuhan, termasuk "sesekali ingin lepas dari magnet" yang selama ini cuma bisa lewat mematikan tombolnya. Fakta TV untuk kasus magnet-sudah-ON **belum terverifikasi** — ini pilihan atas dasar kegunaan, dicatat supaya tak dikira temuan riset |
| Cakupan | saat **menggambar** dan saat **menyeret ujung**; juga jalur measure | dua pintu masuk yang sama-sama memakai `magnetSnap` — beda hasil untuk gestur yang sama akan membingungkan |
| Tombol rail | tetap mencerminkan `magnetOn`, tak berkedip karena modifier | modifier itu sesaat; setelan tak berubah |
| vs clone (A1) | tak bentrok | clone hanya di cabang **seret badan** objek jadi; magnet sementara di **menggambar** + **seret ujung**. Pembagian yang sama dengan TV |
| `mode` overlay | ikut disetel `strong_magnet` ↔ `normal` saat Ctrl ditekan/dilepas selama menggambar | tanpa itu, magnet-ON + Ctrl (niatnya bebas) masih menyisakan rubber-band bawaan klinecharts yang menempel. Persis yang dilakukan tombol magnet saat di-toggle di tengah gambar (`js/draw-rail.js`) |

## Arsitektur

Modul baru **`js/magnet-temp.js`** — mengikuti pola dua PR terakhir (`draw-constrain.js`,
`draw-clone.js`): satu tanggung jawab, permukaan kecil.

- `magnetTempHeld` — **live** (bukan dibaca sekali saat mousedown seperti `cloneModHeld`): magnet
  sementara harus menyala/padam seketika saat modifier ditekan atau dilepas di tengah gestur.
  Dilacak dari `keydown`/`keyup` + disegarkan dari `e.ctrlKey||e.metaKey` tiap event mouse
  (capture di window), alasan yang sama dengan `shiftHeld`: bila modifier dilepas ketika window
  kehilangan fokus, `keyup` tak pernah datang.
- `magnetActive()` → `magnetOn !== magnetTempHeld` (XOR).

### Titik sentuh

Sembilan pembacaan `magnetOn` di jalur gambar/ukur → `magnetActive()`:

| Berkas | Baris (sebelum) |
|---|---|
| `js/draw-tools.js` | `onDrawing`, `onPressedMoving`, `onPressedMoveEnd` (refine), `onDrawEnd` (refine), `createDraw` (mode awal) |
| `js/draw-pointer.js` | `mousedown` (commit klik), `updateMagDot` (reticle) |
| `js/measure.js` | `ptFromEvent` |

`js/draw-rail.js` (tombol + `localStorage`) sengaja **tetap** membaca `magnetOn`.

## Verifikasi

`tests/drawing/82-magnet-temp.spec.js`:

1. Magnet **OFF** + Ctrl saat menggambar → titik nempel ke O/H/L/C.
2. Magnet **ON** + Ctrl → titik **tidak** nempel (mendarat di kursor).
3. ⌘ (Meta) bekerja sama seperti Ctrl.
4. Ctrl dilepas di tengah gerakan → kembali ke setelan.
5. Reticle mengikuti keadaan sementara, bukan setelan.
6. Tombol rail tak berubah status karena modifier (`magnetOn` tetap, kelas `armed` tetap).
7. **Regresi:** Ctrl + seret badan objek jadi tetap meng-clone (A1 tak rusak).

## Di luar cakupan

- Magnet dua tingkat Weak/Strong (item E di backlog). Membalik-setelan menutup sebagian
  kebutuhannya, tapi bukan penggantinya.
