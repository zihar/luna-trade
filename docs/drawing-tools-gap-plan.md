# Drawing tools — gap vs TradingView (backlog)

Analisis 2026-07-27. Membandingkan daftar tool resmi TradingView + tool yang *benar-benar*
sering dipakai trader, dengan inventaris Luna Trade (`DRAW_GROUPS`, `index.html:3636`;
spec test `tests/helpers/spec.js`).

Status: **belum dikerjakan** — ini backlog, satu item = satu PR kecil (aturan CLAUDE.md #1).

## Temuan riset (apa yang sebenarnya dipakai)

- Mayoritas trader hanya menyentuh segelintir dari 50+ tool TV: **trend line, horizontal
  line / zona S&R (rectangle), Fib retracement, catatan/teks, measure tool, long/short position**.
- Pembeda "cepat vs lambat" bukan jumlah tool, tapi *workflow feature*: **magnet mode,
  favorites bar, drawing templates**, plus alert dari objek gambar & object tree untuk
  merapikan chart.

Sumber:
- <https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/> (daftar resmi per kategori)
- <https://chartwisehub.com/tradingview-drawing-tools/> (tool prioritas + workflow)
- <https://www.financialtechwiz.com/post/how-to-draw-on-tradingview/> (magnet/templates/favorites)
- <https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/> (sync drawings)
- <https://tradethatswing.com/introduction-to-tradingview-charts-the-main-tools-i-use/> (trendline dominan)

## Sudah ada di Luna (baseline)

Trend: trendline, ray, extended, horizontal line, horizontal ray, vertical line, price line ·
Channels: parallel channel, price channel · Fib: retracement, fib line · Shapes: rect, circle,
ellipse, arrow, arrow mark up/down · Positions: long, short, date range · Text: text, callout.
Workflow: magnet, favorites bar melayang, hide-all, remove-all, eraser, modal Style|Text
per objek, persist per instrumen (`br_draws_<inst>`, `index.html:3323`).

---

## Tier 1 — dipakai harian, effort rendah–sedang

| # | Item | Kenapa | Catatan implementasi |
|---|------|--------|----------------------|
| T1.1 | ~~**Measure tool (ruler)**~~ — ✅ **SELESAI** 2026-07-31 | Masuk 5 tool wajib; di TV juga hotkey Shift+drag | `js/measure.js`: overlay ephemeral (kotak arah + pill Δharga/Δ%/Δpip/bar/durasi), grup rail "Measure" + `Alt+M`, dan `Shift`+drag. Tak masuk `PERSIST_DRAW`, tak mencemari undo. Spec: `docs/superpowers/specs/2026-07-31-measure-tool-design.md` |
| T1.2 | ~~**Keep drawing mode**~~ — ✅ **SELESAI** 2026-07-31 | Tool selalu `disarmIcons()` setelah objek jadi → gambar 5 zona = 5× klik rail | `keepDrawOn` + `rearmDraw()` (`js/draw-tools.js`) + tombol `#keepDrawBtn` (pensil+gembok, pola `magBtn`). Default mati, persist `br_keepdraw`. **Tanpa Ctrl-klik**: di TV modifier itu milik magnet sementara. Spec: `docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md` |
| T1.3 | **Lock objek / lock all** | Sekarang cuma Hide-all; objek gampang kegeser saat pan | klinecharts punya properti `lock` (sudah dipakai `alertLine`, `index.html:4652`) — tinggal ekspos ke UI + persist |
| T1.4 | **Alert dari objek gambar** | Sudah ada server price alerts + `alertLine`, tapi belum "alert dari H-line/trendline ini" | H-line trivial (harga sudah ada). Trendline butuh evaluasi harga-di-waktu di `alert_monitor.go` |
| T1.5 | **Duplicate / clone objek** | Ctrl+drag atau Ctrl+D; sering untuk zona berulang | FE-only: copy points + style, offset kecil. Sekalian isi item ROADMAP "context-menu lebih kaya" |
| T1.6 | **Trend-Based Fib Extension** | Fib kedua terpakai setelah retracement | Custom overlay 3 titik, pola sama dgn `fib3` |

## Tier 2 — sering diminta, effort sedang

- **Price Range** & **Date & Price Range** (saudara measure yang persist).
- **Anchored VWAP** — standar untuk anchor dari swing/news; nyambung dgn marker news yang sudah ada.
- **Object Tree / panel daftar objek** — hide, lock, rename, hapus per objek (0 hit di kode).
- **Drawing templates / default style per tool** — `DRAW_DEFAULT` (`index.html:738+`) masih
  hard-coded; user belum bisa simpan gaya sendiri.
- **Visibility per timeframe** — drawings tersimpan per instrumen dan muncul di semua TF;
  TV bisa batasi objek ke TF tertentu.
- **Sync antar device** — drawings masih localStorage; alerts sudah per-user di server.
  Bertemu dengan `docs/server-persistence-plan.md` (tabel `user_drawings`).
- **Pitchfork** (klasik/Schiff) & **Regression Trend** — kelas channel yang belum tersentuh.
- **Note/sticky, Price Label, Signpost, Icons/emoji** — anotasi baru text + callout.
- **Brush / Highlighter**, **Polyline/Path**, **Triangle** — freehand & poligon belum ada.
- **Magnet dua tingkat** — Luna hanya `strong_magnet` (`index.html:3290`); TV punya
  Weak/Strong + snap-to-indicator.

## Tier 3 — niche, tunda

Gann (box/fan/square) · Fib circles/arcs/fans/spiral/wedge · pola XABCD/ABCD/Head&Shoulders/
Elliott/Three Drives · Cyclic/Sine · Forecast · Bars Pattern · Ghost Feed · Fixed-range Volume
Profile · Image/X-post embed · cursor Demonstration/Magic.

## Bug diketahui (bukan gap fitur, tapi dicatat di sini juga supaya findable)

- **trendline "Add text" meluber pada garis pendek** — kembar dari bug rect yg baru
  ditutup (`zihar/zihar/fix/rect-addtext-small-box`, hanya utk `rect`): label ukuran tetap
  di titik tengah garis (`index.html:994-995`) tak digerbang ukuran sama sekali, dan
  `overPlaceholder` memberi hit-area ±55×±16 tanpa clamp ke panjang garis → garis pendek
  kehilangan endpoint handle-nya sendiri ke area "tambah teks". Sengaja di luar cakupan PR
  itu (lihat `docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md`, bagian
  "Di luar cakupan"); layak jadi PR kecil terpisah bila laporannya muncul.

## Urutan kerja yang disarankan

1. T1.1 Measure → T1.2 Keep drawing → T1.3 Lock → T1.5 Duplicate (semua FE-only, rasio nilai/effort tertinggi)
2. T1.4 Alert dari garis (butuh sentuh `alert_monitor.go`)
3. T1.6 Trend-Based Fib Extension + Anchored VWAP
4. Object Tree, lalu drawing templates & visibility per-TF

Tiap tool baru = satu baris di `tests/helpers/spec.js` (`TOOL_SPEC`) supaya ikut suite E2E;
baca `tests/README.md` dulu (4 jebakan canvas).
