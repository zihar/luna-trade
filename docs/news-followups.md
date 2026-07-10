# News feature — follow-up backlog

Item lanjutan dari fitur News (Fase 1 kalender+bias & Fase 2 marker on-chart, di-merge PR #21).
Status per 2026-07-10.

## Status ringkas

| Item | Status |
|---|---|
| Bias arah currency non-USD | ✅ SELESAI — PR #35 |
| Dedupe startup double-fetch | ✅ SELESAI — PR #36 |
| Perluas `fiatCodes` (SEK/NOK) | ⏸️ SKIP — tak perlu (semua FX Luna major) |
| Cache stale-while-revalidate | 🔸 DEFER — benefit kecil |
| Headline feed + notif on-chart | 🔲 BELUM — fitur besar, butuh pilih provider (lihat bawah) |
| Fallback BLS · push notif · AI summary | 🔲 DEFERRED — spec sendiri |

## Selesai

- **Bias arah currency non-USD (PR #35).** Engine bias digeneralisasi dari USD-only ke lintas-currency:
  `SideOf(symbol,ccy)` (SideBase/Quote/GoldUSD/DXYUSD/None) + `BiasFrom(lean,side)` +
  `PlaybookFor`/`PreScenarioFor` (currency-aware). `news.go` buang gate `Currency=="USD"`. Event
  non-USD (UK CPI, ECB, dll) & cross GBP/JPY·EUR/JPY kini berarah. JSON `usdLean` dipertahankan.
  Fungsi lama (`Role`/`InstrumentRole`/`InstrumentBias`/`Playbook`/`PreScenario`) dihapus.

- **Dedupe startup double-fetch (PR #36).** Guard `_newsInFlight` per-instrumen di `refreshNewsData()`
  → panggilan barengan (setNewsOpen parse-time + initPriceTimer chart-ready) jadi 1 request;
  retry & ganti-instrumen tetap jalan.

## Di-skip / defer

- **Perluas `fiatCodes` (SEK/NOK) — TAK PERLU.** Instrumen Luna saat ini semuanya FX major
  (USD/EUR/GBP/JPY/CHF/CAD/AUD/NZD, sudah dikenal) + metal/crypto/DXY. Tak ada pair eksotik.
  Angkat lagi HANYA bila menambah pair spt USD_SEK.

- **Cache stale-while-revalidate (`news.go`) — DEFER.** `newsCache.get` menahan mutex selama fetch
  (~≤20s) → request konkuren block. Tapi `calTTL=10 menit` → block hanya kena request yang datang
  persis di jendela refetch (~1×/10mnt); doc lama menandai "acceptable". Fix = sajikan stale seketika +
  refresh async (guard herd `refreshing`, cold-start tetap sinkron, perjelas flag `stale`, + scaffolding
  test goroutine). Angkat bila user beneran ramai.

## 🔲 BERIKUTNYA (bila dilanjut): Headline feed + notif on-chart

Fitur BARU, beda dari economic calendar. Contoh berita yang dimaksud user: artikel Reuters/Moneycontrol
tipe "Gold slips as oil jumps…" / "Gold may stay below record highs as stronger dollar bites, says HSBC".
TradingView menaruhnya di tab **News** (artikel) terpisah dari tab **Calendar**.

**Requirement dari user (2026-07-10):**
- Feed artikel berita pasar (judul + sumber + waktu + link "Keep reading").
- **Notif kartu on-chart** (ala TradingView: "News on [GOLD badge] · Moneycontrol — <judul> — Keep reading — jam — ✕"),
  muncul saat ada headline BARU yang **relevan dengan instrumen chart yang sedang dibuka** (buka XAU/USD →
  hanya berita gold/USD; auto-ganti relevansi saat pindah instrumen).

**Dekomposisi (3 bagian, tiap 1 spec, berurutan — saling bergantung):**
1. **Headline feed (fondasi):** proxy + cache di server, simpan API key, normalisasi →
   `{judul, sumber, waktu, url, simbol/entitas}`.
2. **Tab "News" di panel:** daftar headline (filter per-instrumen aktif) + "Keep reading" → buka artikel.
3. **Notif on-chart:** deteksi headline baru sejak terakhir dilihat → toast kartu, hanya instrumen aktif,
   dedupe/"new" detection, auto-ganti saat pindah instrumen. (Reuse sistem toast yg sudah ada / komponen khusus.)

**KEPUTUSAN TERBUKA — provider (blok kerjaan):**
Filter "relevan instrumen aktif" adalah jantung fitur → sangat bergantung tagging provider.
- **Marketaux ⭐ (rekomendasi)** — entity/simbol tag per artikel (tag XAU/gold/USD) → filter per-instrumen
  AKURAT tanpa nebak. Free ~100 req/hari (cukup krn di-cache server & fan-out). Butuh API key.
- **Finnhub** — free 60 req/menit (paling longgar), market news; tag simbol kurang rapi → perlu keyword-map.
- **RSS zero-key** (ForexLive/FXStreet/Investing) — konsisten dgn setup sekarang (kalender pun feed gratis),
  tapi tak ada sentiment/tag → keyword-map manual.
- Reuters/DowJones persis (spt di TradingView) = **berlisensi/berbayar** → tak dipakai; provider free = cerita setara.

**Langkah saat lanjut:** user pilih provider → brainstorming→spec bagian 1 (feed) → TDD/implement → lanjut 2 lalu 3.

## Fase-lanjut lain (deferred, spec sendiri)
- **Push notification/alert** rilis high-impact (tanpa buka panel).
- **Fallback BLS** — sumber cadangan resmi US (Bureau of Labor Statistics, API gratis) saat feed mirror
  Forex Factory (`nfs.faireconomy.media`) down/basi, atau cross-check nilai Actual.
- **AI summary/digest** — ringkasan naratif/berkala.

## Catatan
Spec/plan rinci di `docs/superpowers/` (`2026-07-08-news-*`, `2026-07-10-news-bias-non-usd-design.md`).
