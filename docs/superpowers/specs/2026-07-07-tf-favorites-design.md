# TF Bar Favorit (ala TradingView)

Tanggal: 2026-07-07

## Tujuan
TF bar atas hanya menampilkan timeframe favorit user (default `M15`, `D`);
sisanya disembunyikan di dropdown. User bisa custom favorit mana yang tampil,
tersimpan per-user via localStorage. Mengikuti pola UX TradingView.

## Perilaku
- Bar menampilkan tombol TF favorit, urut sesuai `TF_LIST` kanonik.
- Tombol dropdown `▾` di ujung membuka menu berisi semua 9 TF.
  - Klik label TF di menu = pindah TF.
  - Klik ikon ★ di baris = toggle favorit (muncul/hilang dari bar).
  - Baris menandai TF aktif (highlight) & status favorit (bintang terisi/kosong).
- TF aktif yang bukan favorit tetap muncul sementara di bar (disorot) sampai
  user pindah ke favorit lain.

## Penyimpanan
- Key baru `br_tfFav` = array kode TF (mis. `["M15","D"]`).
- Default `['M15','D']` dipakai bila key belum ada / invalid.

## Implementasi (index.html)
- Ganti populasi statis TF (`index.html:1855-1860`) dengan:
  - `tfFav` (load/save + fallback default), `loadTFFav()`, `saveTFFav()`.
  - `rebuildTFBar()` — render tombol favorit + TF aktif non-favorit + tombol `▾`.
  - `buildTFMenu()` / toggle open — render baris menu dgn label + bintang.
- `switchTF()` panggil `rebuildTFBar()` agar TF non-favorit aktif tampil/hilang.
- `highlightTF()` tetap; beroperasi pada tombol yang ada.
- CSS `.tf-menu`, `.tf-menu-row`, `.tf-star` mengikuti token warna yang ada.

## Cakupan
- Hanya TF bar utama. Panel multi-chart sekunder (`cp-tf`) tidak berubah.
- Teks UI bahasa Inggris.
