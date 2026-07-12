# News — Headline feed + on-chart notif (Finnhub)

**Tanggal:** 2026-07-12 · **Status:** design (belum diimplementasi)
**Konteks:** lanjutan fitur News. Fase 1 (economic calendar + bias) & Fase 2 (marker
on-chart) sudah live (PR #21 dst). Ini fitur **BARU & terpisah** dari economic calendar:
feed **headline/artikel berita pasar** (ala tab "News" TradingView, beda dari tab
"Calendar"). Backlog sumber: `docs/news-followups.md`.

---

## 1. Tujuan

Tiga bagian berurutan yang saling bergantung, dirancang menyeluruh di sini, tapi
**diimplementasi jadi PR kecil terpisah** (satu fitur = satu PR, lihat `CLAUDE.md`):

1. **Feed (fondasi backend):** agregator multi-sumber (fan-out → merge → dedupe →
   normalisasi) + cache → endpoint `/api/news/headlines?instrument=`. v1: 1 sumber
   (Finnhub); sumber lain tinggal dicolok ke registry.
2. **Tab "News" di panel:** daftar headline (judul + sumber + waktu + "Keep reading"),
   difilter ke instrumen chart aktif, toggle `[Calendar | News]` di panel News yang ada.
3. **Notif kartu on-chart:** headline BARU yang relevan instrumen aktif → kartu di
   kanan-atas chart, manual dismiss.

**Prinsip UX (mengikuti TradingView):** default = **berita relevan instrumen aktif**,
bukan semua berita pasar. Untuk metal/indeks, berita makro USD/Fed ikut dianggap relevan
karena menggerakkan harga (selaras logika `RelevantCurrencies` yang sudah ada — kedua sisi
pasangan + USD untuk metal).

## 2. Non-goals (YAGNI — ditunda, spec sendiri)

- Push notification rilis high-impact tanpa buka aplikasi.
- AI summary/digest naratif.
- Mode filter "by Market" / "by Watchlist" ala TradingView — v1 hanya **by Symbol**
  (instrumen aktif). Bisa ditambah kemudian.
- Persist "seen headlines" ke server. v1 pakai localStorage (konsisten dgn `br_*`).

> Catatan: **agregasi multi-sumber ADALAH goal** (arsitektur inti, §4). Yang di-defer
> hanya **implementasi sumber ke-2+** — v1 mendaftarkan 1 sumber (Finnhub), sisanya
> tinggal dicolok ke registry tanpa ubah arsitektur.

## 3. Arsitektur

```
Sources (tiap sumber self-contained; Enabled() dari env-nya sendiri):
  ├─ Finnhub    (v1)     /api/v1/news?category={general,forex,crypto}
  ├─ RSS        (nanti)  ForexLive/FXStreet/… (zero-key)
  └─ Marketaux  (nanti)  entity-tag (butuh key)
        │  Aggregate(): fan-out KONKUREN + isolasi kegagalan per-sumber
        ▼  → merge → dedupe (URL kanonik) → sort PublishedAt desc
internal/news/headlines.go   ── Headline model + Source interface + Aggregate()
internal/news/finnhub.go     ── impl Source #1 (fetch + NormalizeFinnhub → Headline)
internal/news/relevance.go   ── keyword-map: instrumen → Matcher (murni, teruji)
        ▼
headlines.go (top-level)     ── registry sumber + hlCache (agregat, stale-while-last-good) + endpoint
        │  GET /api/news/headlines?instrument=XAU_USD  (requireUser)
        ▼
Frontend (index.html)
   ├─ Part 2: tab News di #newspanel (list + Keep reading)
   └─ Part 3: kartu #newsCards kanan-atas #chart (deteksi baru: stable-id + watermark)
```

Pola ini **mencerminkan `news.go` (calendar) yang sudah terbukti**: fetch broad →
cache → **filter per-instrumen di server**. Tidak ada 1 query per instrumen. Bedanya:
sumber kini **jamak** di balik `Aggregate()`, dan model `Headline` provider-agnostik.

## 4. Sumber & agregasi (Finnhub = sumber pertama)

Desain berpusat pada **agregator**, bukan satu provider: `Aggregate()` fan-out ke semua
sumber terdaftar secara konkuren, lalu **merge → dedupe → sort**. Tambah sumber baru =
implement interface `Source` + daftar di registry — **tanpa menyentuh** relevansi, cache,
atau UI. **v1 mendaftarkan 1 sumber (Finnhub);** RSS/Marketaux tinggal dicolok kemudian.

**Prinsip agregasi:**
- **Isolasi kegagalan:** satu sumber error/timeout **tidak** menjatuhkan feed — hasil
  sumber lain tetap disajikan; kegagalan di-log, respons ditandai `partial:true`.
- **Enabled per-sumber:** tiap sumber tahu sendiri apakah aktif (mis. Finnhub aktif bila
  `FINNHUB_TOKEN` ada; RSS selalu aktif). **Nol sumber aktif → `disabled:true`.**
- **Dedupe lintas-sumber:** cerita sama (Reuters via Finnhub & via RSS) digabung; key =
  **URL ter-kanonik** (host lowercase, buang query `utm_*`/fragment). Bila bentrok,
  menang entry ber-`Summary` non-kosong (fallback: yang pertama).
- **Stable ID:** `ID = hash(URL kanonik)` → identitas headline **konsisten lintas-sumber
  & lintas-poll** (menggantikan `id` monotonik Finnhub yg tak portabel). Dipakai FE untuk
  dedupe tampilan + deteksi "baru".

**Sumber #1 — Finnhub.** Dipilih karena **rate 60 call/menit (free)** (vs Marketaux
100/**hari**) → untuk fan-out server-cached kita ≈ tak terbatas, menghapus starvation &
feed-ringkas Marketaux. Harga: relevansi via **keyword-map** (field `related` Finnhub
berorientasi saham, tak ada kategori "commodity").
- **Endpoint:** `GET https://finnhub.io/api/v1/news?category=<cat>&token=<FINNHUB_TOKEN>`
- Kategori: `general` (makro/logam/indeks), `forex`, `crypto`. (`merger` diabaikan.)
- Field per item: `category, datetime` (unix detik), `headline`, `id`, `image`,
  `related`, `source`, `summary`, `url`. (`id` Finnhub hanya internal saat fetch; model
  publik pakai stable-ID hash-URL.)
- **Rate budget:** 3 kategori × tiap 60s = 3 call/menit ≪ 3600/jam. TTL cache 60s → live.

## 5. Backend

### 5.1 `internal/news/headlines.go` — model, interface `Source`, `Aggregate()`

```go
type Headline struct {
    ID          string    // stable = hash(URL kanonik), konsisten lintas-sumber & poll
    Title       string
    Source      string    // publisher (mis. "Reuters")
    Via         string    // sumber agregator asal (mis. "finnhub") — utk log/debug/dedupe
    URL         string
    Summary     string
    PublishedAt time.Time
}

// Source = satu penyedia berita. Implementasi baru cukup penuhi interface ini + daftar
// di registry (headlines.go). Tak menyentuh Aggregate/relevansi/cache/UI.
type Source interface {
    Name() string                                    // "finnhub" — label log/Via
    Enabled() bool                                   // config/token tersedia?
    Fetch(client *http.Client) ([]Headline, error)   // ID & Via sudah terisi
}

// Aggregate fan-out KONKUREN ke semua sumber Enabled(), lalu merge+dedupe+sort.
// partial=true bila ≥1 sumber gagal tapi ada yang sukses. err hanya bila SEMUA
// sumber Enabled gagal. Bila tak ada sumber Enabled → ([], false, ErrNoSource).
func Aggregate(sources []Source, client *http.Client) (out []Headline, partial bool, err error)

// CanonicalURL menormalkan URL utk key dedupe & stable ID (host lower, buang utm_*/#).
func CanonicalURL(raw string) string
// DedupeMerge menggabung headline berdasar ID (=hash CanonicalURL); menang yg ber-Summary.
func DedupeMerge(in []Headline) []Headline
```

`Aggregate` fan-out pakai goroutine + `sync.WaitGroup`, tiap sumber dibungkus
`recover`/timeout sendiri (isolasi). Fungsi murni (`CanonicalURL`/`DedupeMerge`) teruji
tabel; `Aggregate` teruji dgn sumber palsu (sukses/gagal/campuran).

### 5.1b `internal/news/finnhub.go` — impl `Source` #1

```go
type Finnhub struct {
    Token      string
    Categories []string  // default: {"general","forex","crypto"}
}
func (Finnhub) Name() string             { return "finnhub" }
func (f Finnhub) Enabled() bool          { return strings.TrimSpace(f.Token) != "" }
func (f Finnhub) Fetch(client *http.Client) ([]Headline, error) // isi ID(hash URL)+Via

// NormalizeFinnhub: array JSON 1 kategori → []Headline (ID+Via terisi). Error jelas
// bila bentuk feed berubah (mirror FetchCalendar). Dedup lintas-kategori via ID.
func NormalizeFinnhub(body []byte) ([]Headline, error)
```

### 5.2 `internal/news/relevance.go` (keyword-map — jantung filter)

```go
// Matcher menentukan apakah sebuah Headline relevan untuk instrumen tertentu.
type Matcher struct {
    include []string // substring lowercase; ADA yang cocok → relevan
}

func (m Matcher) Matches(h Headline) bool // cek Title+Summary (lowercased)

// RelevanceFor membangun Matcher untuk instrumen (mis. "XAU_USD").
func RelevanceFor(instrument string) Matcher
```

**Aturan pembentukan `include`** (universe instrumen: lihat `IPK_META` di index.html):

| Kelompok | Sumber keyword |
|---|---|
| **Forex** (EUR_USD, GBP_JPY, …) | union keyword **kedua** currency (reuse `RelevantCurrencies`) |
| **Metals** (XAU_USD, XAG_USD) | keyword logam (gold/bullion/xau · silver/xag) **+** keyword USD |
| **Crypto** (BTC/ETH/LTC/BCH_USD) | keyword aset (bitcoin/btc, ethereum/eth, …) |
| **Indices** (SPX500/NAS100/US30/DAX/…) | keyword indeks (s&p 500, nasdaq, dow, dax, ftse, …) **+** currency negara |
| **DXY** | keyword USD |

**Tabel keyword currency** (lowercase, cek substring di Title+Summary):

```
USD → dollar, greenback, fed, fomc, treasury, dxy
EUR → euro, ecb, eurozone
GBP → pound, sterling, boe
JPY → yen, boj
CHF → franc, snb
CAD → canadian dollar, loonie, boc
AUD → aussie, rba, australian dollar
NZD → kiwi, rbnz, new zealand dollar
```

**Tabel keyword aset:**

```
XAU → gold, bullion, xau        XAG → silver, xag
BTC → bitcoin, btc              ETH → ethereum, ether, eth
LTC → litecoin, ltc             BCH → bitcoin cash, bch
SPX → s&p 500, s&p500, spx      NAS → nasdaq, nas100
DJI → dow jones, dow            RUT → russell 2000
DAX → dax, germany 40           FTSE → ftse, uk 100
CAC → cac 40                    STOXX → euro stoxx, stoxx 50
NKY → nikkei                    ASX → asx 200, australia 200
HSI → hang seng
```

Semua tabel = data statis → **unit-test tabel** (ala `classify_test.go`): headline
contoh → instrumen relevan diharapkan (positif & negatif, cegah false-positive mis.
"euro" nyangkut di berita gold).

> Catatan false-positive: keyword pendek berisiko (mis. "dow" di "download"). Mitigasi:
> keyword dipilih spesifik-domain; substring dicek pada teks yang sudah dilowercase;
> uji negatif eksplisit. Tidak pakai word-boundary regex di v1 (KISS) kecuali test
> menunjukkan perlu.

### 5.3 `headlines.go` (top-level — cache + endpoint, cermin `news.go`)

```go
const hlTTL = 60 * time.Second

// hlSources = registry sumber. Tambah sumber baru = tambah satu baris di sini.
func hlSources() []news.Source {
    return []news.Source{
        news.Finnhub{Token: os.Getenv("FINNHUB_TOKEN")},
        // news.RSS{...},        // nanti
        // news.Marketaux{...},  // nanti
    }
}

type hlCache struct {
    mu        sync.Mutex
    items     []news.Headline
    partial   bool
    fetchedAt time.Time
    ok        bool
    fetch     func() ([]news.Headline, bool, error) // injectable utk test → Aggregate
}
// get: refetch bila TTL lewat; stale=true bila sajikan last-good saat refetch gagal
// (identik semantik calCache.get). fetch default = news.Aggregate(hlSources(), nil).
```

**Registry** = satu-satunya tempat sumber didaftarkan. `Aggregate` yang mengurus fan-out,
merge, dedupe, isolasi kegagalan → cache hanya menyimpan hasil agregat.

**Endpoint** `GET /api/news/headlines?instrument=XAU_USD` (default `XAU_USD` bila kosong),
`requireUser` (senada `/api/news/calendar`), daftar di `api.go`:

```go
mux.HandleFunc("GET /api/news/headlines", requireUser(handleNewsHeadlines))
```

**Degradasi anggun (nol sumber aktif):** bila **tak ada** sumber `Enabled()` (mis.
`FINNHUB_TOKEN` kosong & belum ada sumber lain) → `Aggregate` balik `ErrNoSource` →
handler balas `200 {"disabled":true,"headlines":[]}`. Kalender & sisa app tak terpengaruh.

### 5.4 Kontrak JSON

```jsonc
{
  "disabled": false,          // true → FE sembunyikan tab News + notif
  "stale": false,             // true → sajian last-good (refetch semua sumber gagal)
  "partial": false,           // true → sebagian sumber gagal, sisanya tetap disajikan
  "fetchedAt": "2026-07-12T09:00:00Z",
  "instrument": "XAU_USD",
  "headlines": [
    {
      "id": "a1b2c3d4",       // stable = hash(URL kanonik); deteksi "baru" + dedupe di FE
      "title": "Gold slips as dollar firms ahead of Fed",
      "source": "Reuters",    // publisher
      "url": "https://...",
      "summary": "…",
      "publishedAt": "2026-07-12T08:57:00Z"
    }
  ]
}
```

`buildHeadlinesResponse(items, instrument, now, fetchedAt, stale)` = fungsi murni
(tanpa jaringan) → mudah di-test. Filter via `news.RelevanceFor(instrument)`, urут
`publishedAt` desc, **cap 30 item**, newest-first.

## 6. Frontend — Part 2: tab News di panel

`#newspanel` (grid-area `markets`, radio dgn Markets) kini berisi Calendar. Tambah
**segmented toggle `[Calendar | News]`** di header panel:

- State tab persist `localStorage['br_newsTab']` (`calendar`|`news`, default `calendar`).
- Tab **News**: daftar kartu headline instrumen aktif —
  `judul` · `sumber · waktu relatif` · tombol/tautan **"Keep reading"** (buka `url`
  di tab baru, `rel="noopener"`).
- State: loading / empty ("No recent headlines for <instrument>") / error / stale badge.
- Data via `GET /api/news/headlines?instrument=<aktif>`. Fetch murah (server-cached) →
  nebeng timer News yang ada (`_newsTimer`, 60s) + refetch saat ganti instrumen
  (`refreshNewsData` sudah dipanggil di jalur `selectSymbol`).
- Teks UI **bahasa Inggris** (lihat memory ui-text-english).

Bila respons `disabled:true` → sembunyikan seluruh toggle tab (panel jadi Calendar-only,
seperti sekarang).

## 7. Frontend — Part 3: notif kartu on-chart

- **Container** `#newsCards` (baru), absolute **kanan-atas `#chart`**, di bawah wordmark
  Luna (hindari tabrakan), `z-index` di atas chart, kartu `pointer-events:auto`.
- **Bentuk kartu:** `[BADGE] · source — <judul> — Keep reading — <jam> — ✕`.
  `BADGE` = label pendek instrumen aktif (derive dari `IPK_META`, mis. "GOLD",
  "EUR/USD") → payload tak perlu bawa badge.
- **Manual dismiss:** kartu menetap sampai klik ✕ (pilihan user). **Cap tumpukan max 3
  (FIFO):** bila kartu ke-4 datang, kartu **terlama** dibuang otomatis agar chart tak
  tertutup (watermark-nya tetap dianggap "seen"). Tanpa antrian.
- **Deteksi "baru" per-instrumen (watermark + stable-id):** `id` kini string
  (hash-URL) yang stabil lintas-sumber, bukan integer monotonik → deteksi pakai
  **watermark `publishedAt`** + guard stable-id:
  `localStorage['br_newsSeen']` = map `{ "<instrument>": "<publishedAt watermark>" }`.
  Headline dianggap **baru** bila `publishedAt > watermark[instrument]`. Guard set
  `id` yang sudah ditampilkan (in-memory per sesi) mencegah kartu ganda saat cerita
  sama tiba telat dari sumber berbeda dgn timestamp beda. Setelah render, majukan
  `watermark[instrument]` ke `publishedAt` maksimum yang sudah **ditampilkan**.
  (Watermark timestamp dipilih di atas "set id" agar tahan sumber jamak: tak semua
  sumber punya id yang bisa diurut.)
- **Boot / ganti instrumen:** JANGAN tampilkan backlog. Saat pertama lihat instrumen
  (belum ada watermark), set `watermark[instrument] = max(publishedAt)` saat ini
  **tanpa** render kartu → hanya headline yang datang **setelah** itu memicu notif.
  Ganti instrumen → bersihkan `#newsCards`, muat relevansi instrumen baru.
- Reuse timer 60s yang sama (bukan sistem toast biasa — kartu ini persisten & lebih kaya).

## 8. UI/UX — komponen visual (anatomi, bukan CSS final)

Prinsip: komponen News **menyatu** dengan design system Luna, bukan identitas baru. CSS
final dikerjakan saat implementasi PR-2/PR-3 (frontend-design + iterasi screenshot browser
dgn token asli & feed nyata). Di sini hanya anatomi + token/komponen yang di-reuse.

### 8.1 Bahasa warna semantik (signature)

Sistem sudah memakai warna untuk **harga/order**: `--accent` biru (info trade),
`--green`/`--red` (buy/sell). Berita = kelas informasi berbeda → diberi aksen brand
**`--luna-glow` (#aeb9e8, crescent bulan)** di tepi kartu News. Sekali pandang user bisa
bedakan "ini intel berita" vs "ini event order/harga". Bukan dekorasi — penanda kelas
informasi, dan selaras dgn marker news on-chart (`.nmk`) yang sudah memakai `--luna-glow`.

### 8.2 Tab toggle `[Calendar | News]` (Part 2)

Di baris `.wl-head` header panel News (uppercase 10px yg sudah ada). Segmented compact:

```
┌ NEWS ─────────────── [ Calendar | News ] ─ ✕ ┐
```

Track `bg:var(--inset)` radius; segmen aktif `bg:var(--panel)` + `--txt`; nonaktif
`--muted`; hover nonaktif → `--btn-hover`. Ikut idiom `--btn`. Persist `br_newsTab`.

### 8.3 Kartu headline di list (Part 2)

Echo struktur `.cal-item` (baris dipisah `border-bottom:var(--border)`, hover tint):

```
┌───────────────────────────────────┐
│ Reuters · 12m ago                 │  source(--hdr,11px) · waktu(--font-num,--muted)
│ Gold slips as dollar firms ahead  │  judul --txt 13px Inter, clamp 2 baris
│ of Fed decision                   │
│ Keep reading ↗                    │  --luna-glow; muncul jelas saat hover
└───────────────────────────────────┘
```

- Seluruh baris klik → buka `url` tab baru (`rel="noopener"`); `↗` muncul saat hover;
  teks "Keep reading" eksplisit untuk kejelasan + a11y.
- Hover baris: `bg:color-mix(in srgb, var(--luna-glow) 6%, transparent)` (senada
  `.cal-item.released` yg pakai `--accent 6%`).

### 8.4 Kartu notif on-chart (Part 3)

Sepupu `.toast` (border, radius 9px, `--shadow`) tapi: posisi `absolute` **kanan-atas
`#chart` di bawah wordmark**, persisten, `border-left:3px solid var(--luna-glow)`
(bukan `--accent` toast → menegaskan "berita").

```
┌────────────────────────────────────────┐
│ ◐ GOLD · Reuters            12m ago  ✕ │  crescent + badge(pill) + source · waktu · dismiss
│ Gold slips as dollar firms ahead of    │  judul clamp 2 baris
│ Fed decision                           │
│ Keep reading ↗                         │  --luna-glow
└────────────────────────────────────────┘  ▏border-left --luna-glow
```

- Badge derive dari `IPK_META` (GOLD / EUR/USD / BTC / S&P 500) → payload tak bawa badge.
- Glyph crescent ◐ mengikat ke brand (favicon/watermark). Stack ke bawah, cap 3 FIFO.

### 8.5 Motion & a11y (quality floor)

- Masuk: slide+fade halus dari kanan (idiom transisi `.toast`: `opacity` + `translate`).
  Keluar: fade. **Hormati `prefers-reduced-motion`** → tanpa translate (juga backlog P2).
- Fokus keyboard terlihat pada toggle, "Keep reading", ✕. ✕ ber-`aria-label="Dismiss"`.
- Kontras teks di atas `--panel` (txt #fff / muted #89898b) sudah standar sistem.

### 8.6 Copy (English, interface voice — lihat memory ui-text-english)

| State | Teks |
|---|---|
| Empty | `No recent headlines for {instrument}.` |
| Loading | `Loading…` (senada `.news-empty` existing) |
| Unavailable | `Headlines unavailable. Retrying…` |
| Stale | badge kecil `Delayed` (`--muted`), bukan alarm |

Aksi konsisten sepanjang flow: tautan selalu "Keep reading"; ✕ = Dismiss.

## 9. Konfigurasi & deploy

- `.env` + `.env.example`: tambah `FINNHUB_TOKEN=` (kosong = fitur mati, app tetap jalan).
- Deploy EC2 (lihat memory bar-replay-deploy): tambah `FINNHUB_TOKEN` ke
  `/etc/bar-replay.env`, `systemctl restart`.
- README: dokumentasikan env baru + catatan "News headlines opsional".

## 10. Strategi test

- **Murni / unit** (`internal/news`, ala `classify_test.go`/`calendar_test.go`):
  - `NormalizeFinnhub`: JSON contoh → `[]Headline` (ID hash-URL + Via terisi; error saat
    bentuk salah).
  - `CanonicalURL` / `DedupeMerge`: tabel — utm/fragment dibuang, dua entry URL sama →
    satu (menang yg ber-Summary).
  - `Aggregate`: sumber **palsu** (fake `Source`) — semua sukses / satu gagal (`partial`)
    / semua gagal (`err`) / nol Enabled (`ErrNoSource`); hasil ter-merge+dedupe+urut.
  - `RelevanceFor`/`Matches`: tabel positif+negatif per kelompok instrumen (gold vs
    forex vs crypto vs indeks); uji anti-false-positive.
  - `buildHeadlinesResponse`: filter+urut+cap dgn `Headline` sintetik (tanpa jaringan).
- **Cache** (`headlines.go`, ala `news_test.go`): `fetch` injectable → TTL hit/miss,
  stale-while-last-good saat fetch gagal, `disabled` saat nol sumber aktif.
- **FE:** verifikasi manual browser (login OANDA utk chart; headline butuh ≥1 sumber
  aktif, mis. `FINNHUB_TOKEN`). Cek: tab toggle, filter per-instrumen, Keep reading,
  kartu muncul hanya utk headline baru (watermark), manual dismiss, cap 3, ganti
  instrumen tak spam backlog.

## 11. Dekomposisi PR (implementasi bertahap)

1. **PR-1 feed + agregator (backend):** `internal/news/headlines.go` (model + `Source` +
   `Aggregate` + `CanonicalURL`/`DedupeMerge`) + `finnhub.go` + `relevance.go` +
   `headlines.go` (registry + cache + endpoint) + route + env + test. Verifikasi:
   `go build` + `go test ./...` + curl endpoint (≥1 sumber aktif) / `disabled` (nol sumber).
2. **PR-2 tab News (FE):** segmented toggle + list + Keep reading + state empty/error/stale.
3. **PR-3 notif on-chart (FE):** `#newsCards` + deteksi baru (watermark) + manual dismiss +
   cap 3 + reset saat ganti instrumen.

Tiap PR rebase harian ke main (index.html monolitik → rawan konflik; lihat `CLAUDE.md`).

## 12. Risiko & catatan

- **Presisi keyword-map** = risiko utama Finnhub. Ditangani via tabel keyword
  spesifik-domain + unit-test positif/negatif; tuning iteratif setelah lihat feed nyata.
- **Kualitas feed `general`** untuk logam/indeks belum diverifikasi empiris (docs Finnhub
  403 saat difetch otomatis). Validasi begitu `FINNHUB_TOKEN` tersedia; bila `general`
  miskin berita gold, **tambah sumber** (RSS/Marketaux) lewat registry — justru inilah
  yang dimudahkan agregator.
- **Merge/dedupe lintas-sumber belum teruji data-nyata** di v1 (hanya 1 sumber aktif +
  unit test sumber-palsu). Saat sumber ke-2 dicolok, verifikasi dedupe URL-kanonik nyata
  (cerita sama beda publisher/tracking-param).
- **Stable-ID = hash(URL kanonik)** mengandaikan URL artikel stabil. Bila publisher pakai
  URL berubah-ubah (redirect/param sesi), dua entry bisa lolos sebagai berbeda →
  perluas aturan `CanonicalURL`. Deteksi "baru" bertumpu `publishedAt`, jadi tetap jalan.
```
