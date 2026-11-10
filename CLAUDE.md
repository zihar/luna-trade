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
   `Co-Authored-By`. **Merge lewat `scripts/merge-pr.sh <n>`**, bukan `gh pr merge` langsung.
8. **Jangan merge sebelum CI hijau — termasuk check yang masih pending.** Branch protection GitHub
   tak bisa dipasang di repo private tanpa GitHub Pro (`/branches/main/protection` & `/rulesets`
   sama-sama balas 403), jadi platform hanya memberi tahu, tak menahan. `scripts/merge-pr.sh`
   menolak PR yang checknya merah/pending dan PR yang **ketinggalan dari main** — yang kedua bukan
   formalitas: PR #151 & #152 masing-masing hijau di basis berbeda dan gabungannya belum pernah
   diuji siapa pun. Daftar check wajibnya ada di `scripts/required-checks.txt` (satu file, dibaca
   juga oleh workflow Release). Kalau suatu saat repo jadi public atau berlangganan Pro, pasang
   branch protection dengan daftar yang sama dan skrip ini jadi sekadar kenyamanan.
7. **Kalau sebuah branch terlanjur stale + konflik berat:** rebase ke main & selesaikan;
   bila terlalu jauh / tercampur, **port ulang hunk-nya secara selektif** ke main
   terkini (jangan merge buta — bisa menimpa perubahan baru main), lalu **pecah** jadi
   PR-PR kecil. Ini fallback mahal, bukan pencegahan.

## Rilis & deploy (go-live MANUAL sejak 2026-07-29)

**Merge ke `main` TIDAK lagi berarti sampai ke pengguna.** Yang di-deploy EC2 adalah ref
`release`; `main` adalah "sudah diterima, belum dirilis".

- **Go-live:** GitHub → Actions → **Release** → *Run workflow*. Ia memeriksa check wajib
  (`scripts/required-checks.txt`) pada SHA `main`, menolak kalau belum hijau (bisa dipaksa
  lewat input `force`, tercatat di summary), lalu `git push origin main:release` **tanpa
  `-f`**. EC2 menariknya ≤1 menit.
- **Karena itu CI punya dua kedalaman:** PR = `go` + **smoke** (~1 mnt); push ke `main` =
  suite penuh 3 shard (~5 mnt) — **itulah gerbang rilis**. Konsekuensi yang diterima: PR
  yang menyentuh drawing/chart baru diverifikasi penuh SESUDAH merge. Aman karena `main`
  merah tak sampai ke pengguna.
- **Rollback:** `git push -f origin <sha>:release`.
- Rancangan + jebakan self-update skrip deploy:
  `docs/superpowers/specs/2026-07-29-release-gate-manual-deploy-design.md`.

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

> **CI GitHub dimatikan sejak 2026-11-10** (`gh workflow disable CI`; daftar `scripts/required-checks.txt`
> kosong). Aturan 8 & bagian "dua kedalaman CI" di bawah/atas hanya berlaku bila CI dinyalakan lagi.
> Selama mati, verifikasi **lokal** adalah satu-satunya gerbang — ikuti aturan ini:

- **Tes wajib sebelum push, kedalamannya ikut ukuran tugas:**
  - **Tugas kecil** (satu fitur/fix terbatas, satu-dua modul): jalankan **tes terkait saja** —
    spec yang menyentuh area itu (`npx playwright test tests/smoke/<file> --project=hermetic`,
    `go test -run <Nama> .`) + `tests/smoke/module-hygiene.spec.js` bila menambah/menggeser file JS.
    Tambahkan tes baru untuk perilaku baru. Jangan jalankan suite penuh.
  - **Perubahan besar** (menyentuh banyak modul, alur inti chart/replay/order, refactor/pemecahan
    file, skema data/API, atau mengubah helper bersama): jalankan **tes menyeluruh** —
    seluruh smoke (`npx playwright test tests/smoke --project=hermetic`) + `go test ./...`, dan
    suite penuh (`--project=hermetic`, ~7 mnt; pakai `timeout` Bash maksimal) bila menyentuh
    drawing/chart.
  - Ragu kecil atau besar? Anggap besar. Laporkan di PR tes mana yang dijalankan & hasilnya.

- **E2E UI (Playwright)** — `npm test` (hermetik: stub semua `/api` + fixture candle, tak
  butuh `.env`/OANDA/binary Go). Drawing tergarap penuh atas `TOOL_SPEC`; menambah tool
  drawing = satu baris tabel di `tests/helpers/spec.js`. Baca `tests/README.md` sebelum
  menambah test — ada 4 jebakan canvas yang sudah ditangani helper (jeda klik ~400ms,
  sumbu harga di dalam `#chart`, titik overlay tak selalu di atas bentuknya, jumlah titik
  mengembang setelah objek jadi). Temuan yang masih merah: `docs/e2e-drawing-findings.md`.
- **Sebelum push, cukup smoke:** `npx playwright test tests/smoke --project=hermetic`
  (**59 test / 12 file, ~1,6 menit lokal** — diukur 2026-08-10; angka lama "22 test, ~40s" sudah
  ketinggalan) — itu juga yang dijalankan CI di PR. Suite penuh (408 test / 33 file) diserahkan ke
  CI saat push ke `main`; jangan bakar 5–7 menit lokal untuk sesuatu yang sudah otomatis.
- Sisanya verifikasi manual via browser. Server lokal:
  `PORT=8765 ./luna-trade` (butuh `.env`: `OANDA_TOKEN`, dll). Serve dari disk (no-cache),
  jadi edit `index.html` langsung tampil saat reload.
- Chart butuh login OANDA untuk memuat candle; tanpa login, verifikasi terbatas ke
  "tak ada error JS + fungsi/DOM benar" (cukup untuk kebanyakan perubahan UI).

## Teks UI

Semua teks yang tampil ke pengguna (label/tombol/chip/tooltip) **bahasa Inggris**.
Komentar kode & pesan commit boleh Indonesian.
