# Object Tree + grouping objek gambar (ala TradingView)

**Tanggal:** 2026-11-24 · **Status:** PR1 (Object Tree) diimplementasi; PR2/PR3 menyusul.

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
