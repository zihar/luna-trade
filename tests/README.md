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

## Susunan

```
playwright.config.js      project "hermetic" (default) + "integration" (@integration)
tests/
  static-server.js        server statis ~40 baris (modul http bawaan Node)
  fixtures/
    api.js                SEMUA stub /api + intercept unpkg, di satu tempat
    candles-eurusd-m15.json   500 bar deterministik (di-commit)
    gen-candles.js        generator fixture (PRNG ber-seed; jalankan manual bila perlu)
    klinecharts-9.8.10.min.js salinan lokal CDN → offline + versi terkunci
  helpers/
    spec.js               TOOL_SPEC — tabel ekspektasi, satu sumber kebenaran
    app.js                gotoApp(): stub → goto → tunggu chart siap; guard pageerror
    chart.js              konversi pixel↔chart, barSpace, plotWidth
    draw.js               armTool, drawTool, measureParity, dragPoint, diffShots
    gallery.js            tulis kartu galeri
  drawing/                00 harness · 10 timing klik · 20 presisi · 30 interaksi
                          40 modal/teks · 50 rail · 60 magnet/TF
  smoke/areas.spec.js     1 test tipis per area non-drawing
  integration/            @integration (butuh server Go)
  build-gallery.js        globalTeardown → report/gallery.html
```

## Hal-hal yang harus diketahui sebelum menambah test

Empat jebakan yang sudah memakan waktu; semuanya sudah ditangani helper, jangan diakali ulang.

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

Tambahan: `text` & `callout` membuka editor teks inline sendiri setelah jadi. Menekan
Escape di editor `text` yang masih kosong **menghapus objeknya** (memang desainnya) — pakai
`commitTextEditor()`.

## Menambah tool drawing baru

Satu baris di `TOOL_SPEC` (`helpers/spec.js`) sudah cukup: seluruh aspek
(create, presisi, drag, modal/teks, keterjangkauan, shortcut) mengiterasi tabel itu.

## Temuan

Daftar apa yang merah dan mengapa: `docs/e2e-drawing-findings.md`.
