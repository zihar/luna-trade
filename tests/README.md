# E2E test UI (Playwright)

Suite ini menguji aplikasi lewat **UI sungguhan**: rail drawing diklik, mouse asli
menggambar di canvas, state dibaca dari bookkeeping aplikasi sendiri (`drawIds` +
`chart.getOverlayById`). Tak ada `chart.createOverlay()` yang dipanggil langsung — itu akan
melewati jalur yang justru mau diuji.

## Menjalankan

```bash
npm install                 # sekali; hanya devDependency @playwright/test
npx playwright install chromium

npm test                    # seluruh suite hermetik
npm run test:drawing        # hanya drawing
npm run test:smoke          # hanya smoke non-drawing
npx playwright test --ui    # mode interaktif
```

Tak butuh `.env`, token OANDA, `luna.db`, atau binary Go. Static server + **semua**
endpoint `/api/*` distub, dan klinecharts dilayani dari salinan lokal — jadi suite jalan
offline dan hasilnya tak berubah karena pasar tutup.

Setelah run:

- **`report/gallery.html`** — kartu per tool: `preview.png` / `final.png` / `diff.png` +
  angka Δpx, diurut Δ terbesar di atas. Buka ini untuk yang tak bisa diassert (garis tak
  kelihatan, arrowhead salah arah, warna default aneh).
- **`playwright-report/index.html`** — report standar + trace untuk test yang gagal.

### Test integrasi (opsional)

```bash
PORT=8765 ./luna-trade          # butuh .env
npm run test:integration
```

Gunanya satu: menjaga stub tak melenceng dari respons server sungguhan. Kalau bentuk
respons berubah di backend, suite hermetik bisa tetap hijau sementara aplikasi nyata rusak.

### Mode `live` (opsional) — spec UI yang sama, tapi ke server & akun sungguhan

```bash
PORT=8765 ./luna-trade                                        # butuh .env
LUNA_LIVE=1 npx playwright test tests/drawing/31-drag-precision.spec.js \
  --project=live --workers=1
```

`LUNA_LIVE=1` membuat `gotoApp` **melewati semua stub** dan login lebih dulu lewat
`POST /api/auth/login` (kredensial dari `LUNA_TEST_EMAIL`/`LUNA_TEST_PASSWORD`, default akun
test lokal), jadi chart memuat candle OANDA nyata. Gunanya satu: memastikan sebuah temuan bukan
artefak fixture (`barSpace` fixture 8px, 500 bar tetap, harga sintetis).

Dua hal yang wajib diketahui sebelum memakainya:

- **Pakai `--workers=1`.** Beberapa worker terhadap satu server + data nyata menghasilkan
  kegagalan palsu: pernah terukur 35 dari 38 merah dengan 2 worker, sementara test yang sama
  dijalankan sendiri **lolos**, dan 29 merah dengan 1 worker. Yang berubah lingkungan, bukan
  aplikasinya.
- **Bahkan dengan 1 worker, run yang panjang masih menghasilkan merah yang tak reproducible.**
  Terukur pada `31-drag-precision.spec.js` setelah Temuan 6 diperbaiki: hermetik 38/38 hijau,
  live 22/38 dalam satu run penuh — tapi test yang sama (`circle`, `ellipse`, `arrow`) **lolos**
  saat dijalankan sebagai subset kecil. Yang gagal selalu assertion **boolean** (`selectedId`
  setelah klik, atau "badan diseret tapi tak ada titik yang pindah") — yaitu objek gagal
  di-grab — **bukan** assertion presisi pixel. Jadi kalau mode live merah, periksa dulu apakah
  yang gagal boolean-nya: itu tanda interaksi tak nyangkut di lingkungan live, bukan temuan.
  Verifikasi ulang dengan subset kecil sebelum menyimpulkan apa pun.
- **Bukan gerbang.** Hasilnya tak deterministik (data pasar bergerak, forming bar hanya saat
  pasar buka). Jalur hermetik tetap satu-satunya yang boleh dipakai untuk menilai merah/hijau.

## Susunan

```
playwright.config.js      project "hermetic" (default) + "integration" (@integration) + "live"
tests/
  static-server.js        server statis ~40 baris (modul http bawaan Node)
  fixtures/
    api.js                SEMUA stub /api + intercept unpkg, di satu tempat
    candles-eurusd-m15.json   500 bar deterministik (di-commit)
    gen-candles.js        generator fixture (PRNG ber-seed; jalankan manual bila perlu)
    lagging-candles.js    stub /api/candles utk keadaan pasca-idle (muatan awal ketinggalan
                          N periode, candle incomplete sudah di periode kini)
    klinecharts-9.8.10.min.js salinan lokal CDN → offline + versi terkunci
  helpers/
    spec.js               TOOL_SPEC — tabel ekspektasi, satu sumber kebenaran
    app.js                gotoApp(): stub → goto → tunggu chart siap; guard pageerror
    chart.js              konversi pixel↔chart, barSpace, plotWidth
    draw.js               armTool, drawTool, measureParity, dragPoint, diffShots
    gallery.js            tulis kartu galeri
  drawing/                00 harness · 10 timing klik · 20 presisi · 30 interaksi
                          31 presisi drag · 40 modal/teks · 50 rail · 60 magnet/TF
                          70 reticle
  chart/                  perilaku data chart (live/forming candle) — bukan drawing
  trading/                semantik order & posisi (parity replay↔Live) — bukan drawing
  smoke/areas.spec.js     1 test tipis per area non-drawing
  integration/            @integration (butuh server Go)
  build-gallery.js        globalTeardown → report/gallery.html
```

## Hal-hal yang harus diketahui sebelum menambah test

Enam jebakan yang sudah memakan waktu; 1–4 dan 6 sudah ditangani helper, jangan diakali ulang.

1. **Jeda antar klik: penelanan klik sudah diperbaiki, `CLICK_GAP_MS` tetap dipakai.** Dulu
   dua klik berjeda < ~400ms membuat klik ke-2 **ditelan** klinecharts (Temuan 2, akar
   masalahnya: mouseup ke-2 di dalam window 500ms tak pernah dipancarkan sebagai `click`
   bila jaraknya ≥5px — celah mati antara dobel & tunggal). Sejak `fixClickSwallow()` di
   `index.html`, klik jeda 100ms pun mendarat. Jalur "normal" tetap memakai `CLICK_GAP_MS`
   dari `helpers/draw.js` supaya yang diuji di sana presisi, bukan timing; jalur cepat
   (`FAST_GAP_MS`) yang menjaga perbaikan ini tak regresi. Jangan pakai angka sendiri, dan
   jangan menaruh dua klik dalam radius <5px kecuali memang sedang menguji dobel-klik.

2. **Sumbu harga ada DI DALAM `#chart`.** Pada viewport 1600, container 1224px tapi area
   plot hanya 1172px; 52px terakhir adalah sumbu. Klik di sana tak masuk ke chart dan akan
   terlihat seperti bug aplikasi. Pakai `plotWidth(page)`, bukan `rect.width`.

3. **Titik overlay tak selalu di atas bentuk yang tergambar.** Titik `ellipse` adalah sudut
   bounding box (kurvanya tak melewatinya) dan figure `arrowMark` digambar bergeser. Untuk
   hover/klik/double-click objek, pakai `hoverableSpot(page, obj, rect)` yang memprobe
   kandidat sampai `hoverId` cocok.

4. **Jumlah titik berubah setelah objek jadi.** `rect` & `fib3` mengembang jadi 8 titik
   (`expandBox`), `long/shortPosition` jadi 6 (`expandPosition`). Karena itu perbandingan
   posisi memakai pencocokan titik **terdekat** (dibatasi kandidat yang selevel secara Y),
   bukan per-indeks. Lihat `nearestDelta`.

5. **`chart.getDataList()` bisa TAK SAMA dengan `tfData`.** `chart.updateData(bar)` membuang
   datum yang timestamp-nya lebih tua dari bar terakhir di chart — diam-diam, tanpa error
   (klinecharts `ChartStore.addData`). Jadi kalau sebuah test mengandalkan isi chart, bandingkan
   dengan `revealed(currentTF)`, jangan asumsikan keduanya sinkron. Ini akar bug gap pasca-idle
   yang dijaga `tests/chart/10-forming-gap.spec.js`.

6. **`barSpace()` (pixel) tak bisa mendeteksi perubahan zoom kecil — pakai `barSpaceApi()`.**
   Helper pixel mengurangi dua posisi bar yang sudah dibulatkan, jadi satu langkah zoom-waktu
   (8 → 8.8 menurut klinecharts) kadang terbaca 9 dan kadang tetap 8, tergantung fase sub-pixel
   bar terakhir. Fase itu ikut lebar sumbu harga, yang berbeda antar-platform karena metrik font
   (52px di macOS, 58px di runner Linux CI). Sebuah assertion `not.toBeCloseTo(bs0, 2)` karena itu
   pernah hijau di lokal & merah di CI padahal aplikasinya benar.

Tambahan: `text` & `callout` membuka editor teks inline sendiri setelah jadi. Menekan
Escape di editor `text` yang masih kosong **menghapus objeknya** (memang desainnya) — pakai
`commitTextEditor()`.

Tambahan 2: **`measure` adalah tool EPHEMERAL pertama** (`TOOL_SPEC.ephemeral`). Ia sengaja dibuang
oleh Escape, oleh mousedown berikutnya di chart, saat tool lain di-arm, dan saat ganti TF/instrumen —
itu fiturnya, bukan bug. Karena itu `drawTool()`/`measureParity()` melewati penekanan Escape untuk
tool ber-flag `ephemeral` (kalau tidak, yang diukur adalah objek yang sudah tak ada), dan ia tercatat
di `DRAG_SKIP` (`31-drag-precision.spec.js`): tanpa `needDefaultPointFigure` ia tak punya hit-test,
jadi tak ada yang bisa digenggam untuk di-drag. Jangan menulis assertion yang menganggap objeknya
masih hidup setelah gestur lain.

## Menambah tool drawing baru

Satu baris di `TOOL_SPEC` (`helpers/spec.js`) sudah cukup: seluruh aspek
(create, presisi, drag, modal/teks, keterjangkauan, shortcut) mengiterasi tabel itu.

## Menyitasi kode aplikasi dari komentar test

`index.html` kini **markup saja** (450 baris) — seluruh JS ada di 51 modul `js/*.js` (Fase 2). Karena
itu:

- **Sitasi baru: tunjuk MODUL + nama simbol**, mis. `js/box-resize.js (expandBox)`. Jangan pakai
  nomor baris — 58 sitasi `index.html:NNNN` di folder ini jadi menyesatkan begitu kode pindah, dan
  memperbaikinya massal tak bisa dilakukan aman (lihat di bawah).
- **Sitasi lama ditandai `index.html pra-Fase-2:NNNN`.** Nomornya benar untuk file SEBELUM
  pemecahan, jadi ia jejak sejarah yang bisa dilacak (`git show be663e3:index.html`), bukan petunjuk
  ke file hari ini.

Kenapa tak dipetakan otomatis ke modul: dicoba dua cara dan keduanya menghasilkan jawaban yang
tampak percaya diri padahal salah. (1) Pencocokan teks-baris terhadap `index.html` lama memetakan
sitasi `klinecharts.init` ke `js/ny-time.js`… yang ternyata KEBETULAN benar, tapi memetakan sitasi
lain ke modul yang sama sekali tak berhubungan. (2) Pemetaan lewat identifier memetakan sitasi
`registerOverlay` (lokasi PEMAKAIAN) ke pemilik DEKLARASI-nya — dua hal berbeda yang tak bisa
dibedakan tanpa membaca kalimatnya. Jadi yang dikerjakan: tandai historis (selalu benar), lalu
perbaiki satu-satu saat menyentuh testnya.

**Nama file sekarang menepati isinya** — tapi jangan tetap menebak: cari pemilik sebuah nama dengan
`grep -ln "^function <nama>" js/*.js`. Dulu tidak begitu: batas potong pemecahan mengikuti banner
section dan bukan makna, sehingga `chart` mendarat di `js/ny-time.js` dan `posPressedMove` di
`js/draw-undo.js`. Keduanya sudah dipecah ke file yang namanya benar (`chart-init.js`,
`draw-position-tool.js`) lewat pemindahan murni yang urutan muatnya tak berubah.

## Temuan

Daftar apa yang merah dan mengapa: `docs/e2e-drawing-findings.md`.
