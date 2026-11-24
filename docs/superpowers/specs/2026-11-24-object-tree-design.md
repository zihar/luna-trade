# Object Tree + grouping objek gambar (ala TradingView)

**Tanggal:** 2026-11-24 · **Status:** PR1 (Object Tree) MERGED (#207); PR2 (multi-select) diimplementasi; PR3 menyusul.

## Kenapa

Pengguna ingin melihat objek apa saja yang sudah digambar dan bisa **mengelompokkan** beberapa objek
supaya bisa digeser sekaligus, perilakunya meniru TradingView. Ukuran di produksi (2026-11-24):
per chart median 0 objek, maksimum 33 objek. Jadi daftar datar sederhana sudah cukup, tanpa
virtualisasi, pencarian, atau drag-reorder.

## Pembagian (satu fitur = satu PR)

| PR | Isi |
|----|-----|
| 1 | **Object Tree**: panel kanan berisi daftar objek. Klik baris = pilih objeknya. Lock, Hide (per objek, tersimpan), dan Delete per baris. |
| 2 | Multi-select: Ctrl/⌘+klik di chart dan di tree. |
| 3 | Group/Ungroup: geser sekaligus, plus hide/lock/delete per grup (grup tersimpan di payload). |

## PR1: keputusan

- **Tempat:** slot kanan yang sama dengan panel Alerts (pola `setAlertsPane`). Membuka satu panel menutup yang lain, seperti widget panel kanan TV. Dibuka dari tombol `#railObjTree` di rail kiri. Status buka/tutup disimpan di `localStorage br_objTreePane`.
- **Urutan:** objek terbaru di atas (TV mendaftar dari objek teratas di z-order).
- **Nama baris:** judul tool dari `DRAW_GROUPS`. Untuk objek berteks, teksnya ditambahkan (dipotong 28 karakter) supaya dua "Text" bisa dibedakan. Ikon diambil dari katalog rail.
- **Tombol per baris:** Lock, Hide, dan Delete muncul saat hover. Lock dan Hide yang sedang aktif selalu tampak (seperti TV).
- **Hide per objek ≠ "Hide all drawings":**
  - Hide per objek disimpan di `objHidden[id]` dan ikut payload sebagai field `hidden:1`. Server menyimpan payload secara opaque, jadi tidak perlu migrasi.
  - "Hide all" (`drawsHidden`) tetap sementara.
  - Visibilitas akhir dihitung `drawVisible(id) = !drawsHidden && !objHidden[id]`, jadi "Show all" tidak memunculkan objek yang disembunyikan per objek.
- **Objek tersembunyi:** pilihannya dilepas (supaya Delete berikutnya tidak menghapus sesuatu yang tak tampak) dan tidak bisa diklik di chart. Klik barisnya di tree memunculkan objek itu sekaligus memilihnya.
- **Delete dari tree** menghormati lock (`blockedByLock`).
- **Refresh:** `objTreeDirty()` digabung per frame dan dipanggil dari `syncLockAllBtn` (jalur buat/hapus/kunci), `saveDraws` (teks berubah), serta onSelected dan onDeselected.
- `measure` dan objek yang sedang digambar tidak didaftar.

## Bukan tujuan PR1

Rename objek, drag-reorder z-order, pencarian, dan daftar lintas instrumen.

## PR2: multi-select — keputusan

Modul `js/draw-multi-select.js`. klinecharts 9.8.10 hanya punya SATU seleksi (`selectedId`), jadi
multi-select dibangun di atasnya: `multiSel` = himpunan id, dan objek **primer** tetap seleksi
klinecharts (handle-nya digambar klinecharts). Anggota lain diberi handle tiruan (gaya
`OVERLAY_POINT`) di kanvas `#msLayer` yang digambar ulang tiap frame selama himpunan ≥2.

- **Chart:** Ctrl/⌘+klik = tambah/lepas (primer = yang terakhir diklik). Klik biasa = pilih itu
  saja. Klik area kosong / Esc = lepas semua. Ctrl/⌘+klik tak membuka editor "+ Add text".
- **Urutan event yang dipegang:** seleksi klinecharts baru berubah saat CLICK (mouseup tanpa
  gerak); seret membatalkan klik. Jadi menyeret anggota tak mengubah himpunan. `onClick` menimpa
  `selectedId` sebelum `onDeselected(lama)`, maka seleksi sebelum klik dicatat sendiri di
  mousedown (fase capture). Rekonsiliasi ditunda satu tick (`setTimeout 0`) supaya
  onClick + onDeselected + onSelected dari satu klik selesai dulu.
- **Seret badan** salah satu anggota = anggota lain (tak terkunci, bukan long/shortPosition)
  bergeser dgn delta bar (dibulatkan) + harga yang sama, dihitung dari kursor dgn rumus translasi
  badan yang sudah ada. Seret **handle titik** = hanya objek itu. Ctrl/⌘+seret objek primer tetap
  **clone satu objek** (perilaku #175). Hasil seret = satu langkah undo (scheduleSaveDraws di
  onPressedMoveEnd).
- **Delete** = hapus semua anggota tak terkunci; yang terkunci tetap terpilih + toast.
- **Object Tree:** baris anggota ber-kelas `sel`. Ctrl/⌘+klik = tambah/lepas, Shift+klik =
  rentang menurut urutan baris dari jangkar (klik biasa/Ctrl terakhir); objek tersembunyi dalam
  rentang dilewati.
- Objek yang dihapus / disembunyikan keluar dari himpunan. Himpunan tak disimpan.

## Bukan tujuan PR2

Copy/paste & clone banyak objek sekaligus, kotak seleksi (marquee), dan Ctrl+klik di macOS
(itu klik kanan di macOS — pakai ⌘).
