# News — On-Chart Event Markers (Fase 2)

**Tanggal:** 2026-07-08
**Status:** Disetujui (brainstorming), siap masuk rencana implementasi.
**Prasyarat:** Fase 1 (economic calendar + directional bias) — branch `zihar/feat/news-economic-calendar-bias`.

## Ringkasan

Menampilkan event ekonomi sebagai **marker di sumbu waktu chart** (ala TradingView), supaya
trader sadar ada rilis penting **dalam waktu dekat** tanpa membuka panel News. Tiap event jadi
**tick** ramping di atas sumbu waktu pada posisi X sesuai waktunya; hover/tap menampilkan popup
detail. Event **mendatang terdekat** disorot dengan halo `--luna-glow` (elemen signature).

### Keputusan brainstorming (terkunci)

- **Scope waktu:** event lampau **dan** mendatang (TradingView-style) — lampau di atas bar
  historisnya, mendatang di area kanan.
- **Filter event:** USD **High + Medium** impact. **Panel News & marker berbagi filter yang sama**
  (konsisten; dot amber Medium terpakai di dua tempat).
- **Gaya marker:** **Luna tick + glow** — tick vertikal per-impact (High=`--red`, Medium=amber);
  event mendatang terdekat dapat halo `--luna-glow` berpulsa halus.
- **Edge chip** (indikator tepi kanan untuk event mendatang di luar layar): **DITUNDA** (bukan v1).
- **Toggle** "Show on chart" di header panel News, default on, persist localStorage.

### Non-goals (YAGNI)

Marker non-USD, clustering canggih, drag marker, marker di panel sekunder, `setOffsetRightDistance`
(pakai gutter kanan default klinecharts), edge-chip awareness (ditunda).

---

## Arsitektur

### Data flow (refactor `loadNews`)

Marker harus tampil **walau panel News tertutup**. Saat ini `loadNews()` (`index.html:4353`) fetch
lalu `renderNews()`. Dipisah jadi:

```
refreshNewsData()                      // fetch /api/news/calendar?instrument=<inst>
  → simpan hasil ke state FE `newsState`
  → renderNews()          (hanya bila panel News terbuka)
  → renderNewsMarkers()   (SELALU, bila toggle marker on)
```

- **Pemicu fetch:** chart ready (init), ganti instrumen (`selectSymbol`, `index.html:3974`),
  poll ~60 dtk. **Ganti TF** hanya memicu `repositionNewsMarkers()` (data sama, posisi X berubah).
- Server-side cache (Fase 1) membuat fetch murah walau sering.
- `loadNews()` lama menjadi tipis: memanggil `refreshNewsData()` (kompat dengan pemakaian saat ini).

### Backend — perluasan filter

Fase 1 menyaring USD **High** (`FilterUSDHighImpact`, `internal/news/calendar.go`). Tambah
helper generik:

```go
// FilterUSDImpact menyaring event USD dengan salah satu impact yang diminta (case-insensitive).
func FilterUSDImpact(events []Event, impacts ...string) []Event
```

`buildCalendarResponse` (`news.go`) memakai `FilterUSDImpact(events, "High", "Medium")`. Impact
nyata sudah diemit per-event (Fase 1 fast-follow). `FilterUSDHighImpact` dipertahankan (dipakai
test lama) atau di-refactor jadi pemanggil `FilterUSDImpact(events,"High")` — pilih yang menjaga
test hijau. Panel News otomatis ikut menampilkan Medium (dot amber `.impact-Medium` sudah ada).

---

## Rendering marker (layer DOM tersinkron)

Meniru pola `price-timer`/`.pick-cut` (`index.html:4139-4168, 4550-4567`) — layer DOM di atas
canvas, diposisikan via `convertToPixel`, di-reposisi pada event pan/zoom.

- **Layer:** `<div id="newsMarkers">` absolute di dalam `#chart` (`#chart{position:relative}`,
  `index.html:178`), z-index di atas canvas, `pointer-events:none` pada layer, `auto` pada tiap tick.
- **Satu tick per event.** Anchor `bottom` ~22px di atas sumbu waktu (samakan `.chart-brand`,
  `index.html:317`). Bentuk: garis vertikal ramping + cap membulat.
- **Posisi X** (`repositionNewsMarkers()`):
  - Event lampau (`ts <= lastTs`): `x = tsToPx(ts)` (`index.html:1467`).
  - Event mendatang (`ts > lastTs`): `dataIndex = li + (ts - lastTs)/DUR[currentTF]` lalu
    `chart.convertToPixel({dataIndex, value:0},{paneId:'candle_pane',absolute:true}).x`
    (pola `reanchorFuturePoints`, `index.html:2229-2247, 3459-3465`).
  - Tick dengan X di luar area plot (`x < 0` atau `x > lebar plot`) → `display:none`.
- **Warna impact:** High = `var(--red)`, Medium = amber (`#e0a63a`, senada `.impact-Medium`).
- **Signature — next-upcoming glow:** event dengan `ts > now` paling awal & impact High/Med
  mendapat kelas `.is-next`: halo `--luna-glow` (`filter: drop-shadow(...) rgba(174,185,232,…)`)
  + pulsa halus (`@keyframes`, dinonaktifkan pada `@media (prefers-reduced-motion: reduce)`).
- **Reposisi dipicu:** `chart.subscribeAction('onScroll', repositionNewsMarkers)` &
  `('onZoom', …)` (`index.html:4234-4235`), ResizeObserver `#chart` (`index.html:2000`), dan
  saat ganti TF. Hanya chart primer (`chart`), bukan `secondaries` (read-only).
- **Overlap:** dua event berdekatan (<~10px) → nudge horizontal kecil agar keduanya bisa di-hover.
  Clustering penuh = di luar scope.

---

## Interaksi + popup

- **Desktop:** `mouseenter` tick → popup; `mouseleave` (dengan grace kecil) → tutup.
- **Mobile/touch:** tap tick → toggle popup; tap di luar → tutup.
- **Popup** (reuse token panel News: `--panel`/`--border`/`--txt`): judul event, waktu lokal
  (WIB/lokal), currency, impact, **Actual / Forecast / Previous**, dan **bias arah untuk
  instrumen aktif** (`verdict.bias` + panah, warna `--green`/`--red`) bila event CPI/PPI/NFP;
  netral → tanpa baris bias. Semua field feed di-`newsEsc()` (anti-XSS, dari Fase 1).
- **Posisi popup:** di atas tick; flip ke bawah/samping bila mepet tepi atas/kanan/kiri.
- Hanya satu popup terbuka pada satu waktu.

---

## Toggle + states

- **Toggle "Show on chart"** di header panel News (`.wl-head`), checkbox/switch. Persist
  `localStorage['br_newsMarkers']` (default `'1'` = on). Off → layer `#newsMarkers` disembunyikan
  & tidak diposisikan.
- **Empty:** tak ada event USD High/Med → tak ada tick (layer kosong, tak ada placeholder).
- **Stale feed:** marker tetap tampil dari data last-good (Fase 1 sudah menyediakan `stale`);
  tak ada perlakuan khusus visual di v1.
- **Reduced motion:** glow tetap (statis), pulsa mati.

---

## Error handling

| Kondisi | Perilaku |
|---|---|
| Fetch gagal (belum pernah sukses) | Tak ada marker; panel (bila dibuka) tampilkan error Fase 1. Tak ada tick. |
| Feed stale (last-good) | Marker tetap dari data terakhir. |
| Timestamp event gagal di-parse | Event itu di-skip saat build tick (defensif; jangan lempar). |
| Toggle off | Layer disembunyikan, reposisi dilewati. |

---

## Testing

- **Backend:** unit test `FilterUSDImpact` (High-only, High+Medium, exclude Low/non-USD); pastikan
  `buildCalendarResponse` kini menyertakan event Medium USD. Test Fase 1 tetap hijau.
- **Frontend (verifikasi browser oleh controller):**
  - Tick lampau di atas bar historis; tick mendatang di area kanan (posisi X benar).
  - Event mendatang terdekat menyala (`.is-next` + glow).
  - Warna High=merah, Medium=amber.
  - Hover (desktop) & tap (mobile) → popup dengan field benar + bias instrumen aktif.
  - Reposisi benar saat pan, zoom, ganti TF, resize.
  - Toggle off → marker hilang & persist setelah reload; ganti instrumen → popup bias ikut berubah.
  - `prefers-reduced-motion` → tanpa pulsa.

---

## Titik integrasi (rujukan kode)

- Helper pixel: `tsToPx`/`idxToPx`/`barSpacePx` (`index.html:1466-1468`), future dataIndex
  (`index.html:2229-2247, 3459-3465`), `lastTs`/`li`/`DUR[currentTF]`.
- Layer DOM & sinkron: pola `updatePriceTimer` (`index.html:4139-4156`), `.pick-cut`
  (`index.html:4550-4567`), `subscribeAction` (`index.html:4234-4235`), ResizeObserver
  (`index.html:2000`).
- Data News: `loadNews`/`renderNews` (`index.html:4353-4370`), `newsCurrentInstrument`
  (`index.html:4351`), `inst` (`index.html:1371`), `selectSymbol` (`index.html:3974`),
  `newsEsc` (Fase 1). Poll `setInterval(loadNews,60000)` (`index.html:4435`).
- Backend: `FilterUSDHighImpact` (`internal/news/calendar.go`), `buildCalendarResponse`
  (`news.go`).
- Chart: `chart` global (`index.html:1999`); `secondaries` (`index.html:1388`) — dilewati.
