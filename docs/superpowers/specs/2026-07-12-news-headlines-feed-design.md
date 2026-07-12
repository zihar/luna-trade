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

1. **Feed (fondasi backend):** proxy + cache Finnhub → normalisasi → endpoint
   `/api/news/headlines?instrument=`.
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
- Fallback multi-provider runtime. Provider dibungkus interface (lihat §4) agar
  **ganti/tambah** provider murah, tapi v1 hanya satu impl (Finnhub).
- Persist "seen headlines" ke server. v1 pakai localStorage (konsisten dgn `br_*`).

## 3. Arsitektur

```
Finnhub /api/v1/news?category={general,forex,crypto}
        │  (1 poll per kategori tiap ~60s, dibagi semua user)
        ▼
internal/news/headlines.go   ── Source interface + Finnhub impl + Normalize
internal/news/relevance.go   ── keyword-map: instrumen → Matcher (murni, teruji)
        ▼
headlines.go (top-level)     ── hlCache (in-memory, stale-while-last-good) + endpoint
        │  GET /api/news/headlines?instrument=XAU_USD  (requireUser)
        ▼
Frontend (index.html)
   ├─ Part 2: tab News di #newspanel (list + Keep reading)
   └─ Part 3: kartu notif #newsCards di kanan-atas #chart (deteksi id baru per-instrumen)
```

Pola ini **mencerminkan `news.go` (calendar) yang sudah terbukti**: fetch broad →
cache → **filter per-instrumen di server**. Tidak ada 1 query per instrumen.

## 4. Provider — Finnhub (keputusan terkunci)

Alasan pilih Finnhub di atas Marketaux: **rate 60 call/menit (free)** vs Marketaux
100/**hari**. Untuk arsitektur server-cached fan-out kita, 60/menit ≈ tak terbatas →
menghapus dua masalah terburuk Marketaux free (starvation aset sepi + feed ~3 artikel +
TTL basi). Harga yang dibayar: relevansi via **keyword-map** (bukan entity-tag), karena
field `related` Finnhub berorientasi saham & tak ada kategori "commodity".

**Endpoint:** `GET https://finnhub.io/api/v1/news?category=<cat>&token=<FINNHUB_TOKEN>`
- Kategori dipakai: `general` (makro/logam/indeks), `forex`, `crypto`. (`merger` diabaikan.)
- `&minId=<id>` → hanya berita dgn `id` lebih besar (tersedia, tapi v1 TIDAK memakainya:
  backend cache full-list per kategori; deteksi "baru" dilakukan di FE via banding `id`).
- Field respons per item: `category, datetime` (unix detik), `headline`, `id` (int,
  monotonik naik), `image`, `related`, `source`, `summary`, `url`.

**Rate budget:** poll 3 kategori tiap 60s = 3 call/menit = 180/jam ≪ 3600/jam limit.
Sangat aman. TTL cache 60s → feed terasa live.

## 5. Backend

### 5.1 `internal/news/headlines.go` (fungsi murni, std-lib, teruji)

```go
type Headline struct {
    ID          int64
    Title       string
    Source      string
    URL         string
    Summary     string
    PublishedAt time.Time
    Category    string   // kategori Finnhub asal (general/forex/crypto)
}

// Source = abstraksi provider (Finnhub kini; adapter agar mudah ganti/tambah).
type Source interface {
    // Fetch menarik headline terbaru dari semua kategori yang dipantau.
    // Dedup lintas-kategori by ID. Diurut PublishedAt desc.
    Fetch(client *http.Client) ([]Headline, error)
}

// Finnhub = impl Source. token dibaca oleh pemanggil (headlines.go) dari env.
type Finnhub struct {
    Token      string
    Categories []string  // default: {"general","forex","crypto"}
}

func (f Finnhub) Fetch(client *http.Client) ([]Headline, error) { ... }

// NormalizeFinnhub mengubah array JSON mentah 1 kategori → []Headline.
// Error jelas bila bentuk feed berubah (mirror FetchCalendar).
func NormalizeFinnhub(body []byte, category string) ([]Headline, error) { ... }
```

Dedup lintas-kategori (satu artikel bisa muncul di `general` & `forex`) via set `id`.

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

type hlCache struct {
    mu        sync.Mutex
    items     []news.Headline
    fetchedAt time.Time
    ok        bool
    fetch     func() ([]news.Headline, error) // injectable utk test
}
// get: refetch bila TTL lewat; stale=true bila sajikan last-good saat refetch gagal.
// (identik semantik calCache.get)
```

`fetch` default memanggil `news.Finnhub{Token: os.Getenv("FINNHUB_TOKEN"), …}.Fetch(nil)`.

**Endpoint** `GET /api/news/headlines?instrument=XAU_USD` (default `XAU_USD` bila kosong),
`requireUser` (senada `/api/news/calendar`), daftar di `api.go`:

```go
mux.HandleFunc("GET /api/news/headlines", requireUser(handleNewsHeadlines))
```

**Degradasi anggun (token kosong):** bila `FINNHUB_TOKEN` kosong → **tanpa fetch**,
balas `200 {"disabled":true,"headlines":[]}`. Kalender & sisa app tak terpengaruh.

### 5.4 Kontrak JSON

```jsonc
{
  "disabled": false,          // true → FE sembunyikan tab News + notif
  "stale": false,             // true → sajian last-good (refetch gagal)
  "fetchedAt": "2026-07-12T09:00:00Z",
  "instrument": "XAU_USD",
  "headlines": [
    {
      "id": 7712345,          // id Finnhub (monotonik) → deteksi "baru" di FE
      "title": "Gold slips as dollar firms ahead of Fed",
      "source": "Reuters",
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
  tertutup (id-nya tetap dianggap "seen"). Tanpa antrian.
- **Deteksi "baru" per-instrumen:** `localStorage['br_newsSeen']` = map
  `{ "<instrument>": <maxIdTerlihat> }`. Saat poll headlines instrumen aktif:
  headline dengan `id > seen[instrument]` = **baru** → render kartu; lalu update
  `seen[instrument]` ke `max(id)` yang sudah **ditampilkan** (bukan yang di-dismiss),
  supaya tak muncul ulang.
- **Boot / ganti instrumen:** JANGAN tampilkan backlog. Saat pertama lihat instrumen
  (belum ada entry `seen`), set `seen[instrument] = max(id)` saat ini **tanpa** render
  kartu → hanya headline yang datang **setelah** itu memicu notif. Ganti instrumen →
  bersihkan `#newsCards`, muat relevansi instrumen baru.
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
  - `NormalizeFinnhub`: JSON contoh → `[]Headline` (+ error saat bentuk salah).
  - `RelevanceFor`/`Matches`: tabel positif+negatif per kelompok instrumen (gold vs
    forex vs crypto vs indeks); uji anti-false-positive.
  - `buildHeadlinesResponse`: filter+urut+cap dgn `Headline` sintetik (tanpa jaringan).
- **Cache** (`headlines.go`, ala `news_test.go`): `fetch` injectable → TTL hit/miss,
  stale-while-last-good saat fetch gagal, `disabled` saat token kosong.
- **FE:** verifikasi manual browser (login OANDA utk chart; headline butuh
  `FINNHUB_TOKEN`). Cek: tab toggle, filter per-instrumen, Keep reading, kartu muncul
  hanya utk id baru, manual dismiss, cap 3, ganti instrumen tak spam backlog.

## 11. Dekomposisi PR (implementasi bertahap)

1. **PR-1 feed (backend):** `internal/news/headlines.go` + `relevance.go` + `headlines.go`
   + route + env + test. Verifikasi: `go build` + `go test ./...` + curl endpoint
   (dgn token) / `disabled` (tanpa token).
2. **PR-2 tab News (FE):** segmented toggle + list + Keep reading + state empty/error/stale.
3. **PR-3 notif on-chart (FE):** `#newsCards` + deteksi id-baru + manual dismiss + cap 3
   + reset saat ganti instrumen.

Tiap PR rebase harian ke main (index.html monolitik → rawan konflik; lihat `CLAUDE.md`).

## 12. Risiko & catatan

- **Presisi keyword-map** = risiko utama Finnhub. Ditangani via tabel keyword
  spesifik-domain + unit-test positif/negatif; tuning iteratif setelah lihat feed nyata.
- **Kualitas feed `general`** untuk logam/indeks belum diverifikasi empiris (docs Finnhub
  403 saat difetch otomatis). Validasi begitu `FINNHUB_TOKEN` tersedia; bila `general`
  miskin berita gold, pertimbangkan tambah kata kunci / kelas query. Adapter `Source`
  bikin penyesuaian/ganti provider murah.
- **`id` monotonik** diasumsikan naik global lintas kategori. Bila ternyata per-kategori,
  deteksi "baru" fallback ke `publishedAt`. Uji saat integrasi nyata.
```
