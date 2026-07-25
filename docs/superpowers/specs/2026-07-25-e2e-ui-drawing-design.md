# E2E test berbasis UI — fondasi + drawing tuntas

Tanggal: 2026-07-25
Status: disetujui (brainstorming), siap diimplementasi

## Masalah

Frontend luna-trade tak punya test otomatis sama sekali. Verifikasi selalu manual via
browser, dan objek drawing hidup di **canvas** (klinecharts 9.8.10) sehingga tak ada
DOM yang bisa diperiksa. Akibatnya:

- Regresi drawing baru ketahuan saat dipakai, bukan saat berubah.
- Satu kelas bug spesifik tak pernah dijaga: **objek "loncat" antara preview
  (rubber-band sebelum klik terakhir) dan hasil final setelah klik terakhir.**

Kode sendiri sudah mengklaim invarian itu — tapi hanya untuk sebagian tool
(`index.html:959-962`):

> `…sbg dataIndex PECAHAN → garis "loncat" ±½ bar saat klik ke-2. Nilai balik onDrawing`
> `DIABAIKAN, jalur commit di onDrawEnd → preview == final (nol geser) utk`
> `horizontal/vertikal/diagonal.`

Dua sebab struktural kenapa tool lain bisa geser:

1. **Anchor X.** `xAnchorFromPx()` (`index.html:533`) menyimpan `timestamp` dari
   `pxToTime(x)` — presisi sub-bar. Tapi saat dirender balik,
   `convertToPixel({timestamp})` **men-snap ke bar** (lihat komentar `index.html:587`).
   Hanya `trendline` yang lolos karena `onDrawEnd` mengonversi titiknya ke `dataIndex`
   **pecahan** (`index.html:3070`). Tool lain (rect, fib3, circle, ellipse, arrow,
   callout, dateRange, long/shortPosition, …) secara struktural bisa loncat sampai
   ±½ `barSpace` saat klik terakhir.
2. **Guard `refine` yang bisa gugur.** `index.html:3063` —
   `refine = pendingClicks.length === o.points.length` plus tiap titik harus berdekatan
   secara pixel (`tolX = 1.5 * barSpace`, `tolY = 6px`). Saat klik cepat, `pendingClicks`
   bisa desync → fallback ke titik klinecharts apa adanya → **x snap ke bar**. Geseran
   jadi intermiten, tergantung timing klik.

## Tujuan

1. Suite E2E yang bisa dijalankan ulang oleh siapa pun: `npx playwright test`.
2. Drawing digarap **tuntas** — 24 tool overlay × aspek create/parity/drag/style/teks/
   delete/persist/undo, plus rail, flyout, favorites, shortcut, cursor mode, magnet.
3. Ketidaksesuaian **terlihat**, bukan cuma pass/fail: galeri visual per tool berisi
   `preview.png` / `final.png` / `diff.png` + angka Δpx, diurut Δ terbesar di atas.
4. Area non-drawing dapat satu smoke test masing-masing sebagai jaring pengaman.

Bukan tujuan (ronde berikutnya): cakupan mendalam untuk area non-drawing, test backend
Go (sudah ada unit test sendiri), visual baseline diff pixel-perfect untuk seluruh UI.

## Keputusan desain

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Runner | `@playwright/test` (npm devDependency) | Report HTML, trace viewer, retry, bisa CI. Node v24 + npx sudah ada di mesin. |
| Data candle | Stub `/api/candles` dengan fixture tetap yang di-commit | Chart identik tiap run → mapping pixel↔harga pasti, screenshot stabil, jalan offline & saat market tutup. |
| Serving | Hermetik (static server + stub **semua** `/api`), plus 1 spec `@integration` opsional | Tak butuh `.env`, token OANDA, `luna.db`, atau binary Go. Spec `@integration` menjaga stub tak melenceng dari server asli. |
| Deteksi | State (`drawIds` + `getOverlayById`) **dan** galeri visual | Bug logika ketangkap otomatis; bug visual kelihatan saat galeri dibuka. |
| Kebijakan parity | **Wajib ≤1px untuk semua tool** kecuali `verticalStraightLine` | Merekam perilaku sekarang sebagai baseline justru menyembunyikan ketidaksesuaian yang paling mungkin ada. Merah di ronde pertama = temuan nyata, bukan test yang salah. |

### Kenapa hermetik bisa

Gerbang FE cuma satu: `/api/auth/me` (`index.html:6517`). Distub jadi
`200 {email:"e2e@luna.local"}` → `bootApp()` jalan, layar login dilewati. Endpoint lain
yang dipanggil FE — `/api/candles`, `/api/account`, `/api/positions`, `/api/journal`,
`/api/order`, `/api/close`, `/api/position/sltp`, `/api/alerts`, `/api/alerts/delete`,
`/api/news/calendar`, `/api/news/headlines`, `/api/auth/config`, `/api/auth/logout`,
`/api/analytics`, `/api/track` — semuanya distub dari satu file.

Satu-satunya resource eksternal di `index.html` adalah
`https://unpkg.com/klinecharts@9.8.10/dist/umd/klinecharts.min.js`. URL itu
di-intercept dan dilayani dari salinan lokal yang di-commit → test tak pernah gagal
karena jaringan, dan versi klinecharts terkunci (kalau CDN berubah, test yang memberi
tahu).

### Koordinat: kunci ketepatan

Semua interaksi pakai **mouse asli** (`page.mouse.down/move/up` — trusted input, pola
yang sudah terbukti di verifikasi #43–#45, lihat `ROADMAP.md:42`), tapi koordinatnya
**dihitung dari chart**, tidak di-hardcode:

```js
const p = await page.evaluate(([ts, v]) =>
  chart.convertToPixel({timestamp: ts, value: v}, {paneId: 'candle_pane'}),
  [ts, price]);
await page.mouse.click(rect.x + p.x, rect.y + p.y);
```

Assertion balik lewat `convertToPixel` atas titik overlay. Test jadi tahan terhadap
perubahan ukuran window, `barSpace`, atau padding kanan — penyebab utama test canvas
jadi rewel.

State dibaca dari bookkeeping aplikasi sendiri, bukan internals klinecharts:

```js
drawIds.map(id => chart.getOverlayById(id))   // → [{name, points, extendData, lock, …}]
```

Ini menjawab pertanyaan yang benar: "apa yang aplikasi *pikir* sudah dibuat?"

## Arsitektur

```
package.json                    # baru: devDependency @playwright/test saja
playwright.config.js            # project "hermetic" (default) + "integration" (@integration)
.gitignore                      # + node_modules/, test-results/, playwright-report/, report/
tests/
  static-server.js              # server statis ~30 baris (modul http bawaan Node)
  fixtures/
    candles-gbpusd-m15.json     # 500 bar deterministik, di-commit
    api.js                      # semua stub /api + intercept unpkg, di satu tempat
    klinecharts-9.8.10.min.js   # salinan lokal CDN, di-commit
  helpers/
    app.js                      # bootApp(page): stub → goto → tunggu chart siap
    chart.js                    # px(price, ts) ↔ priceAt(x, y), rectOf('#chart'), barSpace
    draw.js                     # armTool, drawTool, overlays, dragPoint, parity harness
    gallery.js                  # capture(name, meta) → tulis PNG + JSON per tool
    spec.js                     # TOOL_SPEC — tabel ekspektasi (satu sumber kebenaran)
  drawing/                      # spec drawing, dipecah per aspek
  smoke/                        # 1 spec per area non-drawing
  integration/                  # @integration, butuh server Go asli
  build-gallery.js              # globalTeardown → report/gallery.html
```

## Aspek "Preview ↔ Final parity"

Inti suite ini. Cara ukur per tool, tanpa mengintip internals:

```js
armTool('rect');
await mouse.click(A);                    // klik 1
await mouse.move(B, {steps: 8});         // rubber-band hidup, BELUM klik terakhir
const preview = await snapPoints();      // titik in-progress → pixel via convertToPixel
const previewPng = await shot();         // cursor mode 'arrow' → crosshair mati, PNG = objek saja
await mouse.click(B);                    // klik terakhir → commit
await page.keyboard.press('Escape');     // deselect
await mouse.move(FAR);                   // jauhkan → handle bulat tak ikut ter-foto
const final = await snapPoints();
const finalPng = await shot();
```

Tiga assertion, masing-masing menjawab keluhan yang beda:

| Assertion | Menjawab | Toleransi |
|---|---|---|
| `abs(final.px[i] − preview.px[i])` | "objek loncat setelah klik terakhir" | ≤ 1px (X & Y) |
| `abs(final.px[last] − B)` | "objek tak mendarat di tempat aku klik" | ≤ 1px |
| `diff(previewPng, finalPng)` | bukti visual di galeri | pixel diff → PNG |

Crosshair dimatikan (cursor mode `arrow`) dan objek di-deselect + pointer dijauhkan
sebelum foto, sehingga diff PNG **mengisolasi persis geseran itu** — bukti yang bisa
dilihat, bukan cuma angka.

Diulang untuk tiga jalur input, karena penyebabnya beda:

- **klik-klik normal** (`steps` banyak, ada jeda)
- **klik cepat** (tanpa jeda antar klik) → sengaja memancing desync `refine`
  di `index.html:3063`
- **press-drag** (down → move → up tanpa lepas) → jalur `onPressedMoving`

Untuk **magnet ON**, parity tetap wajib nol (`mode:'strong_magnet'` di
`index.html:3132` membuat preview ikut nempel), dengan ekspektasi tambahan:
`final.value` ∈ {O, H, L, C} bar terdekat.

## TOOL_SPEC — tabel ekspektasi

Sumber angka: `totalStep` di `registerOverlay` (totalStep 3 = 2 titik, totalStep 2 =
1 titik), `PERSIST_DRAW` (`index.html:3158`), `DM_TEXT_OBJS` / `ADDTEXT_CLICK`
(`index.html:5546-5548`), `BUILTIN_LINE` (`index.html:743`).

| Tool | Titik | Target anchor X | Teks | Persist |
|---|---|---|---|---|
| `trendline` | 2 | sub-bar (dataIndex pecahan) | modal + inline | ✓ |
| `rayLine` `straightLine` `horizontalRayLine` `fibonacciLine` | 2¹ | sub-bar | — | ✓ |
| `horizontalStraightLine` `priceLine` | 1 | sub-bar | — | ✓ |
| `verticalStraightLine` | 1 | **bar (sengaja snap,** `index.html:590`**)** | — | ✓ |
| `parallelStraightLine` `priceChannelLine` | 3¹ | sub-bar | — | ✓ |
| `fib3` | 2 | sub-bar | — | ✓ |
| `rect` | 2 | sub-bar | modal + inline | ✓ |
| `circle` `ellipse` `arrow` | 2 | sub-bar | — | ✓ |
| `arrowMarkUp` `arrowMarkDown` | 1 | sub-bar | — | ✓ |
| `longPosition` `shortPosition` | 1 | sub-bar | — | ✓ |
| `dateRange` | 2 | sub-bar | — | ✓ |
| `text` | 1 | sub-bar | modal | ✓ |
| `callout` | 2 | sub-bar | modal + inline | ✓ |
| `simpleAnnotation` `simpleTag` | 1¹ | sub-bar | — | ✓ |

¹ Jumlah titik berasal dari kontrak built-in klinecharts (bukan `registerOverlay`
lokal). Diverifikasi saat implementasi; kalau beda dari tabel, itu temuan dan tabel
dikoreksi dengan catatan.

Kolom "target anchor X" adalah keputusan kebijakan: **semua sub-bar ≤1px**, satu-satunya
pengecualian `verticalStraightLine`.

## Aspek per tool

Data-driven — satu loop atas `TOOL_SPEC`:

1. **create** — arm → klik N kali → overlay masuk `drawIds`, `name` benar,
   `points.length` sesuai tabel.
2. **parity + landing** — seperti di atas, ×3 jalur input.
3. **drag titik** — geser handle → titik itu ikut ≤1px, titik lain tak bergeming.
4. **drag badan** — press-move di badan objek → semua titik bergeser sama besar.
5. **style modal** — double-click → modal terbuka, tab benar (`Text` untuk
   `DM_TEXT_OBJS`, `Style` sisanya); ubah warna → tersimpan di objek.
6. **teks** — untuk `ADDTEXT_CLICK`: placeholder "+ Add text" muncul saat hover objek
   kosong, klik → editor inline, isi → tersimpan ke `extendData`.
7. **delete** — tiga jalur (eraser-klik, tombol Delete, trash di modal) → lenyap dari
   `drawIds`.
8. **persist** — reload → **posisi pixel identik**, bukan cuma "ada". Ini menangkap bug
   serialize/restore yang menggeser objek.
9. **undo** — Ctrl+Z → lenyap; gambar ulang → kembali.

## Aspek lintas-tool

- **rail**: 1-klik arm, caret expand tab, flyout, bintang favorite → fav bar, fav bar
  draggable.
- **shortcut Alt+huruf** untuk 11 tool ber-`sc` (T Y E H V P F R O A X), lewat `e.code`
  fisik (OS/layout-independent).
- **instant-drop** H/V lewat shortcut → objek langsung jadi tanpa klik
  (`index.html:3135`), termasuk kasus pointer di luar chart → fallback ke mode gambar.
- **cursor mode** 4 varian (crosshair on / dotted / off) + eraser.
- **ESC** → batalkan gambar in-progress (overlay in-progress ikut terhapus, tak jadi
  sampah) dan deselect objek terpilih.
- **magnet ON** → parity nol + nilai ∈ OHLC bar terdekat.
- **ganti TF** → objek tetap di harga & waktu yang sama.
- **titik di area future** (kanan bar terakhir) → tak "kelempar ke x=0"; jaring pengaman
  eksplisit di `index.html:3081`.
- **tabrakan nama `arrow`** — ada di grup Cursor *dan* Shapes.
  `toolByName('arrow')` (`index.html:3532`) mengembalikan yang pertama (cursor),
  sedangkan `OBJ_TITLE` (`index.html:5550`) dikomentari "definisi belakang menang →
  arrow=shape". Dua sumber kebenaran berbeda untuk satu nama; test menegaskan mana yang
  benar.

## Smoke non-drawing

Satu spec tipis per area, membuktikan "area ini hidup dan tak error JS" — bukan cakupan
dalam: watchlist/instrument picker · TF + chart-type switcher · indikator (tambah +
gear params) · bar replay (masuk, step, keluar) · news (kalender + marker on-chart) ·
price alerts (buat, rail kanan) · paper order (market buy → posisi muncul) · stocks
(namespace `STOCK:`) · theme/settings.

Setiap spec (drawing maupun smoke) memasang guard global `page.on('pageerror')`:
**error JS apa pun = test gagal.** Murah, dan sering menangkap hal yang tak
diantisipasi.

## Galeri visual

`globalTeardown` menyusun `report/gallery.html` dari PNG + JSON yang ditulis tiap test:
per grup, per tool — kartu berisi `preview.png` / `final.png` / `diff.png`, angka Δpx
(X dan Y), dan status tiap aspek. **Diurut Δ terbesar di atas**, jadi begitu dibuka,
tool yang paling melenceng ada di paling atas.

## Verifikasi

- `npx playwright test` hijau untuk semua aspek yang memang sudah benar.
- Aspek parity yang merah didokumentasikan sebagai temuan (tool mana, Δpx berapa,
  jalur input mana) — bukan ditutup dengan melonggarkan toleransi.
- `report/gallery.html` dibuka manual sekali untuk memastikan tiap tool memang terlihat
  seperti seharusnya (galeri menangkap yang tak bisa diassert: garis tak kelihatan,
  arrowhead salah arah, warna default aneh).
- Spec `@integration` dijalankan sekali dengan server Go asli
  (`PORT=8765 ./luna-trade`) untuk memastikan bentuk respons stub cocok dengan server.

## Risiko

| Risiko | Mitigasi |
|---|---|
| Test canvas rewel karena beda ukuran window / DPI | Koordinat selalu dihitung via `convertToPixel`, tak pernah hardcode; `viewport` dipatok di config. |
| Stub melenceng dari respons server asli | Spec `@integration` opsional yang menembak server Go sungguhan. |
| `index.html` monolitik → test ikut besar | Suite dipecah per aspek + `TOOL_SPEC` sebagai satu sumber kebenaran, jadi menambah tool = satu baris tabel. |
| Toolchain Node masuk repo Go | Hanya `devDependency`; `node_modules/` gitignored; backend tak tersentuh. |
