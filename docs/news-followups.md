# News feature — follow-up backlog

Item non-blocking yang ditunda dari fitur News (Fase 1 kalender+bias & Fase 2 marker on-chart badge multi-currency), di-merge ke `main` via PR #21 (2026-07-08). Semua bersifat peningkatan, bukan bug.

## Backend

- **Bias arah untuk currency non-USD (generalisasi engine bias).**
  Saat ini "Lite": event non-USD (mis. UK CPI di GBP/USD) tampil sebagai marker + data tapi verdict **netral** (tanpa arah). Engine bias (`internal/news/verdict.go`, `bias.go`) masih USD-centric. Generalisasi: dari surprise event currency C → kekuatan C → arah pasangan sesuai peran C (base↑ = pair↑, quote↑ = pair↓). Membuat popup event non-USD punya baris bias.

- **Perluas daftar mata uang fiat (`fiatCodes` di `internal/news/calendar.go`).**
  Sekarang hanya USD/EUR/GBP/JPY/CHF/CAD/AUD/NZD. Instrumen seperti `USD_SEK` → `RelevantCurrencies` mengembalikan `["USD"]` saja (SEK di-drop) walau SEK punya kalender ekonomi. Tambah SEK/NOK dll bila diperlukan.

- **Cache stale-while-revalidate.**
  `newsCache.get` (`news.go`) menahan mutex selama fetch jaringan → request konkuren bisa ter-block sampai ~20s bila feed lambat. Ubah ke pola serve-stale-then-refresh-async. Acceptable untuk skala app ini, tapi kandidat perbaikan.

## Frontend (`index.html`)

- **Startup double-fetch News.**
  Bila panel News tersimpan terbuka (`br_newsOpen==='1'`), `refreshNewsData` terpanggil dua kali saat boot (dari `setNewsOpen(true)` di parse-time + dari `initPriceTimer` chart-ready). Idempoten & murah (server-side cache), tapi bisa di-dedupe.

## Future phases (deferred)

Fitur lebih besar yang sengaja di-non-goal-kan di spec Fase 1 (`docs/superpowers/specs/2026-07-08-news-economic-calendar-bias-design.md`) — masing-masing butuh spec/plan sendiri, bukan sekadar tweak:

- **Headline / article news feed.** Berita/artikel aktual (judul + ringkasan), **beda** dari economic calendar. Butuh provider berbayar + **API key** (Marketaux atau Alpha Vantage). Fase 1/2 sengaja zero-API-key, jadi ini ditunda.
- **Push notification / alert rilis.** Beri tahu user saat event high-impact akan/baru rilis tanpa harus membuka panel/chart.
- **Fallback BLS (keandalan sumber data).** Economic calendar kini bergantung pada satu feed mirror tak-resmi (Forex Factory via `nfs.faireconomy.media`). Tambah sumber cadangan/otoritatif dari **U.S. Bureau of Labor Statistics** (API publik gratis) untuk CPI/PPI/employment saat feed mirror down/basi, atau untuk cross-check nilai Actual.
- **AI summary / digest.** Ringkasan naratif atau digest berkala dari kalender/berita.

## Catatan

Status fitur & rincian keputusan desain terekam di spec/plan pada `docs/superpowers/` (`2026-07-08-news-*`).
