# News — Economic Calendar + Directional Bias (Fase 1)

**Tanggal:** 2026-07-08
**Status:** Disetujui (brainstorming), siap masuk rencana implementasi.

## Ringkasan

Menambah fitur **News** ke luna-trade, terinspirasi tab News TradingView, tapi difokuskan
pada yang paling berguna untuk trader forex/gold dan bisa dibangun **tanpa API key berbayar**:

1. **Economic calendar** — rilis data ekonomi minggu berjalan (waktu, currency, impact,
   forecast/previous/actual).
2. **Directional bias** — penilaian arah deterministik/rule-based per instrumen berdasarkan
   surprise (actual vs forecast). Menggantikan "sentiment skor generik" dengan bias yang
   actionable.

Sumber & logika di-**port dari repo `xau-ict-engine`** (paket `internal/news`, std-lib murni,
deterministik, tanpa LLM). Feed kalender = mirror publik Forex Factory (`nfs.faireconomy.media`),
**tanpa API key**.

### Keputusan brainstorming (terkunci)

- **Fase 1 tidak memakai provider berbayar sama sekali** (zero API key). Marketaux/Alpha Vantage
  hanya relevan untuk *headline feed artikel* yang **ditunda** ke fase lanjut.
- **Sentiment → directional bias** deterministik (bukan skor provider, bukan AI).
- **Bias digeneralisasi** dari gold-only (di repo asal) ke **forex pairs + DXY**.
- **Penempatan UI:** tombol rail ke-4 → panel News tersendiri di kolom kanan (radio dengan
  panel Markets: satu terlihat pada satu waktu).
- **Deterministik, tanpa LLM.**

### Non-goals Fase 1 (YAGNI)

Headline feed artikel (Marketaux/Alpha Vantage), fallback BLS, push notification/alert,
ringkasan naratif AI, digest mingguan, state machine dedup alert. Semua bisa jadi fase lanjut.

---

## Arsitektur

Port logika sebagai **subpackage baru `internal/news`** (bukan flat `package main`). Ini logika
murni & sudah teruji di repo asal; isolasi memudahkan unit-test dan memboyong test yang ada.
Satu-satunya deviasi dari konvensi flat repo, disengaja.

```
luna-trade/
├── internal/news/
│   ├── calendar.go   # Event, ParseCalendar, FetchCalendar, filter (country/impact → param)
│   ├── classify.go   # ParseNumber, KindOf, Surprise, Release, GroupReleases (port utuh)
│   ├── bias.go       # BARU: generalisasi USD-surprise → bias per-instrumen
│   ├── verdict.go    # Release.Classify() → Verdict (tanpa render Telegram)
│   └── *_test.go     # port test classify + test baru bias mapping
├── news.go           # BARU (package main): handler HTTP + cache feed in-memory
└── index.html        # panel News + tombol rail + fetch/render
```

### Apa yang di-port dari `xau-ict-engine/internal/news`

**Diangkat (library murni):**

- `calendar.go`: `Event{Title,Country,Impact,Time,Forecast,Previous,Actual}`, `Released()`,
  `ParseCalendar([]byte)`, `FetchCalendar(*http.Client)`, `FetchCalendarRaw`. Fungsi filter
  `FilterUSDHighImpact` di-generalisasi jadi menerima param country/impact (default USD/High).
- `classify.go` **utuh**: `ParseNumber` (toleran `"0.3%"`,`"85K"`,`"<0.1%"`, koma ribuan),
  `Kind`/`KindOf`, `Surprise`, `Release` + metode (`Released`, `AnyReleased`, `Headline`,
  `WithActual`), `GroupReleases(events, nameOf)`, `DefaultName` (filter CPI/PPI/NFP).
- `Release.Classify() Verdict` (dari `message.go`) → menghasilkan bias + tiebreaker core m/m
  **tanpa** merender pesan Telegram. Template `Build*Message` **tidak** diangkat; UI merender
  sendiri dari `Verdict`.
- `PickTarget` + `ParseNames` (dari `decide.go`) — murni, untuk memilih rilis yang ditampilkan.

**Tidak diangkat (daemon-only):** `state.go` (dedup `news_state.json`), `Decide` (state machine
alert), `FetchCalendarCached` (cache file — diganti cache in-memory), `bls.go` (fase lanjut),
`digest.go`, seluruh `cmd/newsalert`.

---

## Generalisasi bias (bagian baru — inti permintaan)

Repo asal hard-coded "bearish **gold**" (rezim 2026: data US kuat → hawkish → USD naik →
gold tertekan). Dipisah jadi dua lapis:

### Lapis 1 — USD surprise (port apa adanya)

Untuk indikator inflasi (CPI/PPI) & jobs (NFP):

| Surprise (actual vs forecast) | Sinyal USD |
|---|---|
| Above forecast | **USD-hawkish (USD↑)** |
| Below forecast | **USD-dovish (USD↓)** |
| Inline | Netral (+ tiebreaker core m/m untuk inflasi) |

### Lapis 2 — peta instrumen → arah (baru)

| Peran USD di instrumen | Contoh | USD↑ (data kuat) | USD↓ (data lemah) |
|---|---|---|---|
| USD sebagai *quote*, base asing | EUR/USD, GBP/USD, AUD/USD, NZD/USD | 📉 bearish pair | 📈 bullish pair |
| USD sebagai *base* | USD/JPY, USD/CAD, USD/CHF | 📈 bullish pair | 📉 bearish pair |
| Gold (inverse USD/yield) | XAU/USD | 📉 bearish | 📈 bullish |
| Indeks USD | DXY | 📈 bullish | 📉 bearish |

**Implementasi:** fungsi `InstrumentUSDRole(symbol string) Role` memetakan simbol ke salah satu
kategori (`RoleQuoteUSD`, `RoleBaseUSD`, `RoleGold`, `RoleDXY`, `RoleUnknown`). Lalu
`BiasForInstrument(usdLean, role) (Bias, label)` menurunkan arah + label generik (tanpa literal
"gold"). Simbol `RoleUnknown` → bias `Neutral` + catatan "no USD linkage".

**Asumsi rezim** (data kuat = hawkish = USD↑) di-*embed* sebagai konstanta yang bisa dibalik
(`RegimeHawkishOnStrong bool`), dan **ditampilkan terang-terangan** di panel (chip "Regime:
strong data → USD↑"). Ini penting — di rezim rate-cut arah bisa berbeda; asumsi tidak
disembunyikan.

---

## Backend — endpoint

Satu handler baru, mengikuti pola `api.go` (`requireUser`, `writeJSON`/`writeErr`):

```
GET /api/news/calendar?instrument=XAU_USD
```

**Perilaku:**

- Fetch feed FaireEconomy **sekali di sisi server**, simpan di **cache in-memory** dengan TTL.
  Hormati rate-limit feed (maks 2 unduh / 5 menit per file) → refetch paling cepat ~10 menit.
  Fan-out satu fetch server ke semua user (mirip pola `Hub`/`cfg` global di `api.go`).
- Fallback: bila feed 429/down, sajikan **last-good** dari memori + flag `stale:true` + timestamp
  fetch sukses terakhir. Bila belum pernah sukses → error 503 dengan pesan jelas.
- Parsing defensif: baris gagal-parse di-skip; error **hanya** bila SEMUA baris gagal (deteksi
  format feed berubah).
- Filter: default `Country=USD & Impact=High` (bisa diperluas belakangan). Indikator dikelompokkan
  via `GroupReleases` + `DefaultName` (CPI/PPI/NFP).

**Bentuk response (JSON):**

```json
{
  "stale": false,
  "fetchedAt": "2026-07-08T06:00:00Z",
  "instrument": "XAU_USD",
  "regime": "strong-data-hawkish",
  "nextRelease": { "name": "CPI", "time": "2026-07-10T12:30:00Z", "minsToGo": 210 },
  "releases": [
    {
      "name": "CPI",
      "time": "2026-07-10T12:30:00Z",
      "currency": "USD",
      "impact": "High",
      "released": false,
      "forecast": "0.3%",
      "previous": "0.2%",
      "actual": "",
      "verdict": {
        "surprise": "unknown",
        "usdLean": "neutral",
        "bias": "neutral",
        "label": "awaiting release",
        "playbook": "Above forecast → USD↑ → bearish XAU/USD; below → relief."
      }
    }
  ]
}
```

`verdict.bias`/`label`/`playbook` dihitung **untuk instrumen yang diminta** (Lapis 2). Bila
`released:false`, verdict berisi skenario "ancang-ancang" (kalau-maka). Bila `true`, verdict
final dari `Release.Classify()` + peta instrumen.

---

## Frontend — panel News (`index.html`)

- **Tombol rail ke-4** (ikon news) di `#rail` (setelah `#toggleTrades`). `onclick=toggleNews()`
  meniru `toggleMarkets` (`index.html:4303`). State di-persist `localStorage['br_newsOpen']`.
- **Panel `#newspanel`** menempati grid-area `markets`, **radio dengan `#watchlist`** (buka News
  → Markets tersembunyi, dan sebaliknya). Header bergaya `.wl-head` dengan judul "News" + tombol
  tutup `✕`.
- **Tiga seksi vertikal:**
  1. **Bias card** (atas) — instrumen aktif + panah 📈/📉 + label ("USD hawkish → bearish
     EUR/USD"), warna `--green`/`--red`, chip rezim.
  2. **Next release** — countdown ke high-impact terdekat + ancang-ancang (forecast vs previous,
     skenario kalau-maka).
  3. **Calendar minggu ini** — list item: waktu (lokal/WIB), currency, dot impact
     (High=`--red`, Medium=amber, Low=`--muted`), forecast/previous/actual. Yang sudah rilis
     di-highlight + emoji surprise (📈/📉/➖).
- **Sinkron instrumen chart:** ganti simbol → bias card & playbook re-fetch (`?instrument=`).
- **Refresh:** fetch saat panel dibuka + poll ringan (~60 dtk) **hanya saat panel terlihat**,
  di-throttle (mirip `queuePriceRender`). Tidak perlu SSE (kalender frekuensi rendah).

### Styling (design token luna-trade)

`--panel`/`--border` untuk kontainer & garis; `--accent` untuk elemen interaktif; `--green`/
`--red` untuk arah bias & sentiment; `--muted` untuk impact rendah. Header panel meniru `.wl-head`.
Font angka `--mono`.

### Copy (bahasa Inggris — konvensi UI luna-trade)

- Empty (tak ada high-impact): "No high-impact USD events this week."
- Stale: badge "Delayed data" + "Updated {time}".
- Gagal total: "News feed unavailable." + tombol "Retry".
- Instrumen tanpa kaitan USD: "No USD linkage for this instrument."

---

## Error handling (ringkasan)

| Kondisi | Backend | Frontend |
|---|---|---|
| Feed 429/down, ada cache | `stale:true` + last-good | badge "Delayed data" |
| Feed gagal, belum pernah sukses | 503 + pesan | empty state "News feed unavailable" + Retry |
| Semua baris gagal parse | 502 "feed format changed" | empty state + Retry |
| Instrumen tak dikenal | `bias:neutral`, role unknown | "No USD linkage for this instrument." |

---

## Testing

- **Port** test `classify` dari repo asal: `ParseNumber` (format bervariasi), `classifySurprise`,
  `biasFor`.
- **Baru** `bias_test.go`: peta instrumen→bias untuk semua kategori tabel Lapis 2 (quote-USD,
  base-USD, gold, DXY, unknown) × (USD↑, USD↓, netral).
- **Baru** `calendar_test.go`: `ParseCalendar` terhadap fixture body feed nyata; pastikan skip
  baris rusak & error bila semua rusak.
- **Baru** handler test `/api/news/calendar`: stub `*http.Client` mengembalikan body sample →
  verifikasi shape JSON, filter USD/High, bias per-instrumen, jalur stale/fallback.

---

## Titik integrasi (rujukan kode luna-trade)

- Daftar handler: `registerAPI` di `api.go:24` → tambah
  `mux.HandleFunc("GET /api/news/calendar", requireUser(handleNewsCalendar))`.
- Helper respons: `writeJSON`/`writeErr` (`api.go:176`).
- State server global (untuk cache feed): pola `cfg`/`hub` (`api.go:16`).
- Toggle panel & persist: `toggleMarkets` (`index.html:4303`), grid `.app` (`index.html:691`),
  rail `#rail` (`index.html:1105`), header panel `.wl-head` (`index.html:1143`).
- Fetch FE: pola `spSync` (`index.html:3112`), throttle `queuePriceRender` (`index.html:4055`).
</content>
</invoke>
