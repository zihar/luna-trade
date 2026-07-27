# Pemecahan `index.html` Monolitik — Fase 2 (JS) — Design

**Tanggal:** 2026-07-27
**Status:** Disetujui (brainstorming) — belum dikerjakan
**Scope:** Fase 2 dari inisiatif `CLAUDE.md:32-42`; Fase 1 (CSS) sudah merged di PR #113
**Basis pengukuran:** `index.html` pada commit `2202a73` (main setelah PR #129), 6823 baris

## Cara melanjutkan

Analisis di dokumen ini lengkap — **tak perlu mengulang penjelajahan kode**. Langkah berikutnya:
baca spec ini → `superpowers:writing-plans` untuk PR-0 & PR-1 → eksekusi.

Dua hal yang tidak boleh dibalik:

1. **Urutan merge:** PR-0 (sync deploy) → tunggu satu tick timer deploy → PR-1 (ekstraksi ekor).
   Alasannya di bagian "Prasyarat" — melanggar ini pernah menjatuhkan produksi.
2. **Verifikasi ulang nomor baris.** Semua rentang di sini mengacu `index.html` di `2202a73`.
   Batas potong `6398-6822` diturunkan dari **nomor baris**, bukan dari penanda di kode — kalau
   ada PR lain mendarat lebih dulu dan menggeser baris, rentangnya wajib dicek ulang sebelum
   memotong. Ini bukan kehati-hatian teoretis: pergeseran semacam itulah yang membuat 245 sitasi
   `index.html:NNNN` di `docs/` kini menunjuk konten yang salah.

## Context

`CLAUDE.md:32-42` menamai satu masalah struktural sebagai pengganda semua masalah alur kerja di
repo ini: seluruh UI dan logika tinggal di satu `index.html`, jadi **dua branch apa pun menyentuh
file yang sama → hampir pasti konflik** (PR #10 jadi 7 konflik & harus dipecah ulang). Fase 1
sudah jalan — blok `<style>` ~1500 baris keluar ke 11 modul `css/*.css` (PR #113).

Biayanya juga terasa di luar konflik: karena satu file memuat segalanya, tak ada isolasi,
sehingga gerbang test untuk perubahan sekecil apa pun adalah **seluruh** suite (205 test,
~5 menit) — bukan `tests/drawing/` saja.

Hasil yang dituju: fitur berbeda menyentuh file berbeda. Bukan kerapian demi kerapian.

## Keputusan yang mengikat

Diambil pemilik pekerjaan saat brainstorming — jangan dibalik tanpa membicarakannya:

1. **Classic scripts, BUKAN ES modules.** Bukan preferensi gaya: suite E2E membaca ~25 global
   aplikasi sebagai identifier polos lewat `page.evaluate` (`chart`, `hoverId`, `selectedId`,
   `inProgressId`, `DRAW_GROUPS`, `ADDTEXT_MIN_W`, dst). Di ES module binding top-level tinggal di
   Module Environment Record, tak terlihat dari injeksi Playwright → seluruh strategi introspeksi
   test mati. `tests/helpers/app.js:116-117` sudah menuliskan ketergantungan ini eksplisit.
2. **Hybrid:** ekstrak dulu yang sudah kontigu & mandiri sebagai pindahan murni; tunda yang kusut.
3. **Bertahap tanpa target akhir kaku.** Boleh berhenti kapan pun manfaatnya sudah didapat.

## Temuan yang mengubah bentuk rencana: kupas dari EKOR

Rencana awal — "ambil 6 domain yang kebetulan kontigu" — **gugur untuk 4 dari 6**. Sebabnya
struktural, bukan detail:

> Mencabut rentang di TENGAH file memaksa blok inline yang tersisa pecah jadi dua blok (supaya
> `<script src>` duduk di posisi urutan aslinya). **Hoisting deklarasi fungsi berlaku per-script,
> bukan per-halaman.** Ke-479 fungsi top-level hoisted bersama hanya selama mereka satu blok;
> begitu ada potongan di baris N, statement top-level sebelum N tak lagi bisa memanggil fungsi
> yang dideklarasikan setelah N.

Jadi satu-satunya pindahan yang benar-benar murni adalah **ekor kontigu**. Yang gugur:

| Kandidat | Kenapa gugur |
|---|---|
| Instrument picker `4279-4485` | isinya bersih (20 referensi luar semuanya di dalam fungsi), tapi posisinya di tengah → butuh audit hoisting atas ~2400 baris statement top-level |
| Notif news `5269-5579` | rentangnya **tiga domain**; mulai `5461` ada toggle panel + 15 statement top-level (drag IIFE `5532`, `makeResizer` `5568-5569`, restore localStorage `5572-5578`) |
| Chart settings + indikator `5933-6289` | isinya aman (12 efek samping, semua cuma bergantung `chart` di `1475`), tapi posisinya di tengah — **bersih kalau digabung ke ekor** di PR berikutnya |
| Blok `6650-6823` | **empat domain campur**: analytics `6650-6705`, `showAuthOverlay` `6706-6768`, IIFE `authGate` `6769-6776`, jam timezone `6777-6822` |

Titik potong terverifikasi bersih: **6398** (nol referensi dari atasnya — seluruh 31 nama
top-level di `6398-6822` dicek satu per satu; satu-satunya hit adalah komentar di
`index.html:438`) dan **5933** untuk PR berikutnya (4 hit, semuanya tertunda di dalam
fungsi/handler).

### Kekusutan lain yang menunggu di tengah file

| Kekusutan | Bukti |
|---|---|
| News (~704 baris) bersarang di dalam banner "order panel", tanpa banner primer sendiri | sub-banner `index.html:4876,4917,5022,5143,5211` |
| `toast()` dipakai seluruh file tapi tinggal di dalam section watchlist | `index.html:4094-4123` |
| `bootApp()` memanggil 14 fungsi lintas domain, dideklarasikan di dalam banner multi-chart | `index.html:6573` |
| `posPressedMove` diserahkan **sebagai nilai** ke `registerOverlay`, dideklarasikan 2444 baris setelahnya | dipakai `1197-1198`, dideklarasikan `3641` |

Yang terakhir paling berbahaya: jalan hari ini **hanya** karena hoisting di dalam satu blok. Antar
`<script src>` tak ada hoisting — kalau file pemakai dimuat lebih dulu, nilainya `undefined` dan
drag long/short position mati **tanpa error**.

## Prasyarat yang tidak bisa dilewati

### 1. Sync `js/` harus mendarat di PR TERPISAH yang LEBIH DULU

Skenario ini pernah menjatuhkan produksi pada 2026-07-20:

- Jalur deploy sebenarnya = timer systemd 1 menit → `deploy/luna-deploy.sh`
  (`DEPLOY-NOTES.md:84-98` menamainya "JALUR UTAMA"; `deploy.sh` cuma fallback manual).
- Skrip itu menyinkron `index.html` + `assets/` + `css/` (`deploy/luna-deploy.sh:37-44`).
  `js/` tak ada → `/js/*.js` 404 di prod.
- Skrip **self-update di akhir run** (`:55-57`), jadi yang jalan pada satu tick adalah salinan
  dari run **sebelumnya** — dan tick berikutnya keluar lebih awal di `:24` bila `LOCAL == REMOTE`.
  Maka **memperbaiki skrip di commit yang sama dengan ekstraksi tidak menolong.**
- Rekaman: PR #113 merge 06:45 → prod tanpa styling → `d4afc96` (06:54), dan commit itu sendiri
  masih butuh satu commit pemicu berikutnya.

**PR-0 (bukan ekstraksi):** tambah sync `js/` (guard `[ -d ]`) di `deploy/luna-deploy.sh` **dan**
`deploy.sh`, plus `COPY js /app/js` di `Dockerfile`. Merge, biarkan satu tick lewat, baru PR-1.

Go **tidak** perlu diubah: `main.go:127` = `mux.Handle("/", noCache(http.FileServer(http.Dir("."))))`
→ `js/*.js` otomatis terlayani `no-store`; hanya `/assets/fonts/` yang dapat cache panjang
(`main.go:132`). `tests/static-server.js` juga catch-all dengan MIME `.js` (`:15`).

### 2. `fmtCountdown` ganda — memblokir PR mid-file, BUKAN PR-1

`function fmtCountdown` dideklarasikan **dua kali dengan isi berbeda**: `index.html:4552` (format
berhari) dan `index.html:5106` (maksimal jam). Skrip non-strict → legal, dan yang belakangan
**menang untuk semua pemanggil**, termasuk `4591` yang tekstual berada di antaranya. Begitu
keduanya jatuh ke file berbeda, pemenangnya berpindah ke file yang dimuat terakhir → perilaku
berubah **senyap**. Keduanya di luar ekor `6398+`, jadi PR-1 aman; ini prasyarat untuk PR yang
menyentuh wilayah itu (rename salah satunya + test yang menunjukkan perilaku mana yang sebenarnya
dipakai hari ini).

## PR-1: ekstraksi ekor `6398-6822`

425 baris keluar; blok inline sisa tetap **satu blok kontigu `398-6397`** → nol perubahan
hoisting. Enam potongan kontigu, urutan `<script src>` = urutan sumber:

| File | Baris | Jml |
|---|---|---|
| `js/multi-chart.js` | 6398–6570 | 173 |
| `js/boot.js` | 6571–6585 | 15 |
| `js/auth-menu.js` | 6586–6649 | 64 |
| `js/analytics.js` | 6650–6705 | 56 |
| `js/auth-overlay.js` | 6706–6776 | 71 |
| `js/timezone.js` | 6777–6822 | 46 |

Tag `<script src>` dipasang **setelah** `</script>` blok inline (kode ini aslinya paling akhir),
diawali komentar meniru `index.html:29-30`: *"URUTAN script = urutan sumber lama. JANGAN diacak."*
Tiap file = byte persis rentangnya — tanpa banner tambahan, tanpa `'use strict'`, tanpa ubah
newline. Rantai runtime tetap utuh: `boot.js` (deklarasi `bootApp`) dimuat sebelum
`auth-overlay.js` yang memanggilnya lewat `authGate()`.

### Bukti byte-identik (urutan file diturunkan DARI `index.html`, tanpa file temp)

```sh
cd /Users/zihar/Projects/luna-trade
diff <(git show HEAD:index.html | sed -n '398,6822p') \
     <({ awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' index.html; \
         grep -o 'src="/js/[^"]*"' index.html | sed 's|src="/||;s|"$||' | xargs cat; }) \
  && echo "BYTE-IDENTICAL"
```

Penjaga agar tak ada tag `/js/` mendahului blok inline (akan mengubah urutan secara senyap):

```sh
[ "$(grep -n 'src="/js/' index.html | head -1 | cut -d: -f1)" -gt \
  "$(grep -n '^</script>$' index.html | cut -d: -f1)" ] && echo "ORDER OK"
```

Yang dilayani == yang di disk:

```sh
for f in js/*.js; do curl -sf -o /dev/null -w "%{http_code} $f\n" http://localhost:8799/$f
  curl -s http://localhost:8799/$f | diff -q - $f || echo "MISMATCH $f"; done
```

### Celah test yang HARUS ditutup di PR-1

Ekor ini justru wilayah **paling tak tertest** di aplikasi — verifikasi byte-identik akan hijau
walau kodenya rusak:

- `showAuthOverlay()` **tak pernah dieksekusi** di 205 test: `/api/auth/me` selalu distub 200
  (`tests/fixtures/api.js:112`), hanya dipastikan absen (`tests/drawing/00-harness.spec.js:18`).
  → tambah test: stub `/api/auth/me` → 401, pastikan `#authOverlay` tampil & nol pageerror.
- Jam timezone: `grep -rl toHaveScreenshot tests/` = **0 file**, jadi kalau `tzClock`/`tzMenu`
  berhenti muncul tak ada yang merah. → tambah test: `#tzClock` ada & teksnya tak kosong.
- `#anModal` (analytics) tak pernah dibuka test mana pun — dibiarkan, admin-gated.

### Mode kegagalan baru yang diperkenalkan pemecahan ini

Hari ini throw saat boot **membatalkan sisa script** — gagal keras dan berisik. Setelah dipecah,
throw di satu file tak menghentikan file berikutnya → boot separuh jalan, senyap. Penjaga yang ada
cuma `assertNoPageErrors` (`tests/helpers/app.js:141-143`): jangan pernah set `allowErrors` di
test yang menyentuh jalur boot.

## Backlog sesudahnya (PR terpisah, kecil)

1. **PR-2 — perluas ekor ke `5933`**: ambil `6290-6397` (chart type switcher + context menu) lalu
   `5933-6289` (chart settings + indikator). Masih pindahan murni; ~465 baris.
2. **Mid-file** (instrument picker, news, order panel): butuh audit hoisting + audit `typeof`
   (di bawah) + `fmtCountdown` lebih dulu. Satu domain per PR.
3. **Sitasi `index.html:NNNN`**: 55 di `tests/`, 245 di `docs/`. Sudah rusak massal sejak PR #113
   (menggeser ~1487 baris; mis. `docs/superpowers/plans/2026-07-05-draggable-popups.md:24`
   menunjuk CSS di `index.html:531` yang kini komentar JS). Jangan coba benahi 245-nya; perbarui
   sitasi di `tests/` yang ikut berpindah file saat PR-nya menyentuh mereka.

### Jebakan `typeof` yang harus diaudit sebelum PR mid-file

`index.html:4165` menulis `if(typeof ipickOpen!=='undefined' && ipickOpen)`. Hari ini `ipickOpen`
adalah `let` top-level di script yang **sama**, jadi selama TDZ `typeof` justru **melempar
ReferenceError** — guard itu kode mati yang tak bisa menyelamatkan apa pun. Setelah picker pindah
ke `<script src>` yang lebih belakang, binding-nya belum ada dan `typeof` mengembalikan
`'undefined'` → guard mulai berfungsi. Arahnya kebetulan aman, tapi ini bukti **byte-identik ≠
semantik-identik**. Lima lokasi: `4165, 4276, 5220, 5640, 5751`.

## Verifikasi

1. `npx playwright test --project=hermetic` → 205 lulus (+2 test baru = 207).
   Catatan: `npm test` telanjang **juga** menjalankan project `live` (205 test) ke `:8765` yang
   tak dinyalakan `webServer` → merah environmental. Gerbang sesungguhnya adalah
   `--project=hermetic`; `CLAUDE.md:46` menyesatkan di titik ini.
2. Ketiga perintah shell di atas: BYTE-IDENTICAL, ORDER OK, nol MISMATCH.
3. Manual di browser (`PORT=8765 ./luna-trade`): login berhasil (jalur `authGate` → `bootApp`),
   avatar & menu logout jalan, jam timezone tampil & pemilih TZ jalan, layout multi-chart bisa
   diganti, console bersih.
4. Setelah merge PR-0: pastikan tick deploy berikutnya benar-benar menyalin `js/`
   (`ls /opt/bar-replay/js` di server, atau `curl -f https://<prod>/js/boot.js`).

## Yang TIDAK dikerjakan

Tanpa build step / bundler (sesuai `ROADMAP.md:104-105`). Tanpa ES modules. Tanpa cache-busting
(seluruh `/` sudah `no-store`; repo belum punya mekanisme versi aset dan tak butuh sekarang).
Tanpa menyentuh Go. Tanpa memindahkan kekusutan lain sekalian — satu PR satu tujuan.

## Penilaian jujur soal nilai PR-1

PR-1 memindahkan 425 dari 6427 baris — **6,6%**. Manfaat merge-conflict-nya kecil. Nilai
sebenarnya ada di dua hal lain: membuktikan pola potong + protokol verifikasinya di wilayah
paling berisiko-rendah, dan memasang pipa deploy `js/` **sebelum** ada PR besar yang
bergantung padanya. PR-2 yang mulai memangkas domain nyata (indikator & chart settings keluar
dari file). Kalau ternyata tak dilanjutkan sampai PR-2, PR-1 sendiri nyaris tak mengubah apa pun
selain menambah 6 file — itu risiko yang perlu diterima sadar, bukan dikubur.
