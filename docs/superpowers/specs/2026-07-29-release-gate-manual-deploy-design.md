# Gerbang rilis & deploy manual

Tanggal: 2026-07-29 · Status: disetujui (keputusan user 2026-07-28)

## Masalah

Dua hal yang selama ini menempel jadi satu, dan keduanya bermasalah:

1. **Tiap PR menjalankan suite e2e penuh** (228 test, 3 shard, ~5 menit). Untuk PR yang
   menyentuh satu modul kecil itu overkill — dan biayanya bukan cuma menit CI, tapi
   menit MANUSIA yang menunggu sebelum boleh merge.
2. **Tiap commit ke `main` langsung sampai ke pengguna.** Timer di EC2 poll `origin/main`
   tiap menit; `main` = produksi. Tak ada tempat untuk "sudah di main, belum dirilis",
   jadi tak ada cara membatch beberapa perubahan jadi satu go-live.

Keduanya terikat: e2e penuh di tiap PR terasa wajib JUSTRU karena merge = deploy. Kalau
merge tak lagi berarti deploy, verifikasi penuh boleh pindah ke sesudah merge.

## Keputusan

Pisahkan "masuk main" dari "sampai ke pengguna", lalu geser gerbangnya:

| | Sebelum | Sesudah |
|---|---|---|
| PR ke main | `go` + e2e penuh 3 shard (~5 mnt) | `go` + **smoke saja**, 1 runner (~1 mnt) |
| Push ke main | e2e penuh 3 shard | e2e penuh 3 shard — **ini gerbang rilis** |
| Go-live | otomatis, ≤1 mnt setelah merge | **manual**: tombol Run workflow → Release |
| Ref yang di-deploy | `main` | `release` |
| Rilis saat main merah | — | **ditolak**, bisa dipaksa lewat input `force` |

Nama check `E2E gate` tetap satu-satunya nama yang stabil dan melapor untuk PR maupun
push, jadi daftar check wajib tak ikut berubah saat jumlah shard berubah.

### Kenapa `release` sebagai branch, bukan tag

Deploy script sudah pull-based dan sudah membandingkan SHA lokal vs remote. Mengganti
satu variabel `BRANCH` jauh lebih kecil daripada menambah logika "cari tag terbaru", dan
`git push origin main:release` **tanpa `-f`** ditolak Git sendiri kalau bukan
fast-forward — jadi jalur normal mustahil memundurkan produksi tanpa disengaja.

## JEBAKAN yang membentuk desainnya

`luna-deploy.sh` **men-self-update di AKHIR run** (baris terakhir memasang salinan baru
ke `/opt/bar-replay/luna-deploy.sh`). Artinya skrip yang jalan pada satu tick selalu
salinan dari run SEBELUMNYA, dan `BRANCH` baru baru berlaku satu tick kemudian. Ini
bukan teori: PR #113 mendarat di produksi tanpa styling karena alasan yang sama
(`2026-07-27-split-index-js-phase2-design.md`).

Konsekuensinya, kalau `release` belum ada atau tertinggal dari commit yang sedang jalan,
tick berikutnya akan `git reset --hard origin/release` = **men-deploy balik kode lama**,
lalu memasang skrip lama (yang `BRANCH=main`) lagi → tick sesudahnya deploy `main` lagi →
**bolak-balik tanpa henti**. Dua penjaga menutup itu:

- **(a) `origin/release` belum ada → keluar 0**, tidak gagal. `git fetch` pada ref yang
  tak ada keluar dengan kode 128; di bawah `set -euo pipefail` itu membuat unit systemd
  gagal tiap menit. Keberadaan ref diperiksa lewat `git ls-remote --exit-code`, yang
  membedakan "ref tak ada" (rc=2) dari "jaringan bermasalah" (rc lain) — yang kedua tetap
  harus berisik, karena deploy yang berhenti SENYAP adalah mode kegagalan terburuk di
  sini.
- **(b) menolak mundur ke commit yang skripnya masih `BRANCH=main`.** Perhatikan
  perumusannya: bukan "menolak semua langkah mundur". Menolak semua langkah mundur akan
  ikut memblokir jalur rollback resmi (`git push -f origin <sha>:release`), yang justru
  memang memundurkan `release`. Yang berbahaya cuma satu keadaan spesifik: commit tujuan
  memasang skrip yang menunjuk branch LAIN, dan itulah yang memulai osilasi. Mundur ke
  commit pasca-rilis (skripnya sudah `BRANCH=release`) tidak berosilasi, jadi diizinkan.

## Urutan transisi (mengikat, tak butuh SSH/SSM sama sekali)

1. Merge PR ini ke `main`. Auto-deploy LAMA masih hidup (`BRANCH=main`) → ia men-deploy
   commit itu, lalu men-self-update ke skrip baru (`BRANCH=release`).
2. **Langsung** `git push origin main:release` pada commit yang sama.

Tick yang nyempil di celah antara 1 dan 2 jadi no-op karena penjaga (a). Setelah ini,
go-live = tombol Run workflow → Release.

## Rollback

`git push -f origin <sha>:release`; timer menariknya ≤1 menit. Berlaku untuk `<sha>` yang
skripnya sudah `BRANCH=release` — untuk mundur melewati commit transisi, jalankan ulang
`deploy/setup-luna-autodeploy.sh` di instance.

## Konsekuensi yang sudah diterima

PR yang menyentuh drawing/chart **tak lagi diverifikasi penuh sebelum merge** — kalau ada
yang pecah, ketahuan ~5 menit SESUDAH merge di run push-to-main. Itu baru aman karena
deploy tak lagi otomatis: `main` boleh merah sebentar tanpa sampai ke pengguna, dan
tombol rilis menolak `main` yang merah.
