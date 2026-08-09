# Alert dari objek gambar — garis (A5 / T1.4, bagian 1 dari 2)

Tanggal: 2026-08-09 · Status: disetujui, siap dikerjakan

Klik-kanan sebuah garis → tab **Alert** → pilih kondisi → alert dibuat, **terikat pada garis itu**.
Level alert mengikuti garisnya, dan kalau garisnya digeser, alertnya ikut pindah.

Ini bagian **pertama** dari dua. Zona (channel & rectangle: *Entering / Exiting / Inside / Outside*)
**dan garis MIRING** punya specnya sendiri — lihat "Kenapa dipecah" di bawah.

> **Amandemen 2026-08-09 (review akhir cabang, C1): v1 HANYA garis HORIZONTAL.**
> Enam objek keluarga garis diciutkan jadi tiga: `horizontalStraightLine`, `horizontalRayLine`,
> `priceLine`. Alasannya ada di "Kenapa dipecah jadi dua spec" di bawah (basis waktu). Semua
> keputusan lain di dokumen ini tetap berlaku apa adanya — skema, monitor, dan mesin garisnya tak
> berubah, karena garis horizontal adalah kasus `p1 == p2` dari rumus yang sama.

## Yang terverifikasi dari TradingView (jangan riset ulang)

| Fakta | Sumber |
|---|---|
| Alert dibuat dari **klik-kanan objeknya** (atau ikon jam di toolbar melayang objek) | `tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts` |
| Kondisi untuk **garis**: *Crossing*, *Crossing up / Crossing down*, *Greater than / Less than* | idem |
| Kondisi untuk **channel**: *Entering / Exiting / Inside / Outside channel*; **rectangle**: *Entering / Exiting / Inside / Outside rectangle* | idem |

**Tidak terdokumentasi di mana pun:** apa yang terjadi pada alert bila objeknya digeser atau dihapus,
dan apakah garis dievaluasi sebagai ruas atau sebagai perpanjangan tak hingga. Keputusan di bawah
karena itu **pilihan kita**, bukan klaim tentang perilaku TV.

## Kenapa dipecah jadi dua spec

Garis dan zona terlihat bertetangga, tapi mesinnya berbeda:

- **Basis waktu garis miring** *(alasan yang ditemukan di review akhir, 2026-08-09 — dan alasan
  garis miring ikut pindah ke spec kedua)*. Anchor alert adalah **milidetik wall-clock**, dan
  monitor mengekstrapolasi `level(t)` linear dalam **waktu kalender**. Tapi chart menggambar
  sumbu-x linear dalam **indeks bar**. Keduanya hanya sepakat pada instrumen **tanpa jeda sesi**.
  Forex tak punya bar selama ~48 dari 168 jam tiap pekan; saham hanya 6,5 dari 24 jam tiap hari
  (≈3,7× lebih cepat lari sejak hari pertama). Akibatnya garis yang diekstrapolasi berjalan **jauh
  mendahului garis yang digambar pengguna** — untuk forex bisa hitungan hari, dan karena monitor
  hidup melewati akhir pekan, tick pertama Senin bisa menyalakan alert garis miring **berbondong-
  bondong** saat chart dan harga sama sekali tak berdekatan dengan levelnya.
  Keputusan wall-clock di dokumen ini **dibuat tanpa menganalisis jeda sesi** — itu cacat spec,
  bukan cacat implementasi; kode hari ini mengerjakan persis apa yang tertulis. Basis waktu yang
  benar (indeks bar? kalender sesi? waktu dagang?) adalah keputusan rancangan tersendiri, dan
  dirancang di spec kedua bersama zona. **Garis horizontal tak tersentuh sama sekali**: levelnya
  konstan, jadi basis waktunya tak berpengaruh — karena itu ia yang dirilis di v1.
- **Garis** → setiap saat ia satu angka, `level(t)`. Monitor cukup memakai ulang
  `crossed(prev, cur, lvl)` yang sudah ada. **Tanpa state.**
- **Zona** → *Entering/Exiting* menuntut monitor mengingat "sebelumnya di dalam atau di luar"
  **per alert**; sekarang monitor hanya menyimpan satu angka per instrumen (`last[instrument]`,
  `alert_monitor.go:40`). Itu perubahan bentuk, bukan penambahan baris.
- **Rectangle** punya rentang **waktu**, bukan cuma rentang harga — dan TV tak mendokumentasikan
  apakah alert pada kotak yang sudah lewat masih boleh berbunyi. Itu keputusan produk yang pantas
  dibahas sendiri, bukan diselipkan.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Objek yang didukung | **garis HORIZONTAL saja**: `horizontalStraightLine`, `horizontalRayLine`, `priceLine` | garis miring & zona menyusul di spec kedua — lihat "Kenapa dipecah" (basis waktu). Tool miring **tidak** diterima walau kebetulan datar (`p1===p2`): pengguna bisa menyeret satu ujungnya sesudahnya dan diam-diam mendapat kasus miring yang baru ditunda. Untuk tool yang didukung, `p1===p2` dijamin **secara konstruksi** — harga diambil dari `points[0]` untuk kedua anchor, sebab nilai titik kedua `horizontalRayLine` tak selalu tersinkron (muatan lama) |
| Kondisi | **Crossing · Crossing up · Crossing down** | arah bermakna nyata di garis miring, dan ketiganya tetap tanpa state. *Greater/Less than* dilewati: itu KEADAAN, bukan lintasan, jadi ia menuntut aturan pengulangan yang alert Luna belum punya konsepnya (semua one-shot) |
| Ikatan ke objek | **menempel** lewat id stabil `did` | trader menggeser garisnya terus; alert yang cuma salinan akan diam-diam menjaga level lama |
| Nama field id | **`did`**, bukan `oid` | `a.oid` di frontend sudah berarti "id overlay garis alert" (`js/forming-candle.js:112`); dua arti untuk satu nama di file yang sama = bug murah yang mahal |
| Penyimpanan | **menumpang `price_alerts`** + kolom nullable | alert garis bukan jenis baru — ia alert yang levelnya berubah. Satu monitor, satu daftar UI, satu jalur hapus |
| Evaluasi garis | **perpanjangan tak hingga**, bukan hanya ruasnya | trader menggambar trendline justru untuk mengawasi apa yang terjadi SESUDAH titik terakhir; alert yang mati di ujung ruas berhenti bekerja tepat saat paling dibutuhkan |
| Geser garis | anchor alert ikut diperbarui | lihat "Daur hidup" |
| Hapus garis | alertnya ikut terhapus | |
| Undo hapus garis | alert **tidak** hidup kembali | undo Luna adalah snapshot gambar; alert punya daur hidup sendiri. Menyatukannya = memasukkan alert ke riwayat undo, jauh lebih besar dari nilainya |
| Salinan (clone/paste) | dapat `did` **baru**, tak mewarisi alert | salinan adalah objek lain |
| Penanda di kanvas | **tak ada** di v1 | garisnya sudah ada — itu objeknya. Lencana 🔔 kandidat lanjutan |
| Sifat one-shot | **tak berubah** | `active` / `triggered_at` seperti sekarang |

## Model data

`price_alerts` (`store.go:177`) ditambah kolom nullable lewat `addColumnIfMissing()` yang sudah
dipakai repo ini (`store.go:69`: `users.picture`, `journal.sl`, `journal.tp`) — baris lama tetap
sah, tak ada migrasi:

| Kolom | Isi |
|---|---|
| `cond` | `'cross'` (default) · `'up'` · `'down'` |
| `draw_id` | `did` objek gambarnya; `NULL` untuk alert harga biasa |
| `t1`, `p1`, `t2`, `p2` | dua anchor garis: waktu wall-clock ms + harga; `NULL` untuk alert biasa |

Level pada waktu `t`:

```
level(t) = p1 + (p2 - p1) * (t - t1) / (t2 - t1)
```

Garis horizontal menghasilkan `p1 == p2`, jadi rumus yang sama memberi konstanta — **satu jalur
kode untuk miring dan datar**, tak ada cabang "kalau horizontal maka…". Alert harga biasa (`t1`
NULL) tetap memakai kolom `price`.

`t1 == t2` (garis vertikal sempurna) **ditolak saat pembuatan**, bukan dijaga saat evaluasi: garis
vertikal tak punya "harga pada waktu t" yang bermakna, dan menolaknya di pintu masuk lebih jujur
daripada diam-diam memilih salah satu ujungnya.

## Evaluasi (monitor)

`alert_monitor.go` berubah tipis. Per tick, per alert: hitung `lvl` (konstan untuk alert biasa,
`level(now)` untuk alert garis), lalu uji **perubahan tanda jarak** `d = harga − level`, dengan sisi
sebelumnya diukur terhadap **level sebelumnya** (`prevLvl` dari `levelTracker`, anchor yang sama):

- `up` → `dPrev < 0 && dCur >= 0`
- `down` → `dPrev > 0 && dCur <= 0`
- `cross` → salah satu dari keduanya (= `crossed(dPrev, dCur, 0)`)

Satu uji ini menutup dua gerakan sekaligus: harga melewati garis yang diam, **dan** garis melewati
harga yang diam. Tanpa baseline yang sah (belum ada entry tracker, atau anchornya berubah sejak tick
terakhir) tick itu **dilewati** — bukan ditebak dengan memakai level sekarang sebagai pengganti level
sebelumnya, sebab itu mengarang persilangan tiap kali level melompat (pengguna menyeret garis, proses
lanjut sesudah jeda, perangkat lain memindahkannya). Untuk alert harga biasa `prevLvl == lvl ==
price`, jadi perilakunya identik dengan sebelum fitur ini.

*(Amandemen review akhir: versi awal spec ini memakai `condHit(prev, cur, lvl)` — harga LAMA vs level
BARU — plus jalur "level bergerak" terpisah yang menyala tanpa melihat `cond` sama sekali. Yang
pertama mengarang persilangan; yang kedua menyalakan `up` saat garis bergerak TURUN, dan karena
one-shot, persilangan sungguhannya tak pernah bisa menyala lagi.)*

Cache 2 detik, `last[instrument]`, dan one-shot tetap. `AllActiveAlerts` mengembalikan kolom baru
sehingga monitor tak perlu query kedua.

## Daur hidup ikatan

**Id stabil.** `objDid[overlayId] = did` — peta samping, pola yang sudah dipakai `objStyle`
(`js/draw-style.js:47`) untuk data per-objek yang bukan milik klinecharts. Ikut terserialisasi
sebagai field `did` di muatan gambar, dipulihkan di `buildDrawsFromArray`.

`did` dibuat di **satu** tempat: saat objek didaftarkan ke `drawIds`. Ada empat jalur pembuatan
objek (`onDrawEnd`, restore, instant-drop, `createFromDesc`), dan pelajaran PR #178 tepat di sini —
`applyXDateFlag` pernah terlewat di salah satunya justru karena tersebar.

**Objek lama** (tersimpan sebelum fitur ini) tak punya `did` → diberi satu saat dimuat, di memori.
Membuat alert selalu memicu penyimpanan gambar lebih dulu, jadi `did`-nya pasti sudah ada di server
sebelum ada baris alert yang menunjuknya.

**Geser garis → alert ikut.** Bukan lewat hook per-gestur, melainkan menumpang irama simpan yang
sudah ada: setiap kali gambar tersimpan, anchor tiap alert milik instrumen ini dihitung ulang dari
objeknya dan didorong ke server bila berubah. Satu tempat, bukan lima — dan otomatis ikut benar
untuk drag, kunci sudut Shift, magnet, semuanya.

**Undo/redo perlu satu panggilan sendiri.** `applyDrawsSnapshot` (`js/draw-undo.js`) sengaja TIDAK
lewat `saveDraws()` — ia mendorong snapshotnya sendiri ke lapisan sync — padahal `saveDraws()` adalah
satu-satunya pemanggil `syncAlertAnchors()`. Jadi ia memanggilnya sendiri, sesudah gerbang
`suppressDrawSave`. *(Amandemen review akhir: klaim "otomatis ikut benar untuk undo/redo" di versi
awal spec ini tidak benar sampai panggilan itu ditambahkan.)*

**Hapus garis → alertnya ikut hilang**, lewat dua jalur yang perannya berbeda:

- **Seketika** saat objeknya dihapus di sesi ini — hook `onRemoved` di `delHooks()`
  (`js/draw-tools.js`) sudah ada dan sudah dipakai untuk membersihkan `drawIds`;
- **Penyapuan** saat memuat instrumen, sebagai jaring untuk penghapusan yang terjadi di tempat lain
  (perangkat lain, atau saat tab ini tertutup).

Penyapuan itu **hanya** boleh jalan sesudah instrumen tersebut selesai dimuat (`suppressDrawSave`
sudah lepas), dan hanya menyentuh alert instrumen itu. Aturan naif tanpa gerbang ini akan
memusnahkan semua alert setiap kali chart sedang kosong saat memuat.

*(Amandemen review akhir)* "Selesai dimuat" **tidak sama dengan** "dimuat secara otoritatif": kalau
`GET /api/drawings` gagal, `loadDrawsFor` jatuh ke cermin localStorage — kosong di browser baru,
jendela private, atau sesudah data situs dibersihkan — dan sapuan akan menyimpulkan semua alert
kehilangan objeknya lalu menghapusnya di server tanpa bisa dikembalikan. Karena itu sapuan juga
menolak jalan saat `drawVer[inst] == null`, **predikat yang sama** yang sudah dipakai jalur dorong
untuk menolak mendorong: kalau kita tak boleh MENULIS gambar saat versi server tak diketahui, kita
jelas tak boleh MENGHAPUS alert atas dasar keadaan gambar yang sama-sama tak diketahui itu.

## Antarmuka

**Tab "Alert"** di modal setelan objek (`js/draw-style-modal.js:62`, pola tab `Style`/`Text` yang
sudah ada), hanya untuk objek keluarga garis. Isinya: pilihan kondisi + tombol **Create alert**;
kalau objek itu sudah punya alert, tab menampilkannya beserta tombol hapus. Teks UI **Inggris**.

Klik-kanan objek sudah membuka modal ini, jadi tak ada interaksi baru — dan klik-kanan objek tak
perlu dibongkar (itu sudah dinyatakan PR sendiri di `2026-08-08-copy-paste-objek-design.md`).

**Daftar alert** (`renderAlertList`, `js/forming-candle.js:115`) sekarang menulis "Crossing"
hardcoded. Ia harus menampilkan kondisi sebenarnya dan asal-usulnya — mis. `EUR_USD · Trendline ·
Crossing up`. Tanpa itu, tiga kondisi baru jadi tak terbedakan di satu-satunya tempat pengguna
melihat alertnya.

**Kanvas:** alert terikat objek **tidak** menggambar `alertLine` sendiri (garisnya sudah ada).
Alert harga biasa tak berubah.

### Titik sentuh

| Berkas | Perubahan |
|---|---|
| `store.go` | kolom `cond`/`draw_id`/`t1`/`p1`/`t2`/`p2` via `addColumnIfMissing`; `AlertRow` + field baru; `CreateAlert` menerima kondisi & anchor; `UpdateAlertAnchors`; `DeleteAlertsByDrawing` |
| `alert_monitor.go` | `levelAt(row, now)` + tiga kondisi |
| `api.go` | `POST /api/alerts` menerima `cond`+`did`+anchor; endpoint pembaruan anchor & hapus-per-`did` |
| `js/draw-persist.js` | `did` ikut `serializeDraws` / `buildDrawsFromArray`; backfill objek lama |
| `js/draw-alert.js` (baru) | tab Alert, buat/hapus, sinkron anchor & penyapuan objek terhapus |
| `js/draw-style-modal.js` | tab "Alert" untuk objek keluarga garis |
| `js/forming-candle.js` | label daftar alert: kondisi + asal |
| `tests/fixtures/api.js` | stub `/api/alerts` menerima field baru |
| `tests/smoke/boot-integrity.spec.js` | entri `SENTINEL` modul baru |

## Verifikasi

**Batasan yang dinyatakan di muka:** monitor hanya menyala oleh tick sungguhan, dan tick live hanya
ada **saat pasar buka**. Jadi "buktikan alertnya berbunyi" tak bisa dijamin lewat verifikasi manual
kapan saja. Bukti utamanya karena itu di Go, bukan di browser.

**Go** (`alert_monitor_test.go` sudah punya polanya: `TestCrossed`, `TestMonitorOneShot`):
1. `level(t)` garis miring — pada tiga waktu berbeda, termasuk sebelum `t1` dan sesudah `t2`
   (perpanjangan tak hingga). *Mesinnya diuji sekarang walau tool miring baru dirilis di spec kedua;*
   *bug yang tidur dengan test jauh lebih murah daripada bug yang tidur tanpa test.*
2. `p1 == p2` → level konstan (jalur horizontal lewat rumus yang sama);
3. `t1 == t2` ditolak saat pembuatan;
4. tiga kondisi: `cross` menyala dua arah, `up` hanya naik, `down` hanya turun;
5. garis yang **belum** terlewati pada `t` awal tapi terlewati kemudian tanpa harga berubah —
   yang bergerak adalah levelnya;
6. *(amandemen)* arah dihormati pada pergerakan LEVEL juga: garis yang bergerak NAIK melewati harga
   yang diam menyalakan `down`, bukan `up`;
7. *(amandemen)* dua tick di sisi yang sama (masing-masing terhadap levelnya sendiri) tak menyalakan
   apa pun, dan tanpa baseline yang sah evaluasi dilewati;
8. *(amandemen)* alert harga biasa memberi hasil identik dgn semantik lama — bukti tak ada regresi;
9. one-shot tetap: satu trigger → tak lagi aktif;
10. isolasi antar pengguna pada endpoint baru.

**E2E hermetik** (`tests/drawing/86-alert-garis.spec.js`):
1. tab **Alert** muncul untuk ketiga tool horizontal, **tidak** muncul untuk `rect` maupun untuk
   ketiga tool miring;
2. ketiga tool horizontal: membuat alert mengirim `cond` + `did` + empat anchor, dengan
   `p1 === p2` dan `t1 !== t2`;
3. menggeser garis memperbarui anchor di server; **undo sesudahnya mengembalikan anchor itu juga**;
4. menghapus garis menghapus alertnya;
5. memuat ulang instrumen dgn chart kosong sesaat **tidak** menghapus alert (gerbang penyapuan), dan
   **GET gambar yang GAGAL + cermin lokal kosong juga tidak** (gerbang otoritatif);
6. ganti instrumen bolak-balik dgn gambar NYATA di kedua simbol: kedua alert selamat;
7. daftar alert menampilkan kondisi & asal **sesudah satu putaran poll**, bukan "Crossing" hardcoded;
8. refresh pane yang tertunda tak menulis ulang modal objek lain;
9. clone/paste garis ber-alert menghasilkan objek tanpa alert (`tests/drawing/85-draw-did.spec.js`).

Sebelum push: `go test ./...` + `npx playwright test tests/smoke --project=hermetic`.

## Di luar cakupan

- **Garis MIRING** (`trendline`, `rayLine`, `straightLine`) — spec kedua, bersama rancangan
  **basis waktu**-nya (lihat "Kenapa dipecah"). Mesin garis di server (`level(t)`, kolom anchor,
  `sideHit`) sudah ada dan tetap benar; yang belum dirancang adalah *dalam waktu apa* `t` diukur.
- **Zona** (channel & rectangle) — spec kedua, termasuk state per-alert dan keputusan rentang-waktu
  rectangle.
- *Greater than* / *Less than* — butuh konsep pengulangan yang alert Luna belum punya.
- Lencana 🔔 di kanvas untuk menandai garis ber-alert.
- Alert dari indikator, dan alert multi-kondisi.
- Object Tree (C1) — `did` yang lahir di sini adalah prasyaratnya, tapi bukan bagiannya.
