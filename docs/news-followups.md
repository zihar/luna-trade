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

## Catatan

Status fitur & rincian keputusan desain terekam di spec/plan pada `docs/superpowers/` (`2026-07-08-news-*`).
