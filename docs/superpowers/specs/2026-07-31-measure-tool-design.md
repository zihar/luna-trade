# Measure tool (ruler) — desain

Tanggal: 2026-07-31 · Status: disetujui, siap diimplementasi

Item **T1.1** di `docs/drawing-tools-gap-plan.md` (Tier 1, "dipakai harian, effort rendah–sedang").
Measure masuk lima tool yang benar-benar dipakai trader tiap hari, dan Luna nol hit `measure`/`ruler`.

## Masalah

Untuk menjawab "gerakan ini berapa pip, berapa persen, berapa bar, berapa lama?" pengguna
sekarang harus menggambar objek (trendline / dateRange), membaca sumbu, lalu menghapusnya lagi.
Objeknya ikut tersimpan (`PERSIST_DRAW`) dan mengotori chart, padahal niatnya sekali pakai.

TradingView menjawabnya dengan ruler: alat **ephemeral** — muncul, memberi angka, lalu hilang
tanpa meninggalkan objek.

## Keputusan desain

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Aktivasi | Tombol rail (grup baru "Measure", `Alt+M`) **dan** `Shift`+tekan-geser-lepas di chart | Dua pintu masuk ala TV: afordansi untuk yang belum tahu, gestur kilat untuk yang sudah |
| Umur objek | Per-gestur: Shift+drag hilang saat tombol dilepas; jalur rail bertahan sampai Esc / klik lain / ganti tool / ganti TF-instrumen | Angka dibaca sambil menggeser di jalur cepat; jalur rail perlu waktu baca setelah klik ke-2 |
| Isi readout | Δprice, Δ%, Δpip, jumlah bar, durasi | Sesuai backlog; pip adalah satuan harian FX dan sudah tersedia murah dari tabel `INSTRUMENT` |
| Bentuk | Kotak berarsir (hijau naik / merah turun) + panah vertikal + pill 2 baris | Arah terbaca tanpa membaca angka; warna = arah, seperti long/shortPosition |
| Mesin | Satu overlay klinecharts `measure` dipakai kedua jalur | Satu renderer → angka & visual mustahil menyimpang antar-jalur; presisi sub-bar datang gratis dari `delHooks` |
| Persistensi | Tak pernah — tidak masuk `PERSIST_DRAW`, tidak masuk history undo | Sifat alat: sekali pakai |

## Arsitektur

Seluruhnya frontend; tak ada perubahan Go, endpoint, atau skema DB.

### Modul baru: `js/measure.js`

Dimuat setelah `js/draw-rail.js` di `index.html` (saat itu `chart`, `util.js`, `draw-style.js`,
`draw-tools.js`, dan rail sudah ada). Isinya satu domain penuh:

1. `registerOverlay({name:'measure', …})`
2. `measureStats(p0,p1)` — fungsi murni penghitung angka
3. `fmtMeasure(stats)` — fungsi murni pemformat dua baris teks
4. state ephemeral `measureId` + `clearMeasure()`
5. jalur `Shift`+drag (listener pointer)

Modul sendiri, bukan tambahan di `overlays-custom.js`, karena itu arah repo pasca-pemecahan
`index.html` (satu domain = satu file) dan karena measure punya tiga hal yang tak dimiliki tool
gambar lain: state ephemeral, handler pointer, dan statistik.

### Berkas yang disentuh

| File | Perubahan |
|---|---|
| `js/measure.js` | **baru** (lihat di atas) |
| `js/draw-catalog.js` | grup baru `{key:'measure', title:'Measure', tools:[{name:'measure', sc:'M', title:'Measure', svg:…}]}` |
| `js/keyboard.js` | `Esc` → `clearMeasure()` sebagai langkah pertama, sebelum `cancelInProgressDraw()` |
| `js/draw-tools.js` | `createDraw()` memanggil `clearMeasure()` di awal (arm tool lain = measure lama tak relevan) |
| `js/draw-rail.js` | `setCursorMode()` memanggil `clearMeasure()` |
| `js/switch-tf.js`, `js/load-chart.js` | `clearMeasure()` saat ganti TF / instrumen |
| `js/overlays-custom.js` | `fmtDur()` → satuan Inggris (`3h 45m`, `2d 4h`) |
| `index.html` | satu `<script src="/js/measure.js">` setelah `draw-rail.js` |
| `tests/helpers/spec.js` | satu baris `TOOL_SPEC` (+ flag `ephemeral`) |
| `tests/smoke/measure.spec.js` | **baru** |

### Overlay

```js
klinecharts.registerOverlay({
  name:'measure', totalStep:3, needDefaultPointFigure:false, createPointFigures
});
```

Figure yang digambar dari dua titik (koordinat native lewat `subBarCoords`, seperti tool lain):

- **kotak** `stroke_fill` membentang antara kedua titik di kedua sumbu. Warna dari arah:
  `POS_GREEN`/`POS_RED` + `alphaHex(12)` yang sudah ada (`js/overlays-custom.js:275,296`) →
  satu palet dengan long/shortPosition.
- **panah vertikal** di tengah kotak, dari harga awal ke harga akhir, kepala panah di ujung akhir.
  Arah gerak terbaca sebelum angkanya dibaca.
- **pill dua baris** (pola `dateRange`: `rect` fill + `text` 11px putih) di sisi **luar** kotak —
  di atas bila naik, di bawah bila turun — supaya tak menutup candle yang sedang diukur.

`needDefaultPointFigure:false` = tanpa handle titik dan tanpa hit-test. Ini **disengaja**, dan
sekilas tampak mengulang kesalahan yang membuat `simpleAnnotation`/`simpleTag` ditarik (Temuan 3,
`docs/e2e-drawing-findings.md`): objek tanpa hit-test tak bisa di-hover/dipilih/dihapus lewat klik.
Bedanya menentukan: objek itu **persist dan permanen** sehingga tak-terjangkau = nyangkut selamanya,
sedangkan measure tak pernah tersimpan dan punya empat jalur keluar otomatis (tabel di bawah).
Tak ada keadaan di mana pengguna terjebak dengan measure yang tak bisa dibuang.

### Statistik — `measureStats(p0,p1)`

Mengembalikan `{dPrice, dPct, dPips, bars, ms}`, atau `null` bila salah satu titik tak punya
`value`/timestamp (mis. titik di area future tanpa data) — pemanggil menggambar kotak tanpa pill,
bukan mencetak `NaN`.

- `dPrice = v1 - v0` (bertanda) · `dPct = (v1-v0)/v0*100`
- `dPips = |dPrice| / pip`, `pip` dari `instSpec()` (`js/sizing-pnl.js:25`). **`dPips = null`
  bila instrumen tak ada di tabel `INSTRUMENT`** — untuk saham (`STOCK:…`) `instSpec()` jatuh ke
  input `#pipSize` dan akan mencetak "pip" yang tak punya arti di sana.
- `bars = Math.round(|fidxOf(p1) - fidxOf(p0)|)` — dihitung di ruang **indeks bar**, jadi gap akhir
  pekan otomatis tak terhitung, tanpa perlu logika kalender.
- `ms = |tsOf(p1) - tsOf(p0)|` — durasi **wall-clock nyata** antar kedua titik, bukan `bars × DUR`.
  Alasannya sama dengan yang sudah tertulis untuk `dateRange` (`js/overlays-custom.js:412`): bar MN
  panjangnya 28–31 hari, mengalikan rata-rata tak pernah memberi angka yang benar.

### Format — `fmtMeasure(stats)`

Dua baris, teks Inggris (aturan CLAUDE.md):

```
+0.00123 (+0.12%) · 12.3 pips
15 bars · 3h 45m
```

- Δprice pakai desimal instrumen (`fmtFor`/`priceDecimals`) dan **selalu bertanda** (`+`/`−`).
- `1 bar` singular, `15 bars` plural.
- Baris pertama tanpa segmen pip bila `dPips === null`.
- Durasi lewat `fmtDur()` yang **diubah ke satuan Inggris** dalam PR ini: `45m`, `3h 45m`, `2d 4h`.
  Fungsi itu sekarang mencetak `j` (jam) & `h` (hari) — Indonesia, melanggar aturan teks UI, dan
  measure memakai fungsi yang sama. Perbaikan ikut di sini karena kami memang sedang menyentuhnya;
  efek sampingnya label `dateRange` juga jadi Inggris (yang memang seharusnya). Tak ada test yang
  meng-assert teks lama (sudah diperiksa: 0 hit di `tests/`).

### Dua pintu masuk, satu overlay

**1. Rail / `Alt+M`.** Grup baru di `DRAW_GROUPS` → `pickTool` → `createDraw('measure', catBtn)`,
jalur yang sama dengan tool gambar lain. Konsekuensinya presisi sub-bar, preview yang mengikuti
kursor, magnet, dan pembatalan (Esc / klik kanan) datang gratis dari `delHooks`. Di `onDrawEnd`
id-nya dicatat ke `measureId`.

**2. `Shift`+tekan-geser-lepas.** Listener `mousedown` **fase capture** di `#chart` — preseden
`js/price-scale.js:59` (Shift+wheel untuk skala harga memakai trik yang sama):

```
mousedown (capture) di #chart:
  syarat: e.shiftKey && e.button===0 && !inProgressId && !eraserOn && target di dalam canvas chart
  → stopPropagation() + preventDefault()   // klinecharts tak pernah melihatnya → chart TIDAK nge-pan
  → createOverlay({name:'measure', points:[p,p]})   // p dari fracAnchorFromPx + pxToValue
mousemove (window): overrideOverlay titik ke-2
mouseup / blur (window): clearMeasure()
```

Listener `mousemove`/`mouseup` dipasang di **window**, bukan `#chart`: kalau tombol dilepas di luar
chart, `mouseup` pada `#chart` tak pernah datang dan overlay akan nyangkut.

Magnet dihormati di jalur ini juga (`magnetSnap()` untuk nilai Y bila `magnetOn`) — kalau tidak, dua
pintu masuk bisa memberi angka berbeda untuk gestur yang sama.

## Siklus hidup & jalur keluar

| Pemicu | Jalur rail | Jalur Shift+drag |
|---|---|---|
| Selesai gestur | bertahan (`measureId` dicatat di `onDrawEnd`) | hilang di `mouseup` |
| `Esc` | `clearMeasure()` sebelum `cancelInProgressDraw()` | — (sudah hilang) |
| `mousedown` berikutnya di chart tanpa Shift | `clearMeasure()`, **tanpa** `stopPropagation` → klik itu tetap normal untuk chart & tool lain | — |
| Arm tool lain / ganti cursor mode | `clearMeasure()` di `createDraw()` & `setCursorMode()` | — |
| Ganti TF / instrumen | `clearMeasure()` | — |
| Pointer keluar window saat menggeser | — | `mouseup`/`blur` di window |

`clearMeasure()` = `removeOverlay(measureId)` + `measureId=null`, idempoten, dibungkus `try/catch`.

Dua urutan yang perlu eksplisit supaya tak salah baca:

- `measureId` diisi **hanya di `onDrawEnd`**. Jadi saat measure masih digambar (klik pertama sudah
  jatuh), `measureId` masih `null` → `Esc` lewat `clearMeasure()` tanpa efek lalu ditangani
  `cancelInProgressDraw()` seperti tool lain. Tak ada kasus Esc yang "termakan" measure.
- `createDraw()` memanggil `clearMeasure()` di awal — termasuk saat yang di-arm adalah measure itu
  sendiri. Itu memang yang diinginkan: gestur ukur baru membuang hasil ukur sebelumnya, dan karena
  `measureId` baru diisi di `onDrawEnd`, tak ada objek yang menghapus dirinya sendiri.

## Interaksi dengan fitur yang sudah ada

- **Undo/redo tak tercemar.** `measure` tak ada di `PERSIST_DRAW` → `serializeDraws()` melewatinya →
  `recordDrawHistory()` menolak snapshot ber-JSON identik (`js/draw-undo.js:8`). Tak ada langkah
  undo kosong yang harus ditekan dua kali.
- **Hide-all / trash.** Jalur rail lewat `createDraw` sehingga masuk `drawIds` dan dibersihkan
  `onRemoved` seperti objek lain. Jalur Shift+drag sengaja **tidak** masuk `drawIds` — ia hidup
  kurang dari satu detik dan bukan objek gambar.
- **Bar Replay.** Measure yang aktif dibiarkan saat step; titiknya ber-anchor `dataIndex` sehingga
  tetap menempel di bar yang sama.
- **Tanpa panel setting.** `measure` tidak masuk `DRAW_DEFAULT` → tak ada modal Style/Text
  (`settings: null`). Warna adalah arah, bukan preferensi per-objek.

## Verifikasi

1. **`tests/smoke/measure.spec.js`** (murah, ikut gerbang PR):
   - `Alt+M` meng-arm → 2 klik → `measureId != null` & overlay bernama `measure` ada;
     `Esc` → `measureId == null` & overlay hilang.
   - Angka diuji lewat **API resmi di page context**, bukan membaca canvas:
     `fmtMeasure(measureStats(p0,p1))` atas titik sintetis → assert Δprice bertanda, `%`, `pips`,
     `bars`, durasi; termasuk kasus `1 bar` singular dan instrumen tanpa pip (`dPips === null`).
   - **Shift+drag**: `keyboard.down('Shift')` + `mouse.down/move/up` → overlay ada selama menggeser,
     hilang setelah `mouseup`, **dan chart tak nge-pan** — dibuktikan dengan `chart.getBarSpace()`
     (sudah dipakai `tests/helpers/chart.js:70`) plus posisi-x candle terakhir via `convertToPixel`
     sebelum vs sesudah gestur.
2. **Ikut suite yang ada gratis** lewat satu baris `TOOL_SPEC` (`clicks:2`, `pointsAfter:2`,
   `anchor:'subbar'`, `text:null`, `settings:null`, `persist:false`, `sc:'M'`, `ephemeral:true`):
   `20-parity` menguji landing ≤1px, `50-rail` menguji grup "Measure" ada di rail & `Alt+M` meng-arm.
3. Sebelum push cukup `npx playwright test tests/smoke --project=hermetic`; suite penuh 3 shard
   diserahkan ke CI saat push ke `main` (CLAUDE.md, `docs/superpowers/specs/2026-07-29-release-gate-manual-deploy-design.md`).

## Di luar cakupan (dicatat)

- **Measure di panel multi-chart.** Shift+drag hanya dipasang di `#chart`; panel sekunder
  (`js/multi-chart.js`) punya instance sendiri. Layak PR kecil terpisah bila diminta.
- **`Price Range` & `Date & Price Range`** — saudara measure yang persist, Tier 2 di
  `docs/drawing-tools-gap-plan.md`.
- **Estimasi $ pada lot tiket** (via `pnlUsd`/`currentLots`) — menambah ketergantungan ke state
  tiket order dan pertanyaan arah long/short; diangkat lagi bila terasa perlu.
