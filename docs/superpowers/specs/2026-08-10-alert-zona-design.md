# Alert dari ZONA — parallel channel, price channel, rectangle

Tanggal: 2026-08-10 · Lanjutan PR #180 (garis horizontal) dan PR #181 (garis miring, basis waktu)

## Posisi spec ini

PR #181 memperbaiki basis waktu: `levelAt()` menginterpolasi dalam **jam pasar-buka**
(`tradingElapsed`, `session.go`), bukan waktu kalender. Itu prasyarat yang membuat zona miring
mungkin sama sekali. Spec ini memakainya apa adanya dan **tidak menyentuh** basis waktu.

Yang baru cuma dua hal: **batas kedua** dan **kondisi transisi**.

## Keputusan 1 — kondisi: Entering & Exiting, mengikuti TradingView

TradingView menawarkan **empat** kondisi untuk zona: Entering, Exiting, Inside, Outside
(terverifikasi: blog TV "Introducing alerts on rectangle drawings"; halaman Parallel channel).

Luna mengambil **dua** — `Entering` dan `Exiting` — dengan nama dan semantik persis TV, bukan
istilah karangan. Inside/Outside sengaja ditinggalkan, dan alasannya struktural, bukan selera:
di TV keduanya bergantung pada **periodicity** (Once Per Bar / Once Per Bar Close / Every Time),
sedangkan alert Luna **one-shot** — sekali menyala, mati. Tanpa mesin pengulangan itu, "Outside"
akan menyala beberapa detik sesudah dibuat, karena harga hampir selalu sedang berada di luar zona.
Menyalin nama tanpa mesinnya menghasilkan dua pilihan menu yang nyaris selalu salah pakai.

**Konsekuensi yang diterima:** Inside/Outside baru bisa ditawarkan setelah Luna punya alert
berulang. Itu PR tersendiri yang lebih besar daripada zona — ia menyentuh SEMUA alert yang sudah
ada, termasuk alert harga biasa.

Titik masuk UI tidak berubah: tab **Alert** di modal setelan objek (#180). TV memakai ikon jam di
floating toolbar per-objek, tapi Luna belum punya toolbar semacam itu sama sekali — menirunya
adalah fitur UI tersendiri, bukan bagian dari alert zona.

## Keputusan 2 — satu representasi untuk ketiga bentuk

Server **tidak perlu tahu tool apa** yang menghasilkan zona. Setiap zona dikirim sebagai:

- **garis batas pertama** — `t1,p1,t2,p2`, kolom yang sudah ada sejak #180;
- **`pOff`** — jarak HARGA dari batas pertama ke batas kedua. Boleh negatif. Satu kolom baru.

Frontend yang menormalkan ketiga bentuk ke sana:

| Tool | Garis batas pertama | `pOff` |
|---|---|---|
| `rect` | horizontal di harga TERENDAH kotak, dari sisi kiri ke sisi kanan | tinggi kotak |
| `parallelStraightLine` | `points[0]`–`points[1]` apa adanya | offset ke garis yang lewat `points[2]` |
| `priceChannelLine` | garis tengah **digeser turun** sebesar offset | 2 × offset |

`priceChannelLine` perlu penggeseran karena di klinecharts garis yang digambar pengguna adalah
**sumbu tengah**, dan kedua batasnya simetris terhadapnya (terverifikasi dari sumber
`klinecharts-9.8.10.min.js`, fungsi `re()`: garis kedua lewat titik ke-3, garis ketiga adalah
cerminnya). Menggeser dilakukan di sumbu HARGA saja (`p1-off`, `p2-off`) — tak menyentuh waktu,
jadi tak memerlukan jam-dagang.

### Offset dihitung dalam indeks bar, bukan piksel dan bukan wall-clock

```js
const i1=fidxOf(p0), i2=fidxOf(p1), i3=fidxOf(p2);
const f = (i3 - i1) / (i2 - i1);
const off = p2.value - (p0.value + (p1.value - p0.value) * f);
```

`fidxOf()` (`js/util.js`) memetakan sebuah point ke indeks bar pecahan, dan komentarnya di sana
sudah menjelaskan persis kenapa ia yang benar: sumbu-x chart linear terhadap indeks bar, sedangkan
timestamp tak rata per-piksel karena gap akhir pekan dan area future.

Tiga alternatif yang ditolak:

- **Koordinat piksel** (`convertToPixel`): hasilnya sama saat titiknya terlihat, tapi bergantung
  viewport — titik di luar layar memberi nilai ekstrapolasi atau NaN, dan offset zona tak boleh
  berubah hanya karena pengguna menggeser chart.
- **Interpolasi wall-clock**: persis cacat yang baru saja diperbaiki #181.
- **Mengirim titik ketiga mentah (`t3,p3`) dan membiarkan server menghitung offset**: butuh DUA
  kolom baru, bukan satu, dan memaksa server memahami perbedaan antara channel-sumbu-tengah dan
  channel-batas — pengetahuan tentang tool yang justru dihindari desain ini.

Karena sumbu harga Luna linear (tak ada skala logaritmik di kode), offset harga konstan di sepanjang
zona — jadi satu angka memang cukup.

## Keputusan 3 — zona berlaku terus ke kanan

Batas waktu rectangle (sisi kiri/kanan kotak) **tidak** membatasi alert. Ini konsisten dengan #180
dan #181 yang sudah memilih ekstrapolasi ke kanan, dan dengan cara kotak S/R dipakai: kotak
digambar di masa lalu, yang diawasi justru sentuhan berikutnya. Sisi kiri/kanan kotak adalah
hiasan visual, bukan gerbang.

Penjagaan yang diwarisi tetap berlaku: zona yang **kedua anchornya masih di masa depan** tidak
dievaluasi (aturan `now < T1 && now < T2` di `evalAlert`, #181).

*Catatan riset:* apakah TV membatasi alert rectangle pada rentang waktu kotaknya **tidak
terdokumentasi** di sumber TV mana pun yang bisa dibaca. Ini keputusan Luna sendiri — jangan
mencatatnya sebagai fakta TV.

## Arsitektur

### Server

`LineAnchors` bertambah satu field:

```go
type LineAnchors struct {
	T1, T2 int64
	P1, P2 float64
	POff   float64 // 0 = bukan zona; jarak harga ke batas kedua, boleh negatif
}
```

**`POff` WAJIB `float64` biasa, bukan pointer.** `levelTracker.prevLevel` menentukan kesegaran
baseline dengan perbandingan struct langsung (`e.an != an`, `alert_monitor.go`). Field bernilai
membuat perubahan lebar zona otomatis membatalkan baseline — yang memang harus terjadi, kalau tidak
menyeret sisi zona bisa terbaca sebagai masuk/keluar yang tak pernah dilakukan harga. Pointer akan
membandingkan ALAMAT, diam-diam melewatkan perubahan itu. Kolom DB tetap nullable; NULL dibaca
sebagai 0.

Batas zona memakai `levelAt` yang sudah ada — jadi jam-dagang, ekstrapolasi kanan, normalisasi
anchor terbalik, dan penjagaan span-nol semuanya diwarisi tanpa satu baris pun kode baru:

```go
func zoneBounds(r AlertRow, now int64) (lo, hi float64) {
	base := levelAt(r, now)
	other := base + r.An.POff
	return math.Min(base, other), math.Max(base, other)
}
```

`levelTracker` menyimpan keadaan `inside` di samping level, dan `evalAlert` bercabang pada
`cond`. Keadaan SEBELUMNYA diambil dari tracker (bukan dihitung ulang dari harga lama terhadap
batas baru) — pelajaran #180: membandingkan harga lama dengan level baru mengarang lintasan setiap
kali levelnya melompat.

### Frontend

`js/draw-alert.js` mendapat `ZONE_TOOL` dan `zoneAnchorsOf()`; `lineAnchorsOf()` tak disentuh.
Satu fungsi pemilih (`anchorsOf`) memilih di antara keduanya, dan dialah yang dipanggil
`createLineAlert` maupun `syncAlertAnchors` — supaya zona ikut mengikuti objeknya (geser, undo,
hapus) tanpa satu pun jalur baru.

Dropdown kondisi berisi Entering/Exiting untuk zona, dan Crossing/Crossing up/Crossing down untuk
garis. `COND_LABEL` bertambah dua entri — ia sudah jadi satu-satunya sumber label kondisi sejak
#180, jadi daftar alert & notifikasi ikut benar tanpa disentuh.

## Mode gagal & penanganannya

1. **`pOff == 0` pada kondisi zona** — zona setinggi nol adalah garis, dan "masuk ke dalamnya"
   tak pernah bisa terjadi secara bermakna. Ditolak saat create (400, pesan Inggris).
2. **Kondisi zona pada objek non-zona, atau sebaliknya** — ditolak saat create. Server memvalidasi
   pasangan `cond` × `pOff`, bukan memercayai frontend: `enter`/`exit` wajib `pOff != 0`, dan
   `cross`/`up`/`down` wajib `pOff == 0`.
3. **Garis batas kedua dari titik yang berimpit** (`i2 == i1`, zona selebar nol dalam waktu) —
   pembagian nol di frontend. `zoneAnchorsOf` mengembalikan `null` → tombol Create menolak dengan
   toast yang sudah ada.
4. **Baris alert lama** — `p_off` NULL dibaca 0, `cond` tetap cross/up/down, perilakunya identik.

## Rencana verifikasi

**Go unit (bukti utama):**

- `zoneBounds`: `pOff` positif & negatif memberi `lo/hi` yang sama (urutan dinormalkan); zona miring
  bergerak menurut jam dagang, bukan wall-clock (kasus Kamis→Senin seperti #181).
- `evalAlert` kondisi `enter`: harga masuk pita → menyala; bergerak di dalam pita → tidak; tick
  pertama (tanpa baseline) → tidak.
- `evalAlert` kondisi `exit`: kebalikannya.
- **Zona bergerak melewati harga yang DIAM** menyalakan `enter` — kasus yang membedakan zona miring
  dari zona datar, dan sejajar dengan `TestSlopedLineCrossesWithoutPriceChange` (#180).
- **Mengubah `pOff` membatalkan baseline**: menyeret sisi zona tidak boleh menyalakan `enter`/`exit`.
- Regresi #180/#181: alert garis (`pOff == 0`) memberi hasil identik.

**E2E hermetik (`--project=hermetic`):** ketiga tool zona punya tab Alert; dropdown-nya berisi
Entering/Exiting (bukan Crossing); POST membawa `pOff != 0`; `priceChannelLine` mengirim anchor yang
sudah digeser sehingga garis tengah berada tepat di tengah `p1` dan `p1+pOff`; menggeser zona
mengirim anchor baru. Test `tab Alert TIDAK muncul untuk rect` dari #180 **dibalik**.

**Yang tak bisa diuji:** pemicuan sungguhan butuh pasar buka — bukti utamanya test Go dengan tick
sintetis, seperti #180 dan #181.

## Risiko rilis

Rollback ke versi sebelum PR ini: baris alert zona masih ada, `cond` berisi `enter`/`exit` yang tak
dikenal kode lama, dan `p_off` diabaikan. Kode lama akan memperlakukannya lewat cabang `default`
`sideHit` — yaitu sebagai **cross** pada batas pertama. Alertnya jadi salah, bukan diam. Kalau
rilis ini di-rollback, hapus baris `price_alerts` dengan `cond IN ('enter','exit')`.

## Non-goals

- Inside/Outside (butuh alert berulang lebih dulu).
- Ikon jam di floating toolbar per-objek (Luna belum punya toolbar itu).
- Zona dari tool lain (fib, ellipse, circle).
- Membatasi alert pada rentang waktu kotak.
