# Luna Trade — Konvensi Kerja

Panduan ini mengikat untuk manusia & agent (mis. Claude Code). Tujuannya mencegah
masalah yang sudah terjadi: branch lama mengendap → main jalan → konflik menumpuk di
`index.html` yang monolitik (lihat PR #10 yang jadi 7 konflik & harus dipecah ulang).

## Aturan alur kerja (WAJIB)

1. **Satu fitur = satu PR.** Jangan bundel fitur + polish + fix dalam satu PR
   (PR #10 bundel ~8 hal → berat direview & berisiko konflik). Pisah per tujuan.
2. **PR kecil, merge cepat — target < 48 jam.** Makin lama branch hidup, makin jauh
   divergen dari `main`. Branch yang matang tapi ditahan = utang yang bunganya konflik.
3. **Jangan mengendapkan kerjaan "selesai tapi belum di-commit".** Begitu matang,
   commit + buka PR (boleh draft) supaya terlihat & bisa di-rebase, bukan diendapkan
   di working tree.
4. **Rebase ke main tiap hari** selama branch hidup, bukan nunggu akhir:
   ```
   git fetch origin && git rebase origin/main
   ```
   Konflik kecil harian ≫ satu tumpukan besar di akhir.
5. **`git rerere` aktif** (reuse recorded resolution) — sudah di-set global
   (`rerere.enabled=true`, `rerere.autoupdate=true`). Resolusi konflik berulang
   (mis. saat rebase harian) diingat & diterapkan otomatis.
6. **Branch dari & PR ke `main`.** Pola nama: `zihar/zihar/<tipe>/<slug>`
   (`feat` / `fix` / `chore` / `docs`). Commit conventional (Indonesian) + trailer
   `Co-Authored-By`. Merge lewat `gh pr merge <n> --merge --delete-branch`.
7. **Kalau sebuah branch terlanjur stale + konflik berat:** rebase ke main & selesaikan;
   bila terlalu jauh / tercampur, **port ulang hunk-nya secara selektif** ke main
   terkini (jangan merge buta — bisa menimpa perubahan baru main), lalu **pecah** jadi
   PR-PR kecil. Ini fallback mahal, bukan pencegahan.

## Akar masalah struktural: `index.html` monolitik

Semua UI + logika ada di satu `index.html` (~380KB). Akibatnya **dua branch apa pun
menyentuh file yang sama → hampir pasti konflik.** Ini pengganda utama semua masalah
di atas.

- **Arah jangka panjang:** pecah bertahap jadi modul per-fitur
  (`css/*.css`, `js/*.js` per domain: watchlist, drawing, toast, header, chart, …)
  sehingga fitur berbeda menyentuh file berbeda dan PR tak lagi bertabrakan.
- Lakukan bertahap, tiap langkah PR kecil sendiri. Sampai itu terjadi, disiplin
  aturan 1–5 di atas yang menahan konflik.

## Verifikasi

- Frontend tanpa unit test — verifikasi manual via browser. Server lokal:
  `PORT=8765 ./luna-trade` (butuh `.env`: `OANDA_TOKEN`, dll). Serve dari disk (no-cache),
  jadi edit `index.html` langsung tampil saat reload.
- Chart butuh login OANDA untuk memuat candle; tanpa login, verifikasi terbatas ke
  "tak ada error JS + fungsi/DOM benar" (cukup untuk kebanyakan perubahan UI).

## Teks UI

Semua teks yang tampil ke pengguna (label/tombol/chip/tooltip) **bahasa Inggris**.
Komentar kode & pesan commit boleh Indonesian.
