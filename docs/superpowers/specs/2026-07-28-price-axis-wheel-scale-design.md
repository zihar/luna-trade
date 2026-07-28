# Skala harga via scroll wheel di sumbu Y

Tanggal: 2026-07-28 · Status: disetujui (pendekatan A)

## Masalah

Skala harga (meregang/memampatkan sumbu Y) hanya bisa lewat klik-drag di sumbu. Scroll
wheel di atas sumbu harga tidak melakukan apa-apa — padahal itu gestur yang dipakai
TradingView dan yang paling sering direfleks-kan pengguna.

Jalur skala harga lewat wheel sebenarnya sudah ada tapi terbatas & cacat
(`js/theme.js:23-43`):

- Pemicunya **Shift+wheel di mana pun** di dalam plot, bukan wheel di sumbu. Komentar di
  sana mencatat bahwa versi "zona 70px kanan = skala harga" pernah dicoba lalu dicabut
  karena "wheel terasa loncat".
- Akar loncatnya bukan zona itu sendiri, melainkan **rumus stepnya**. KLineCharts 9.8.10
  menghitung skala drag sumbu dari **pageY absolut**, bukan delta:
  `range_baru = range_lama × (pageY_sekarang / pageY_mousedown)`. Dengan delta sintetis
  tetap 14px, satu notch wheel berarti ~14% saat kursor di dekat atas chart tapi hanya
  ~2% di dekat bawah.
- Zona 70px juga cuma tebakan lebar sumbu, jadi wheel di dalam plot dekat tepi kanan
  diam-diam ikut jadi skala harga.

## Keputusan

Wheel di atas sumbu Y = **skala harga**, identik hasilnya dengan drag sumbu (bukan pan
vertikal). Shift+wheel di area plot **dipertahankan** dan ikut memakai rumus step baru,
sehingga dua pemicu memakai satu fungsi.

### Pendekatan yang dipilih: A — gesture drag sintetis

Wheel diterjemahkan jadi urutan `mousedown` → `mousemove` → `mouseup` di dalam sumbu,
memakai jalur skala KLineCharts sendiri.

| | Cara | Trade-off |
|---|---|---|
| **A ✅** | Gesture drag sumbu sintetis | Jalur skala bawaan yang sudah terbukti (Shift+wheel sudah begitu sejak awal); perubahan kecil; otomatis berlaku di pane indikator & panel multi-chart karena pane ditentukan oleh koordinat. Kekurangan: menyuntik event. |
| B | Internal API (`pane.getAxisComponent().setRange()` + `chart.adjustPaneViewport()`) | Paling presisi, memungkinkan skala berpusat kursor. Tapi private API tanpa accessor pane publik → berisiko pecah saat upgrade KLineCharts. |
| C | Layer skala harga sendiri | Overkill. |

## Rancangan

### Modul

Blok skala harga pindah dari `js/theme.js` ke modul baru **`js/price-scale.js`** — isinya
tak ada urusan dengan tema, dan pemecahan per-domain adalah arah yang sudah ditetapkan
CLAUDE.md. Dimuat di `index.html` setelah `js/chart-init.js` (butuh `chart` & `$`).

API modul: `attachPriceScale(el, chartInstance)`. Berbeda dari `attachPriceWheelZoom(el)`
yang lama, instance chart ikut diserahkan karena lebar sumbu dibaca per-chart lewat
`getSize`. Pemanggil:

- `js/price-scale.js` sendiri: `attachPriceScale($('#chart'), chart)`
- `js/multi-chart.js:31`: `attachPriceScale(cdiv, c)` (dipanggil di dalam fungsi pembuat
  panel, jadi urutan muat tak jadi soal)

### Tiga perbaikan inti

1. **Zona sumbu asli.** `chartInstance.getSize('candle_pane','main').width` memberi batas
   kanan area plot relatif kontainer; x di kanannya = sumbu harga. `AXIS_ZONE = 70`
   turun pangkat jadi fallback bila `getSize` gagal/melempar.
2. **Step rasio konstan.**
   - `units = deltaY / 100`, dinormalkan untuk `deltaMode`: `DOM_DELTA_LINE` ×32,
     `DOM_DELTA_PAGE` ×120 (mengikuti normalisasi KLineCharts sendiri), lalu di-clamp
     ke ±1 supaya momentum-fling trackpad tak meloncat.
   - `ratio = 1.05 ** units` → satu notch mouse (`deltaY ≈ 100`) ≈ 5%; trackpad yang
     mengirim banyak delta kecil tetap halus.
   - Delta sintetis = `pageY × (ratio − 1)`, karena KLineCharts memakai rasio pageY.
     Titik `mousemove` dikirim di `clientY + delta`. Batal bila `pageY < 8` (pembagian
     tak stabil) atau `|delta| < 0.05px` (tak ada efek).
   - Arah: `deltaY > 0` (scroll bawah) → `ratio > 1` → rentang harga membesar =
     memampatkan; scroll atas = meregang. Sama dengan drag sumbu ke bawah/atas.
3. **Guard target.** `document.elementFromPoint` di tengah sumbu harus mengembalikan
   `<canvas>` di dalam `el`. Bila tertutup node DOM (pill P&L posisi, tag SL/TP), gesture
   **tidak** dikirim dan `preventDefault()` tidak dipanggil — supaya scroll tak pernah
   berubah jadi drag SL/TP.

### Yang tidak berubah

- Wheel di area plot tetap zoom-waktu bawaan KLineCharts (tak di-intercept).
- Reset sudah ada: double-click sumbu → auto-scale (bawaan KLineCharts), dan
  `Reset chart` di `js/context-menu.js` menormalkan `yAxis.type`.
- Tak ada teks UI baru.

## Verifikasi

Spec hermetik baru `tests/chart/11-price-scale.spec.js`, membaca rentang harga viewport
lewat `chart.convertFromPixel(coords, {paneId:'candle_pane'})`:

1. wheel `deltaY = -100` di zona sumbu → rentang harga viewport **mengecil**; `deltaY = +100`
   → **membesar**.
2. **Regression "loncat"**: notch sama banyak di kursor dekat atas vs dekat bawah chart →
   rasio perubahan rentang sama (toleransi kecil). Ini yang dulu gagal.
3. wheel di tengah plot → rentang harga **tidak** berubah, tapi `chart.getBarSpace()`
   berubah (zoom-waktu utuh).
4. `tests/smoke/module-hygiene.spec.js` tetap hijau dengan modul baru dalam urutan muat.

Gerbang: `npx playwright test --project=hermetic` (bukan `npm test`).

## Risiko

- **Node DOM di atas sumbu** → ditangani guard `<canvas>` (poin 3). Kalau ternyata pill
  posisi memang sering menutupi sumbu, langkah lanjutan (di luar spec ini) adalah membuat
  layer DOM itu `pointer-events` hanya di elemen interaktifnya.
- **Upgrade KLineCharts** bisa mengubah rumus skala sumbu. Test regression #2 akan merah
  bila itu terjadi, jadi kegagalannya terdeteksi, bukan diam-diam.
