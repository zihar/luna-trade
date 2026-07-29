# Batas & label bar bulanan (TF `MN`)

Tanggal: 2026-07-29 · Status: disetujui (cakupan "menyeluruh" dipilih pemilik pekerjaan)

## Masalah

Dua keluhan yang ternyata satu keluarga: bar bulanan luna-trade "beda dengan OANDA yang di
TradingView". Yang **tidak** berbeda: OHLC-nya. Yang berbeda: penamaan bar, dan perilaku turunan
dari asumsi durasi.

### Akar 1 — bar dinamai per waktu BUKA-nya

OANDA menandai bar bulanan dengan waktu **buka**, yaitu **17:00 New York di hari TERAKHIR bulan
sebelumnya** (21:00Z saat EDT, 22:00Z saat EST). Terverifikasi atas 12 bar EUR_USD berurutan:

```
2025-07-31T21:00Z  2025-10-31T21:00Z  2026-01-31T22:00Z  2026-04-30T21:00Z
2025-08-31T21:00Z  2025-11-30T22:00Z  2026-02-28T22:00Z  2026-05-31T21:00Z
2025-09-30T21:00Z  2025-12-31T22:00Z  2026-03-31T21:00Z  2026-06-30T21:00Z
                          ↑ DST berakhir            ↑ DST mulai
```

`js/util.js` punya penawar untuk ini — `CLOSE_LABEL_TF` — tapi isinya hanya `{D:1}`. Jadi bar Juli
2026 (ditandai `2026-06-30T21:00Z`) tampil berlabel **"Tue 30 Jun '26"**, sementara TradingView
menampilkannya sebagai Juli.

**Datanya benar, bukan bocor.** Bar Monthly Juli dan bar Daily pertama Juli punya timestamp *dan*
open yang identik (`2026-06-30T21:00Z`, `O=1.14219`) — 30 Jun 17:00 NY sudah hari dagang 1 Juli,
jadi tak ada high/low Juni yang masuk. Yang salah murni penamaan.

### Akar 2 — durasi bar dipatok satu konstanta

`DUR.MN = 2.63e9` ms = **30,4398 hari** — rata-rata panjang bulan, bukan panjang bulan mana pun.
Dan `DUR[tf]` dipakai sebagai **batas tutup bar** di jalur yang kelihatan pengguna:

| Bar | Tutup sebenarnya | Anggapan `DUR` | Selisih |
|---|---|---|---|
| Jul 2026 (31 hari) | 31 Jul 21:00Z | 31 Jul 07:33Z | **13j 26m kecepatan** |
| Feb 2026 (28 hari) | 28 Feb 22:00Z | 3 Mar 08:33Z | **58j 33m kelambatan** |
| Apr 2026 (30 hari) | 30 Apr 21:00Z | 1 Mei 07:33Z | 10j 33m kelambatan |

Akibat terukur:

- **Countdown ⏱ melompat sebulan.** `nextCandleEnd()` melakukan `while(end<=now) end+=dur`. Pada
  31 Jul 07:40Z batas palsu sudah terlewat padahal bar Juli masih terbuka 13 jam:

  | Waktu (UTC) | Countdown app | Seharusnya |
  |---|---|---|
  | 31 Jul 07:00Z | `00:33` | `14:00` |
  | 31 Jul 07:40Z | **`30d 10:26`** | `13:20` |
  | 31 Jul 20:59Z | `29d 21:07` | `00:01` |

- **Bar Replay.** `revealed()` (penjaga anti-lookahead) menganggap bar Februari masih terbuka 2,4
  hari setelah ia benar-benar tutup → bar telat muncul.
- **Proyeksi area future.** Label sumbu-X & anchor gambar di kanan bar terakhir maju 30,44 hari
  per bar, jadi "+1 bar" dari bar Juli mendarat di tengah bar Juli sendiri.

## Keputusan

**Batas bar diambil dari DATA, bukan dari konstanta.** Kalau sebuah bar punya penerus di `tfData`,
tutupnya adalah open penerus itu — eksak, nol aritmetika, otomatis benar untuk MN, pekan DST
(167/169 jam), maupun gap pasar. Hanya bar **terakhir** yang butuh proyeksi, dan khusus MN
proyeksinya dihitung dari kalender.

Alignment OANDA **tidak** diubah. `main.go` memaksa `dailyAlignment=18` untuk D/W/H4 (konvensi
ICT/FOREX.com) tapi membiarkan `M` memakai default 17 — dan justru default itu yang cocok dengan
TradingView. Menambahkan `M` ke daftar override akan menggeser OHLC ~0,5 pip **menjauh** dari TV.
Konsekuensi yang diterima: bar Monthly (17:00) bukan agregat dari bar Daily app sendiri (18:00).

### `js/bar-time.js` (baru)

| Fungsi | Guna |
|---|---|
| `barEndAt(tf,i,arr)` | tutup bar ke-`i`: open bar berikutnya bila ada, proyeksi bila terakhir |
| `stepBarTs(tf,ts,n)` | open bar `n` langkah ke depan |
| `cursorAtNewest(tf,arr)` | cursor `T` yang mengungkap SEMUA bar (mode Live) |
| `tsAfterSteps(tf,from,steps)` | ekstrapolasi area future (`steps` boleh pecahan) |
| `barStepsFrom(tf,from,to)` | kebalikannya |
| `monthlyStep` / `monthlyTradingMonth` / `lastDayOfMonth` | aritmetika kalender bulanan |

Jam jangkarnya **dibaca dari bar itu sendiri** (`nyParts(open).h`), bukan dipatok 17 — jadi kalau
alignment OANDA berubah atau kita meng-override-nya nanti, proyeksi ikut tanpa disentuh. Primitif
DST-aware `nyParts`/`nyTimestamp` dipakai ulang dari `js/ny-time.js`, tidak dibikin baru.

### JEBAKAN: `cursorAtNewest` wajib ada

Begitu `revealed()` memakai batas bulan yang benar, rumus lama `T = open + DUR[tf]` (dipakai
`load-chart.js` & `replay-ui.js` untuk "lompat ke bar terbaru") mendarat 13j 26m **sebelum** tutup
bulan 31 hari → **bar terbaru justru tak pernah terungkap**. Memperbaiki `revealed()` tanpa
memperbaiki cursor-nya membuat bar bulan berjalan hilang dari chart. Dipaku test.

### Label

`labelTs()` menggeser bar MN **+12 jam** — cukup mendarat di hari ke-1 bulan dagang (04:00–06:00 NY
apa pun keadaan DST). Menggeser sebesar `DUR.MN` tak bisa dipakai: untuk Februari ia mendarat di
bulan yang salah. `crosshairDate()` untuk MN mengembalikan `MMM 'YY` ("Jul '26") — satu bar = satu
bulan penuh, jadi hari & jam tak punya arti.

## `DUR` masih dipakai untuk apa

Bukan dihapus — hanya tak lagi jadi batas bar. Yang sah tersisa: durasi **TF halus** (selalu ≤H4,
tak pernah MN), *rate* (kecepatan Play, interval polling live), perbandingan **urutan** TF
(mana lebih halus), toleransi slack "dekat tepi live" di `switch-tf.js`, dan `labelTs` untuk `D`.

## Verifikasi

`tests/smoke/monthly-bars.spec.js` — 8 test, semua atas jangkar OANDA **nyata** (bukan angka
karangan), termasuk dua transisi DST, Februari 28 hari, dan 29 Feb 2028 (kabisat). Yang dipaku:
urutan jangkar, TF lain tetap `n×DUR`, `barEndAt` eksak-dari-data, `revealed()` tepat di tutup,
countdown tak melompat di jendela 31 Jul 07:40Z, cursor live mengungkap bar terbaru, proyeksi future
bolak-balik konsisten, dan label "Jul '26".
