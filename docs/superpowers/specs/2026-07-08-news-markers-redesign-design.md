# News — Marker Redesign: Badge + Multi-Currency (Fase 2 revisi)

**Tanggal:** 2026-07-08
**Status:** Disetujui (brainstorming), siap masuk rencana implementasi.
**Branch:** `zihar/feat/news-economic-calendar-bias` (merevisi marker Fase 2 yang sudah ada, belum di-merge).
**Prasyarat:** Fase 1 (economic calendar + bias) & Fase 2 (marker tick on-chart) sudah ada di branch ini.

## Ringkasan

Merevisi marker event ekonomi on-chart dari **tick ramping** menjadi **badge bulat bergaya
TradingView** yang lebih jelas, memperluas cakupan event ke **kedua mata uang pasangan instrumen
aktif** (bukan lagi USD-only), dan merombak popup jadi berlabel penuh. Menyelesaikan empat keluhan
konkret pengguna terhadap desain Fase 2:

1. Marker terlalu kecil/halus → **badge bulat** dengan flag + severity bars.
2. Warna ambigu (biru vs merah) → **warna = impact saja**; "next upcoming" ditandai **glow terpisah**.
3. Impact hanya dibedakan warna → tambah **severity bars** (3=High, 2=Medium) + ring warna.
4. Popup terlalu singkat → **label penuh** Actual/Forecast/Previous ala TradingView.
5. Marker menimpa kolom price → **clip ke area plot** (marker berlaku seperti chart).
6. Event non-USD (mis. UK CPI di GBP/USD) tak tampak → **multi-currency per-instrumen**.

### Keputusan brainstorming (terkunci)

- **Bentuk marker:** badge bulat (~24px) di sumbu waktu, berisi **flag** mata uang event.
- **Cakupan event:** **multi-currency per-instrumen** — event untuk kedua mata uang pasangan
  aktif (GBP/USD → GBP + USD; XAU/USD → USD).
- **Bias non-USD:** **Lite** — event non-USD tampil penuh (badge/flag/impact/data) tapi **tanpa
  baris bias arah**; bias arah hanya untuk event **USD** (engine bias Fase 1 **tidak diubah**).
- **Penanda impact:** **severity bars** (3=High merah, 2=Medium amber) + ring warna.
- **Next-upcoming:** ring **`--luna-glow`** + pulsa (terpisah dari warna impact; mati saat
  `prefers-reduced-motion`).
- **Popup:** kartu label-penuh (accent impact, header flag+nama+chip impact, tanggal lengkap,
  grid Actual/Forecast/Previous, baris bias hanya untuk USD berarah).
- **Clip:** marker disembunyikan di luar batas area plot (tak menimpa sumbu harga).

### Non-goals (YAGNI)

Generalisasi engine bias ke non-USD (ditunda — event non-USD netral dulu), clustering canggih,
drag marker, edge-chip, marker untuk currency di luar pasangan aktif, aset SVG flag kustom
(pakai emoji flag dengan fallback kode 2-huruf).

---

## Bagian A — Backend: multi-currency per-instrumen (Lite)

File: `internal/news/calendar.go`, `internal/news/classify.go`, `news.go`.

### A1. Mata uang relevan per instrumen

Tambah helper (package `news`):

```go
// RelevantCurrencies mengembalikan mata uang fiat yang event ekonominya relevan untuk
// sebuah instrumen: kedua sisi pasangan FX (mis. "GBP_USD" → ["GBP","USD"]). Logam & DXY
// (base non-fiat / sintetis) → ["USD"] saja. Kode non-fiat (XAU/XAG/XPT/XPD) di-drop.
func RelevantCurrencies(symbol string) []string
```

Aturan: `strings.Split(symbol, "_")` → ambil tiap kode 3-huruf; buang kode logam/non-fiat
(`XAU`, `XAG`, `XPT`, `XPD`); dedup, jaga urutan. Bila hasil kosong (mis. `DXY`), fallback
`["USD"]`. Contoh: `EUR_USD`→`[EUR,USD]`, `USD_JPY`→`[USD,JPY]`, `XAU_USD`→`[USD]`, `DXY`→`[USD]`.

### A2. Filter event per-currency

Tambah (di samping `FilterUSDImpact` yang dipertahankan untuk test Fase 1):

```go
// FilterEvents menyaring event yang currency-nya ada di `currencies` (case-insensitive)
// DAN impact-nya salah satu di `impacts`.
func FilterEvents(events []Event, currencies []string, impacts ...string) []Event
```

### A3. Grouping tetap per-currency (hindari merge lintas negara)

`DefaultName` mengkanonkan judul (CPI/PPI/NFP) tanpa memandang negara — sehingga "US CPI" &
"UK CPI" dua-duanya jadi "CPI" dan `GroupReleases` akan **keliru menggabungkannya**. Cegah dengan
**mengelompokkan per-currency**: partisi event berdasarkan `Country`, jalankan `GroupReleases`
untuk tiap partisi, lalu gabungkan hasilnya. (Alternatif setara: buat kunci grup `country+"|"+name`.)
Pilih yang menjaga test Fase 1 hijau; rekomendasi: partisi per-currency di `buildCalendarResponse`.

### A4. buildCalendarResponse — cakupan & bias

`news.go`, ganti pemilihan event:

```go
currencies := news.RelevantCurrencies(instrument)                    // was: hardcode USD
releases := groupByCurrency(news.FilterEvents(events, currencies, "High", "Medium"), nameOf)
sort.Slice(releases, ...)                                            // by Time (tetap)
```

Untuk tiap release:
- `it.Currency` = currency event (dari headline `h.Country`, sudah ada); `it.Impact` dari headline.
- **Bias hanya untuk release USD**: bila `strings.EqualFold(headlineCountry, "USD")` **dan** rilis
  → hitung verdict seperti Fase 1 (`Classify` → `InstrumentBias(v.Lean, role)`). Selain itu
  (currency non-USD, atau belum rilis) → verdict **netral** (`bias:"neutral"`), tanpa arah.
  Playbook/PreScenario tetap hanya bermakna untuk USD.
- `NextRelease` = event relevan belum-rilis terdekat (currency apa pun) — countdown per-instrumen.

Konsekuensi (disengaja): **panel News & marker** (berbagi `newsState`) dua-duanya jadi
per-instrumen. **Bias card** (FE, `renderNews`) tetap memilih "rilis berarah terakhir" — karena
hanya event USD yang berarah, card tetap USD-directional; event non-USD muncul di daftar kalender
sebagai netral. Tak ada perubahan FE `renderNews` yang wajib, tapi verifikasi panel merender
currency non-USD dengan benar (dot impact + `r.currency`).

### A5. Testing backend

- `RelevantCurrencies`: FX pair (2 currency), USD_JPY, XAU_USD→[USD], DXY→[USD], case.
- `FilterEvents`: multi-currency + impact High/Medium, exclude Low & currency di luar daftar.
- `buildCalendarResponse` (mis. instrument `GBP_USD`): event GBP **dan** USD muncul di `Releases`;
  event USD rilis punya `verdict.bias` non-netral bila surprise-nya berarah; event GBP rilis
  tetap `verdict.bias=="neutral"` (Lite); "US CPI" & "UK CPI" **tidak** tergabung jadi satu release.
- Test Fase 1 tetap hijau (`FilterUSDImpact` & existing calendar tests).

---

## Bagian B — Frontend: marker badge (index.html)

Merevisi kode marker Fase 2 (`renderNewsMarkers`/`repositionNewsMarkers`/CSS `.nmk`). Positioning,
layer, hook reposition (scroll/zoom/TF/resize/render), toggle, dan lifecycle popup **dipakai ulang**.

### B1. Flag mata uang (tanpa aset)

```js
// currency (mis. "USD","EUR") → emoji flag via regional-indicator dari 2 huruf pertama
// ("USD"→"US"→🇺🇸). Di platform tanpa dukungan emoji-flag, otomatis tampil 2 huruf ("US") —
// fallback yang justru berguna. EUR→"EU"🇪🇺.
function currencyFlag(cur){ /* 'US'.replace(/./g, c=>String.fromCodePoint(0x1F1E6 + c.charCodeAt(0)-65)) */ }
```

Set currency dari universe instrumen: USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD → semua 2-huruf =
`cur.slice(0,2)`.

### B2. Badge marker

- **Elemen** `.nmk` menjadi badge bulat: `<div class="nmk impact-high|impact-medium" data-idx>` berisi
  flag + **severity bars** (`<span class="nmk-sev"><i></i>×N</span>`, N=3 High / 2 Medium).
- **Ukuran** ~24px, `bottom` di atas sumbu waktu (samakan area sebelumnya), `transform:translateX(-50%)`,
  `pointer-events:auto`. Layer `#newsMarkers` tetap `pointer-events:none`, z-index di bawah `.chart-brand`.
- **Warna** = impact: ring `border-color` High=`var(--red)`, Medium=`#e0a63a`. Severity bars mewarisi
  warna impact. **Tidak** ada recolor untuk next.
- **Next-upcoming** (`.is-next`, satu, terdekat `ts>Date.now()`): tambah **ring `--luna-glow`**
  (pseudo-element cincin) + pulsa `@keyframes`; pulsa mati pada `@media (prefers-reduced-motion:reduce)`
  (glow statis tetap).
- Data: `el.dataset.idx` = index ke `newsState.releases` (untuk popup) — **pola Fase 2 dipertahankan**.

### B3. Positioning + clipping

- Posisi X: **sama seperti Fase 2** — lampau `ts<=lastTs` → `tsToPx`; mendatang → `idxToPx(li+(ts-lastTs)/DUR)`.
- **Clip ke area plot**: batas kanan = `chart.getSize('candle_pane','main').width` (lebar konten plot,
  **tanpa** sumbu harga). Sembunyikan (`display:none`) marker dengan `x<0` **atau** `x>plotWidth`
  (menggantikan pemakaian `#chart` clientWidth di Fase 2 yang membuat marker bisa menimpa sumbu harga).
  Ambil `plotWidth` saat reposition (fallback ke `clientWidth` bila API gagal). Verifikasi finder
  string `'candle_pane'/'main'` saat implementasi (browser).
- **Overlap:** nudge horizontal (badge lebih besar → jarak minimum ≈ lebar badge+2px). Clustering penuh
  out-of-scope; tick yang tumpang tindih bergeser kecil agar keduanya bisa di-hover.

### B4. Popup label-penuh (klik/hover)

- **Kartu** `.nmk-pop`: accent bar atas berwarna impact; header = **flag + nama event + chip impact**
  (chip berisi severity bars + teks "HIGH"/"MEDIUM"); baris **tanggal-waktu lengkap** (lokal/WIB);
  **grid** `Actual / Forecast / Previous` (label utuh, nilai kanan; Actual hanya bila rilis).
- **Baris bias** hanya bila `verdict.bias` non-neutral (→ event USD berarah): panah `biasArrow` +
  `INSTRUMENT bias` + warna `--green`/`--red`. Event non-USD / netral → tanpa baris bias.
- **Anti-XSS:** semua field feed (currency/name/impact/forecast/previous/actual/time/bias) di-`newsEsc`.
- **Perilaku** (di atas tick, clamp horizontal, satu popup, hover-mouse via `pointerenter`/tap-toggle,
  klik-luar tutup, tutup saat rebuild/tick detach) **dipertahankan dari Fase 2** (termasuk fix ronde-1).

### B5. Toggle "On chart"

Tak berubah — checkbox `#newsMarkerToggle`, persist `localStorage['br_newsMarkers']`.

---

## States & error handling

| Kondisi | Perilaku |
|---|---|
| Instrumen non-FX (XAU/XAG/DXY) | `RelevantCurrencies`→[USD]; marker & panel USD saja (seperti sebelumnya). |
| Event currency di luar pasangan | Tak difilter masuk (tak ada marker). |
| Timestamp event gagal di-parse | Event di-skip saat build badge (defensif; tak melempar). |
| `getSize` gagal / paneId salah | Fallback `plotWidth = #chart.clientWidth` (marker bisa mepet axis, tak crash). |
| Feed stale (last-good) | Marker & panel dari data terakhir (Fase 1). |
| Toggle off | Layer disembunyikan, reposisi dilewati, popup ditutup. |
| Emoji flag tak didukung platform | Otomatis tampil kode 2-huruf (mis. "US") — fallback berguna. |

## Testing (frontend — verifikasi browser oleh controller)

- Instrumen FX pasangan (mis. GBP/USD): badge **kedua** currency muncul (flag 🇬🇧 & 🇺🇸); warna ring
  sesuai impact; severity bars 3 vs 2.
- Instrumen USD-only (XAU/USD): hanya badge USD.
- Next-upcoming: tepat satu badge glow `--luna-glow` + pulsa; `prefers-reduced-motion` → pulsa mati.
- Clipping: badge tak pernah menimpa kolom sumbu harga; di luar plot → hilang; reposisi benar saat
  pan/zoom/ganti TF/resize.
- Popup: klik/hover buka; label penuh Actual/Forecast/Previous; chip impact; event USD berarah →
  baris bias; event non-USD → tanpa baris bias; ganti instrumen → set marker & bias ikut berubah.
- Toggle off → marker hilang & persist reload.
- Console bersih (pasca-login).

## Titik integrasi (rujukan kode)

- Backend: `FilterUSDImpact`/`RelevantCurrencies`/`FilterEvents` (`internal/news/calendar.go`),
  `GroupReleases`/`DefaultName`/`KindOf` (`internal/news/classify.go`), `InstrumentRole`/`InstrumentBias`
  (`internal/news/bias.go`), `buildCalendarResponse` (`news.go`), instrument universe (`config.go:84-89`).
- Frontend: `renderNewsMarkers`/`repositionNewsMarkers`/`nudgeNewsMarkers`/`ensureNewsLayer`/
  `nmkImpactClass`/`_newsLayer` (Fase 2), popup `openNewsPop`/`positionNewsPop`/`repositionNewsPop`/
  `closeNewsPop`/`bindNewsMarker`/`newsBiasLine`, helper `tsToPx`/`idxToPx`/`DUR`/`currentTF`/`revealed`,
  `newsEsc`/`fmtLocal`/`biasArrow`, toggle `#newsMarkerToggle`. CSS `.nmk`/`#newsMarkers`/`.nmk-pop`.
- klinecharts: `chart.getSize('candle_pane','main')` (lebar plot), `subscribeAction` (reposition).
