# Alert dari garis MIRING — basis waktu jam-dagang

Tanggal: 2026-08-09 · Lanjutan PR #180 (`2026-08-09-alert-dari-garis-design.md`)

## Masalah yang diwarisi

PR #180 merilis alert-dari-objek **hanya untuk garis horizontal**. Penyempitan itu sadar, dan
alasannya adalah cacat basis waktu:

- anchor alert disimpan sebagai **milidetik wall-clock** (`LineAnchors{T1,P1,T2,P2}`, `store.go`);
- `levelAt()` (`alert_monitor.go`) menginterpolasi linear dalam **waktu kalender**;
- klinecharts menggambar sumbu-x linear dalam **indeks bar**.

Keduanya hanya sepakat pada instrumen tanpa jeda sesi. Forex kehilangan 48 dari 168 jam tiap pekan,
jadi garis miring yang diekstrapolasi berjalan **28,6% lebih cepat** daripada garis yang dilihat
pengguna — dan karena monitor hidup melewati akhir pekan, tick pertama Senin bisa menyalakan alert
berbondong-bondong. Garis horizontal levelnya konstan, jadi basis waktu tak berpengaruh sama sekali:
itulah satu-satunya sebab v1 aman.

Spec ini memperbaiki basis waktunya dan membuka tiga tool garis miring. **Zona (parallel channel,
price channel, rectangle) BUKAN bagian spec ini** — ia spec ketiga, menumpang basis waktu yang
dibuktikan di sini.

## Keputusan 1 — basis waktu = jam-dagang kalender

`levelAt` berhenti memakai wall-clock:

```go
f     := tradingElapsed(inst, an.T1, now) / tradingElapsed(inst, an.T1, an.T2)
level := an.P1 + (an.P2-an.P1)*f
```

`tradingElapsed(inst, a, b)` = milidetik **pasar-buka** di dalam `[a,b]`. Fungsi Go murni: tanpa
jaringan, tanpa data candle, tanpa state — bisa diuji seluruhnya offline, bentuk bukti yang sama
dengan yang dipakai #180 (`alert_monitor_test.go` dengan tick sintetis).

**Dua alternatif yang ditolak, beserta alasannya:**

- *Indeks bar dari data candle server* (paling akurat: menangani libur bursa dan jam ganjil secara
  otomatis). Ditolak karena memasukkan dependensi candle + jaringan OANDA ke satu-satunya jalur yang
  harus tetap hidup tanpa browser, berikut mode gagal baru yang tak punya jawaban baik ("fetch gagal
  → level dihitung dari apa?").
- *Kalender dengan fallback candle*. Ditolak sebagai kompleksitas gabungan keduanya demi kasus
  (indeks Eropa) yang belum terbukti dipakai.

### Model sesi: hanya DUA

Yang menentukan cakupan model bukan daftar instrumen yang bisa digambar, melainkan **instrumen yang
tick-nya sampai ke monitor**. `alert_monitor.go` subscribe ke `hub`, dan hub hanya menyiarkan
`cfg.StreamInstruments` (`config.go:84`) = instrumen OANDA. Saham `STOCK:` **tidak pernah masuk
monitor**, jadi kalender bursa IDX/US tak perlu dibangun sama sekali.

| Model | Instrumen | Aturan |
|---|---|---|
| `24/7` | BTC_USD, ETH_USD, LTC_USD, BCH_USD | `b - a`, tanpa potongan |
| `24/5` | semua sisanya (forex, metals, energy, indices CFD, DXY sintetis) | buka Minggu 17:00 NY → tutup Jumat 17:00 NY |

Jangkar 17:00 New York bukan angka baru: itu jangkar yang sudah dipakai proyek untuk batas bar D/W/MN
(`js/bar-time.js`, `docs/superpowers/specs/2026-07-29-monthly-bar-boundary-design.md`) dan untuk
`alignmentTimezone` yang dikirim ke OANDA (`main.go:198`).

**Properti yang membuat implementasinya rapi:** transisi DST New York terjadi Minggu pukul 02:00
lokal — yaitu **sebelum** pekan dagang dimulai (Minggu 17:00). Jadi setiap pekan dagang berdurasi
tepat 120 jam wall-clock, tanpa pekan 119/121 jam yang harus dikecualikan.

### Batas ketelitian yang diterima (jujur, tercatat)

- **Libur bursa tidak dimodelkan.** Natal/Tahun Baru menggeser level sebesar satu hari dagang; pada
  trendline sebulan itu ±4,5% dari Δharga garis.
- **Jeda harian instrumen non-forex tidak dimodelkan.** Indeks & energi CFD (DE30, UK100, JP225,
  WTICO, NATGAS…) tidak buka 24 jam pada hari kerja, jadi levelnya masih berjalan lebih cepat dari
  garis di layar. Model 24/5 tetap memperbaiki potongan terbesar (48 jam/pekan) untuk instrumen ini.
  **Saat verifikasi manual, jeda harian aktual diukur dari candle H1 nyata dan angkanya ditulis
  balik ke bagian ini**; kalau ternyata besar, ia jadi item backlog sendiri — dengan data, bukan
  tebakan.

Keduanya menggeser level, bukan membalik arah, dan keduanya jauh lebih kecil dari 28,6% yang
diperbaiki.

## Keputusan 2 — geometri: ekstrapolasi ke kanan, diam sebelum t1

`levelAt` selalu dipanggil dengan `now` = waktu sekarang, jadi arah kiri praktis tak pernah terpakai.

- **`now > t2` → tetap diekstrapolasi.** Alasannya sama dengan yang sudah tertulis di `levelAt`:
  trader memasang trendline justru untuk mengawasi apa yang terjadi SESUDAH titik terakhir; alert
  yang mati di ujung ruas berhenti bekerja tepat saat paling dibutuhkan.
- **`now < t1` → alert TIDAK dievaluasi pada tick itu.** Garis seluruhnya di masa depan; level hasil
  ekstrapolasi ke kiri tak berarti apa-apa dan bisa liar (bahkan negatif). Alert menunggu sampai
  `now` mencapai t1. Ini bukan penonaktifan: begitu waktu lewat t1, ia hidup sendiri.

Luna **tidak punya** properti "extend right" seperti TradingView — `extendData` di Luna adalah teks
anotasi, bukan perpanjangan garis. Perpanjangan diwakili tool terpisah (Ray, Extended Line), jadi
tak ada setelan per-objek yang perlu dihormati di sini.

*Catatan riset:* dokumentasi TV menegaskan alert mengikuti garis **sebagaimana ia diperpanjang**
(properti "Extend Right"), tapi **tidak** menyatakan apa yang terjadi pada trend line tanpa extend.
Itu tetap **belum terverifikasi** — jangan tulis di memori sebagai fakta TV.

## Keputusan 3 — tool yang dibuka

`ALERTABLE_LINE` (`js/draw-alert.js`) bertambah tiga:

| Tool | clicks | Alasan |
|---|---|---|
| `trendline` | 2 | ruas dua titik, tool utama fitur ini |
| `rayLine` | 2 | setengah garis |
| `straightLine` | 2 | garis tak hingga |

Yang tetap di luar: `fibonacciLine` (banyak garis, bukan satu level), `verticalStraightLine`
(vertikal — sudah ditolak API), semua bentuk & teks.

`lineAnchorsOf()` berubah bercabang, dan cabangnya **wajib** ada:

- tool horizontal → `p2 = p1` dipaksa dari `points[0]` seperti sekarang. Alasan lama masih berlaku
  utuh: `horizontalRayLine` punya dua titik yang nilainya tak selalu tersinkron, dan "garis
  horizontal" yang anchornya berselisih adalah alert miring berkostum horizontal.
- tool miring → `t2,p2` dibaca sungguhan dari `points[1]`; kalau titik kedua hilang atau `t2 == t1`,
  objek ditolak (`This line cannot be used for an alert`) — **tidak** jatuh ke fallback `t1+1` yang
  dipakai tool 1-klik, karena untuk garis miring fallback itu akan mengarang kemiringan tak hingga.

### Anchor dinormalkan supaya t1 < t2

Garis boleh digambar **kanan ke kiri** — itu gestur yang sah dan umum, dan hasilnya `points[0]`
berada SESUDAH `points[1]` dalam waktu. Tanpa penanganan, `tradingElapsed(t1,t2)` jadi nol/negatif
dan alert pada garis yang sah ditolak (atau, lebih buruk, levelnya berjalan terbalik).

Penanganannya dua lapis, sengaja:

1. `lineAnchorsOf()` menukar kedua pasangan bila `t1 > t2`, jadi anchor yang **dikirim** selalu
   menaik. Satu tempat ini mencakup create maupun `syncAlertAnchors`, dan karena kedua jalur memakai
   fungsi yang sama, pembandingan "anchor berubah?" tetap stabil (tak ada garis yang bolak-balik
   antara dua representasi dari bentuk geometris yang sama).
2. `levelAt()` tetap menukar sendiri bila menemukan `T2 < T1`. Baris alert bisa datang dari muatan
   lama atau klien lain; monitor tak boleh bergantung pada disiplin pengirim untuk sesuatu yang
   sebiaya satu perbandingan.

## Yang TIDAK berubah

Ini yang membuat PR-nya kecil:

- **Skema DB.** `LineAnchors{T1,P1,T2,P2}` sudah cukup; tak ada migrasi, tak ada kolom baru.
- **`levelTracker` / `prevLevel` / `sideHit`.** Mekanisme "anchor berubah sejak tick terakhir →
  lewati satu tick" sudah benar untuk garis miring, dan uji-tanda-jarak `d = harga − level` memang
  dirancang untuk level yang bergerak.
- **UI daftar alert & notifikasi.** Alert garis sudah tak menampilkan angka harga
  (`${sym} · Trend Line · Crossing`, `alertTitle` di `js/forming-candle.js:120`) — justru benar untuk
  level yang berubah tiap detik.
- **Sinkronisasi anchor & sapuan objek-hilang** (`syncAlertAnchors`, `sweepAlertsForMissingDrawings`).

## Mode gagal & penanganannya

1. **Pembagian nol: `tradingElapsed(t1,t2) == 0` padahal `t1 != t2`.** Terjadi kalau kedua anchor
   jatuh di dalam jendela pasar-tutup yang sama (bisa dengan anchor di area future, atau muatan
   lama/rusak). Ditangani DUA tempat: ditolak saat create (HTTP 400, pesan Inggris seperti penolakan
   vertikal yang sudah ada) dan dilewati saat evaluasi (`return level p1, tanpa hit`).
2. **`now < t1`** → lewati evaluasi (Keputusan 2).
3. **Instrumen tak dikenal** → jatuh ke model `24/5`, bukan error. Model salah lebih baik daripada
   alert yang diam-diam mati, dan 24/5 adalah tebakan teraman untuk instrumen OANDA apa pun.
4. **Zoneinfo tak ada di host.** Belum ada satu pun `time.LoadLocation` di codebase Go ini, jadi
   ketergantungan baru harus dibuat eksplisit: `import _ "time/tzdata"` (+~450KB binary) supaya
   deploy EC2 arm64 tak bergantung `/usr/share/zoneinfo`. Lokasi NY di-load **sekali** ke variabel
   package, bukan tiap tick.

## Rencana verifikasi

**Go unit (bukti utama — pemicuan sungguhan hanya bisa diuji saat pasar buka):**

- `tradingElapsed`: (a) dalam satu hari kerja; (b) melintasi satu akhir pekan; (c) melintasi beberapa
  pekan; (d) kedua ujung di dalam akhir pekan yang sama → 0; (e) melintasi transisi DST Maret dan
  November; (f) model 24/7 = selisih wall-clock apa adanya; (g) `a > b` → 0, tak pernah negatif.
- Anchor terbalik: garis kanan-ke-kiri memberi level **identik** dengan garis yang sama digambar
  kiri-ke-kanan — diuji di `levelAt` (lapis 2) dan di E2E lewat gestur gambar mundur (lapis 1).
- Kasus jangkar konkret yang wajib lulus: **Jumat 16:00 NY → Senin 09:00 NY = 17 jam dagang**
  (1 jam sisa Jumat + 16 jam sejak Minggu 17:00), bukan 65 jam wall-clock.
- `levelAt`: garis miring yang melintasi akhir pekan — level pada tick Senin pagi sama dengan level
  Jumat sore ditambah slope × jam dagang, **bukan** ditambah slope × 65 jam.
- `evalAlert`: regresi utama — alert `up` pada garis miring **tidak** menyala di tick pertama Senin
  semata-mata karena waktu berlalu.
- Regresi #180: alert horizontal (`p1 == p2`) memberi level identik sebelum & sesudah perubahan.

**E2E hermetik (`--project=hermetic`, smoke):** trendline → klik-kanan → tab **Alert** ada → Create
→ entri muncul di daftar dengan label `Trend Line`. Satu tool miring cukup di smoke; Ray & Extended
Line masuk lewat tabel `TOOL_SPEC` (`tests/helpers/spec.js`).

**Manual (butuh login OANDA):** ukur jeda harian indeks/energi dari candle H1 dan tulis angkanya ke
bagian "Batas ketelitian" di atas.

## Risiko rilis

Rollback **tidak simetris ke arah alert miring**: kalau versi ini di-rollback, alert garis miring
yang sudah dibuat akan dievaluasi lagi dengan wall-clock oleh kode lama — level meleset dan bisa
menyala palsu. Alert horizontal tetap aman dua arah. Konsekuensinya: kalau rilis ini di-rollback,
hapus alert garis miring yang terlanjur dibuat (jumlahnya bisa dilihat di tabel `price_alerts`:
baris ber-`draw_id` dengan `p1 != p2`).

## Non-goals

- Zona: parallel channel, price channel, rectangle (spec berikutnya, langsung sesudah PR ini).
- Libur bursa & jeda harian per instrumen (lihat "Batas ketelitian").
- Alert pada Fib Line dan tool multi-garis lain.
- Alert untuk saham `STOCK:` — tak mungkin selama tick-nya tak masuk hub.
