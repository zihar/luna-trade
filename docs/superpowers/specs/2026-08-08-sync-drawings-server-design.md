# Sync drawings ke server (C4)

Tanggal: 2026-08-08 · Status: disetujui, siap dikerjakan

Gambar pengguna pindah dari `localStorage` per-instrumen ke server per-pengguna, sehingga ia ikut
saat ganti browser atau perangkat. Ini satu-satunya sisa backlog drawing di mana pengguna bisa
**kehilangan pekerjaannya sendiri**, bukan sekadar kurang nyaman — alerts sudah per-user di server
sejak PR #52/#53, drawings tertinggal.

## Yang terverifikasi dari TradingView (jangan riset ulang)

| Fakta | Sumber |
|---|---|
| TV memperingatkan **"Your chart layout was changed"** saat layout tersimpan di tempat lain, dan menyimpan lagi berarti *"all modifications made on a different device/in a different browser or tab will be lost"* | `tradingview.com/support/solutions/43000484320` |
| Sinkronisasi gambar real-time lintas tab/perangkat hanya berlaku **saat autosave layout menyala** | idem, hasil pencarian dokumentasi TV |

TV karena itu punya **dua mode**, dan Luna hanya punya satu: tak ada tombol Save, semuanya
autosave. Rancangan ini mencerminkan **mode peringatan** TV (beri tahu, jangan blokir, pengguna
yang memutuskan) meski Luna autosave — karena mode autosave TV menyelesaikan bentrok dengan
mengambil versi terbaru diam-diam, dan itu persis kehilangan-senyap yang ditolak di tabel keputusan.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Bentrok antar perangkat | **Last-write-wins + deteksi versi** | satu kolom + satu perbandingan; mengubah kehilangan senyap jadi kejadian yang terlihat & bisa dipilih |
| Bentuk penyimpanan | **satu blob JSON per (user, instrumen)**, format identik `serializeDraws()` | normalisasi per objek butuh id objek yang STABIL — belum ada (id dibuat ulang tiap restore) — dan akan menyeret format simpan, jalur restore, dan undo sekaligus |
| Peran `localStorage` | **cermin yang hanya DIBACA saat request gagal** | jaringan putus tak boleh membuat gambar seolah lenyap; tapi sumber kebenaran cuma satu |
| Migrasi | **adopsi otomatis per simbol** saat server masih kosong untuk simbol itu | tanpa dialog, tanpa langkah manual, dan hanya menyentuh simbol yang benar-benar dibuka |
| UX saat 409 | toast **"Your drawings were changed on another device"** + aksi **Reload** / **Keep mine** | mencerminkan peringatan TV: memberi tahu lalu membiarkan pengguna menimpa, bukan memaksa |
| Irama dorong ke server | debounce **1,5 dtk**, di ATAS debounce lokal 350 ms yang tak berubah | rasa lokal tak berubah sama sekali; yang naik ke jaringan hanya versi yang sudah tenang |
| Flush terakhir | `fetch(…, {keepalive:true})`, **bukan** `navigator.sendBeacon` | semantiknya sama, tapi ia lewat jalur yang bisa dicegat `page.route` → jaring pengamannya ikut TERUJI, bukan cuma diklaim |
| `PRAGMA synchronous=NORMAL` | **tidak** di PR ini | mengubah jaminan durabilitas SELURUH aplikasi demi kecepatan yang belum terbukti dibutuhkan |
| Normalisasi objek jadi baris sendiri | **tidak** | lihat "Bentuk penyimpanan" |

## Server

```sql
CREATE TABLE IF NOT EXISTS drawings(
  user_id    INTEGER NOT NULL,
  instrument TEXT    NOT NULL,
  payload    TEXT    NOT NULL,   -- JSON, format identik serializeDraws()
  version    INTEGER NOT NULL,   -- +1 tiap tulis yang diterima
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, instrument)
);
```

Primary key gabungan **sudah** jadi indeksnya; tak ada query yang memindai (selalu
`WHERE user_id=? AND instrument=?`), dan tak ada `AUTOINCREMENT` karena tak ada yang perlu
menunjuk baris ini dari luar. Skemanya menyusul `price_alerts` (`store.go:177`) dan dipasang lewat
jalur `migrate()` yang sudah ada.

Dua endpoint, keduanya di balik `requireUser` (`auth.go:176`) seperti `/api/alerts`. Repo ini hanya
memakai GET/POST — tak ada satu pun PUT — jadi penyimpanan pakai POST.

- **`GET /api/drawings?instrument=EUR_USD`** → `{payload:[…], version:N}`.
  Belum ada barisnya → `{payload:[], version:0}` **bukan 404**: "belum pernah menggambar" bukan
  kondisi error, dan 404 akan memaksa klien membedakan dua hal yang sama saja baginya.
- **`POST /api/drawings`** body `{instrument, payload, baseVersion}`:
  - `baseVersion` == versi server → simpan, balas `{version: baseVersion+1}`
  - tak cocok → **409** berisi `{version, payload}` **milik server**. Isinya dikirim sekalian
    supaya klien bisa menawarkan Reload tanpa perjalanan kedua yang bisa gagal terpisah.
  - `payload` > **256 KB** → **413**. Satu akun tak boleh bisa menumbuhkan satu baris tanpa batas;
    256 KB ≈ 1.400 objek dalam satu simbol, jauh di atas pemakaian nyata (objek ≈ 180 byte).

Penulisan memakai **satu** pernyataan `INSERT … ON CONFLICT(user_id,instrument) DO UPDATE SET …
WHERE version = ?` sehingga pemeriksaan versi dan penulisan tak terpisah. Ini bukan gaya: seluruh
akses DB diserialkan lewat `SetMaxOpenConns(1)` (`store.go:35`), jadi transaksi baca-lalu-tulis
akan menahan SEMUA fitur lain (alert monitor, paper monitor, analitik) selama ia berjalan.

## Klien

Modul baru **`js/draw-sync.js`** memegang jaringan + state versi per instrumen.
`js/draw-persist.js` tetap memegang serialisasi (`serializeDraws`) dan pembangunan objek
(`buildDrawsFromArray`) — batas yang sudah benar hari ini dan tak perlu digeser.

**Memuat.** `loadInit` (`js/load-chart.js`) sudah menunggu `/api/candles`; fetch drawings
dijalankan **berbarengan** dengan itu, jadi tak ada tunggu tambahan yang terasa — candles jauh
lebih berat. Hasilnya masuk ke `buildDrawsFromArray()` yang sudah ada, tak berubah.
`restoreDraws()` yang kini sinkron menjadi asinkron; itu satu-satunya perubahan bentuk di jalur muat.

**Menyimpan.** Dua irama yang sengaja berbeda:

- `scheduleSaveDraws()` 350 ms — **tak berubah**: localStorage + `recordDrawHistory` (undo/redo
  tetap lokal & instan, jadi rasa memakainya tak bergeser sedikit pun);
- dorongan ke server didebounce **1,5 dtk** di atasnya, di-flush saat `visibilitychange` → hidden
  dan saat `beforeunload`.

**Bentrok (409).** Toast dengan teks Inggris **"Your drawings were changed on another device"** dan
dua aksi:
- **Reload** — pakai payload server yang ikut di badan 409, buang yang lokal;
- **Keep mine** — dorong ulang dengan versi server sebagai `baseVersion` → menimpa, persis akibat
  yang TV peringatkan.

Selama belum dipilih, dorongan otomatis untuk simbol itu **berhenti**. Tanpa itu, tiap 1,5 detik
kita menembak 409 lagi dan toast berubah jadi kebisingan yang justru diabaikan pengguna.

**Migrasi.** Saat memuat simbol X: server balas `version: 0` + `payload: []` sementara
`localStorage['br_draws_X']` berisi → unggah yang lokal sekali dengan `baseVersion: 0`, lalu pakai
itu. Konsekuensi yang diterima: perangkat lama yang dibuka lagi bisa mengunggah gambar usang ke
simbol yang server-nya masih kosong. Terbatas (hanya simbol yang server-nya belum punya apa-apa)
dan tak menghapus apa pun.

**Gagal jaringan.** GET gagal → baca `localStorage` supaya gambar tetap tampil, **tapi dorongan
dimatikan untuk simbol itu sampai ada GET yang berhasil.** Ini bukan kehati-hatian berlebih: tanpa
GET sukses kita tak tahu `baseVersion`, dan menebaknya berarti menimpa pekerjaan perangkat lain —
kegagalan yang persis ingin dicegah seluruh rancangan ini. 401 diperlakukan sama (chart sendiri
butuh login, jadi keadaan ini praktis tak terjadi).

### Titik sentuh

| Berkas | Perubahan |
|---|---|
| `store.go` | skema `drawings` + `GetDrawings` / `SaveDrawings(userID, instrument, payload, baseVersion)` |
| `api.go` | `GET /api/drawings`, `POST /api/drawings`, keduanya `requireUser` |
| `js/draw-sync.js` (baru) | fetch/push, state versi per instrumen, debounce 1,5 dtk, flush keepalive, penanganan 409 |
| `js/draw-persist.js` | `restoreDraws()` jadi asinkron & bersumber server; localStorage turun pangkat jadi cermin/fallback |
| `js/load-chart.js` | fetch drawings dibarengkan dengan fetch candles |
| `index.html` | `<script src="/js/draw-sync.js">` sebelum `draw-persist.js` |
| `tests/fixtures/api.js` | stub `/api/drawings` dengan state (payload+version) per instrumen |
| `tests/smoke/boot-integrity.spec.js` | entri `SENTINEL` untuk modul baru |

## Jebakan

- **Suite yang ada menguji "gambar selamat dari reload"** (mis. `tests/drawing/83-copy-paste.spec.js`
  menunggu 600 ms lalu reload). Begitu sumber muat pindah ke server, reload dalam <1,5 dtk memuat
  versi server yang belum memuat editan terakhir → test merah, **dan pengguna sungguhan kehilangan
  gestur terakhirnya kalau menutup tab dengan cepat**. Flush `beforeunload` adalah penawarnya, dan
  itulah alasan `fetch(keepalive:true)` dipilih di atas `sendBeacon` — supaya jaring itu ikut teruji.
- **Stub hermetik harus menyimpan state**, bukan mengembalikan array kosong: state di
  `tests/fixtures/api.js` dipegang closure route sehingga bertahan lewat `page.reload()`. Stub yang
  "selalu balas kosong" akan membuat setiap test persistensi hijau palsu/merah palsu.
- **Ganti instrumen saat dorongan masih tertunda.** Debounce 1,5 dtk berarti ada jendela di mana
  `inst` sudah berubah tapi muatan yang antre milik simbol lama. Dorongan karena itu **membawa nama
  instrumennya sendiri, ditangkap saat dijadwalkan** — bukan membaca `inst` saat dikirim — dan
  `loadInit` mem-flush antrean simbol lama sebelum memuat yang baru. Tanpa keduanya, gambar EUR
  bisa tersimpan ke baris XAU: kerusakan senyap yang baru ketahuan berhari-hari kemudian.
- `clearDrawings()` saat ganti instrumen tak boleh terkirim sebagai "hapus semua" ke server;
  gerbangnya `suppressDrawSave` yang sudah ada, dan jalur dorong wajib menghormatinya persis seperti
  `saveDraws()`.
- `PERSIST_DRAW` (`js/draw-persist.js:6`) tetap jadi penyaring di kedua arah; objek yang dicabut
  dari rail berhenti dimuat tanpa migrasi, sifat yang sudah ada dan harus dipertahankan.
- Undo/redo tetap **lokal** dan berbasis snapshot (`js/draw-undo.js`) — tak ada undo lintas
  perangkat, dan itu memang tak dijanjikan.

## Verifikasi

**Go (`store_test.go` / handler test)** — mengikuti pola `*_test.go` yang sudah ada:
1. baris baru: `baseVersion 0` pada instrumen kosong → tersimpan, `version` jadi 1;
2. `baseVersion` cocok → tersimpan, versi naik;
3. `baseVersion` basi → **ditolak**, isi baris tak berubah;
4. payload > 256 KB → ditolak (413);
5. isolasi antar pengguna: user A tak bisa membaca/menimpa baris user B;
6. GET pada instrumen yang belum ada → `{payload:[], version:0}`, bukan 404.

**E2E hermetik (`tests/drawing/84-draw-sync.spec.js`)**:
1. gambar dimuat **dari server** (stub berisi satu objek → muncul tanpa localStorage);
2. menggambar → dalam ~2 dtk ada POST dengan `baseVersion` benar; stub menyimpannya;
3. reload → objek masih ada (jalur server, bukan localStorage);
4. **flush cepat**: gambar lalu langsung reload (<1,5 dtk) → objek tetap selamat (membuktikan
   `beforeunload` + keepalive benar-benar jalan);
5. server balas 409 → toast muncul, objek lokal **tidak** tergantikan, dan **tak ada POST lanjutan**
   sampai aksi dipilih;
6. **Reload** pada toast → isi server yang dipakai; **Keep mine** → POST ulang dengan versi server
   dan menang;
7. adopsi: server kosong + localStorage berisi → satu POST `baseVersion 0`, objek tampil;
8. GET gagal (stub 500) → objek dari localStorage tampil, dan **tak ada POST sama sekali**.

Sebelum push: `npx playwright test tests/smoke --project=hermetic` + `go test ./...`.

## Di luar cakupan

- Object Tree (C1), template gaya default per tool (C2), visibility per-TF (C3).
- Merge per objek & id objek yang stabil — prasyaratnya sendiri, PR sendiri.
- Sinkron real-time antar tab yang sedang terbuka (TV melakukannya di mode autosave). Di sini
  bentrok hanya terdeteksi saat menyimpan, bukan didorong hidup-hidup ke tab lain.
- `PRAGMA synchronous=NORMAL` dan menaikkan `SetMaxOpenConns` — perubahan global, PR sendiri.
