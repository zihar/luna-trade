# News Marker Redesign (Badge + Multi-Currency) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merevisi marker event ekonomi on-chart dari tick jadi badge bulat (flag + severity bars, ring=impact, next=glow terpisah), perluas cakupan ke kedua mata uang pasangan instrumen (bias arah tetap USD-only), popup label-penuh, dan clip marker ke area plot.

**Architecture:** Backend menambah `RelevantCurrencies`/`FilterEvents`/`GroupReleasesByCurrency` (package `news`) dan `buildCalendarResponse` beralih dari USD-only ke per-instrumen multi-currency dengan bias hanya untuk event USD. Frontend merevisi kode marker Fase 2 di `index.html` (CSS `.nmk`/`.nmk-pop`, `renderNewsMarkers`, `repositionNewsMarkers`, `openNewsPop`) — layer, positioning, toggle, dan lifecycle popup dipakai ulang.

**Tech Stack:** Go std-lib (backend, TDD via `go test`), vanilla JS + klinecharts@9.8.10 + CSS (`index.html`, verifikasi browser).

## Global Constraints

- **Frontend satu file:** semua FE di `index.html`. Backend std-lib Go only.
- **Teks UI Inggris** (label/chip); komentar kode boleh Indonesia (ikut gaya file).
- **Anti-XSS:** semua field feed (currency/name/impact/forecast/previous/actual/time/bias) WAJIB `newsEsc(...)` sebelum `innerHTML`. `currencyFlag` hanya mengeluarkan regional-indicator dari 2 huruf `[A-Z]` (fallback aman string kosong).
- **Warna impact:** High = `var(--red)`, Medium = `#e0a63a`. Warna = impact SAJA.
- **Next-upcoming:** event `ts>Date.now()` terdekat (satu), ring `--luna-glow` + pulsa; pulsa mati pada `@media (prefers-reduced-motion:reduce)`. Bukan recolor.
- **Bias Lite:** bias arah HANYA untuk event USD (engine Fase 1 tak diubah); event non-USD verdict netral.
- **Clip:** batas kanan plot = `chart.getSize('candle_pane','main').width` (fallback `#chart.clientWidth`); marker `x<0` atau `x>plotWidth` → `display:none`.
- **Persist key:** `localStorage['br_newsMarkers']` (tak berubah).
- **Currency universe:** USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD (dari `config.go:84-89`).

**Menjalankan untuk verifikasi:** `go run .` (server `:8765`). Verifikasi FE oleh controller di browser (repo tak punya harness JS).

---

### Task 1: Backend — helper multi-currency (package news)

**Files:**
- Modify: `internal/news/calendar.go` (tambah `RelevantCurrencies`, `FilterEvents`, `containsFold`, `fiatCodes`)
- Modify: `internal/news/classify.go` (tambah `GroupReleasesByCurrency`)
- Test: `internal/news/calendar_test.go`, `internal/news/classify_test.go`

**Interfaces:**
- Produces:
  - `func RelevantCurrencies(symbol string) []string` — mata uang fiat relevan (kedua sisi pasangan; metal/sintetis di-drop; fallback `["USD"]`).
  - `func FilterEvents(events []Event, currencies []string, impacts ...string) []Event` — filter by Country ∈ currencies AND Impact ∈ impacts (case-insensitive).
  - `func GroupReleasesByCurrency(events []Event, nameOf func(string) string) []Release` — partisi per Country lalu `GroupReleases` tiap partisi (cegah merge indikator senama lintas negara).

- [ ] **Step 1: Tulis test yang gagal (`RelevantCurrencies` + `FilterEvents`)**

Tambah ke `internal/news/calendar_test.go`:

```go
func TestRelevantCurrencies(t *testing.T) {
	cases := map[string][]string{
		"EUR_USD": {"EUR", "USD"},
		"GBP_USD": {"GBP", "USD"},
		"USD_JPY": {"USD", "JPY"},
		"XAU_USD": {"USD"},
		"XAG_USD": {"USD"},
		"DXY":     {"USD"},
		"eur_usd": {"EUR", "USD"},
	}
	for sym, want := range cases {
		got := RelevantCurrencies(sym)
		if len(got) != len(want) {
			t.Fatalf("%s: want %v, got %v", sym, want, got)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: want %v, got %v", sym, want, got)
			}
		}
	}
}

func TestFilterEvents(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeedMixed)) // dari TestFilterUSDImpact (calendar_test.go)
	// sampleFeedMixed: USD/High(CPI), USD/Medium(ISM), EUR/Medium(GFO), USD/High(NFP)
	got := FilterEvents(ev, []string{"USD", "EUR"}, "High", "Medium")
	if len(got) != 4 {
		t.Fatalf("USD+EUR High+Medium: want 4, got %d", len(got))
	}
	onlyUSD := FilterEvents(ev, []string{"USD"}, "High")
	if len(onlyUSD) != 2 {
		t.Fatalf("USD High: want 2, got %d", len(onlyUSD))
	}
	for _, e := range FilterEvents(ev, []string{"EUR"}, "High", "Medium") {
		if e.Country != "EUR" {
			t.Fatalf("leaked non-EUR: %+v", e)
		}
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `go test ./internal/news/ -run 'TestRelevantCurrencies|TestFilterEvents' -v`
Expected: FAIL — `undefined: RelevantCurrencies` / `FilterEvents`.

- [ ] **Step 3: Implementasi helper di `calendar.go`**

Tambah di `internal/news/calendar.go` (mis. setelah `FilterUSDHighImpact`):

```go
// fiatCodes = mata uang yang punya kalender ekonomi di feed & dipakai instrumen Luna.
var fiatCodes = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "JPY": true,
	"CHF": true, "CAD": true, "AUD": true, "NZD": true,
}

// RelevantCurrencies mengembalikan mata uang fiat yang event-nya relevan untuk instrumen:
// kedua sisi pasangan FX (mis. "GBP_USD" → ["GBP","USD"]). Kode non-fiat (XAU/XAG/DXY dst)
// di-drop; bila tak ada yang cocok, fallback ["USD"].
func RelevantCurrencies(symbol string) []string {
	seen := map[string]bool{}
	var out []string
	for _, part := range strings.Split(strings.ToUpper(strings.TrimSpace(symbol)), "_") {
		if fiatCodes[part] && !seen[part] {
			seen[part] = true
			out = append(out, part)
		}
	}
	if len(out) == 0 {
		return []string{"USD"}
	}
	return out
}

// FilterEvents menyaring event yang Country-nya ada di currencies DAN Impact-nya salah satu
// di impacts (keduanya case-insensitive).
func FilterEvents(events []Event, currencies []string, impacts ...string) []Event {
	var out []Event
	for _, e := range events {
		if containsFold(currencies, e.Country) && containsFold(impacts, e.Impact) {
			out = append(out, e)
		}
	}
	return out
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Jalankan, pastikan hijau**

Run: `go test ./internal/news/ -run 'TestRelevantCurrencies|TestFilterEvents' -v`
Expected: PASS.

- [ ] **Step 5: Tulis test gagal untuk `GroupReleasesByCurrency`**

Tambah ke `internal/news/classify_test.go`:

```go
func TestGroupReleasesByCurrencyNoCrossMerge(t *testing.T) {
	name := func(title string) string {
		if n := DefaultName(title); n != "" {
			return n
		}
		return title
	}
	// US CPI & UK CPI: DefaultName keduanya "CPI" → TANPA partisi currency akan tergabung.
	ev := []Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High"},
		{Title: "CPI y/y", Country: "GBP", Impact: "High"},
	}
	rels := GroupReleasesByCurrency(ev, name)
	if len(rels) != 2 {
		t.Fatalf("want 2 releases (US CPI + UK CPI kept separate), got %d", len(rels))
	}
}
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `go test ./internal/news/ -run TestGroupReleasesByCurrency -v`
Expected: FAIL — `undefined: GroupReleasesByCurrency`.

- [ ] **Step 7: Implementasi `GroupReleasesByCurrency` di `classify.go`**

Tambah di `internal/news/classify.go` (setelah `GroupReleases`):

```go
// GroupReleasesByCurrency mempartisi event per Country lalu memanggil GroupReleases tiap
// partisi — mencegah indikator senama dari negara berbeda (mis. "CPI" US vs UK, yang
// DefaultName-nya sama) keliru tergabung. Urutan currency mengikuti kemunculan pertama.
func GroupReleasesByCurrency(events []Event, nameOf func(string) string) []Release {
	var order []string
	byCur := map[string][]Event{}
	for _, e := range events {
		c := strings.ToUpper(e.Country)
		if _, ok := byCur[c]; !ok {
			order = append(order, c)
		}
		byCur[c] = append(byCur[c], e)
	}
	var out []Release
	for _, c := range order {
		out = append(out, GroupReleases(byCur[c], nameOf)...)
	}
	return out
}
```

(Bila `strings` belum di-import di `classify.go`, tambahkan.)

- [ ] **Step 8: Jalankan seluruh test package news, pastikan hijau**

Run: `go test ./internal/news/ -v`
Expected: PASS semua (helper baru + test Fase 1/Fase 2 tetap hijau).

- [ ] **Step 9: Commit**

```bash
git add internal/news/calendar.go internal/news/classify.go internal/news/calendar_test.go internal/news/classify_test.go
git commit -m "feat(news): multi-currency helpers — RelevantCurrencies, FilterEvents, GroupReleasesByCurrency"
```

---

### Task 2: Backend — buildCalendarResponse per-instrumen (bias USD-only)

**Files:**
- Modify: `news.go:105` (filter+grouping) dan `news.go:110-152` (loop bias)
- Test: `news_test.go`

**Interfaces:**
- Consumes: `news.RelevantCurrencies`, `news.FilterEvents`, `news.GroupReleasesByCurrency` (Task 1).
- Produces: `buildCalendarResponse` kini menyertakan event untuk semua currency relevan instrumen; `verdict.bias` non-neutral hanya untuk release USD berarah, event non-USD → verdict netral.

- [ ] **Step 1: Tulis test gagal (multi-currency + bias Lite)**

Tambah ke `news_test.go`:

```go
func TestBuildCalendarMultiCurrency(t *testing.T) {
	now := time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC)
	events := []news.Event{
		// USD CPI rilis, surprise di atas → seharusnya berarah (non-neutral) utk GBP_USD
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(-2 * time.Hour), Forecast: "0.3%", Previous: "0.2%", Actual: "0.5%"},
		// UK CPI rilis → Lite: verdict netral (tak dihitung arah)
		{Title: "CPI y/y", Country: "GBP", Impact: "High", Time: now.Add(-time.Hour), Forecast: "3.1%", Previous: "3.0%", Actual: "3.4%"},
		// EUR event: TIDAK relevan utk GBP_USD → tak muncul
		{Title: "German Factory Orders", Country: "EUR", Impact: "Medium", Time: now.Add(-3 * time.Hour), Actual: "1.0%"},
	}
	resp := buildCalendarResponse(events, "GBP_USD", now, now, false)

	var sawUSD, sawGBP bool
	for _, it := range resp.Releases {
		if it.Currency == "EUR" {
			t.Fatalf("EUR event leaked into GBP_USD response")
		}
		if it.Currency == "USD" {
			sawUSD = true
			if it.Verdict.Bias == "neutral" {
				t.Fatalf("USD directional release should have non-neutral bias, got neutral")
			}
		}
		if it.Currency == "GBP" {
			sawGBP = true
			if it.Verdict.Bias != "neutral" {
				t.Fatalf("Lite: non-USD release must be neutral, got %q", it.Verdict.Bias)
			}
		}
	}
	if !sawUSD || !sawGBP {
		t.Fatalf("want both USD and GBP releases; sawUSD=%v sawGBP=%v (n=%d)", sawUSD, sawGBP, len(resp.Releases))
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `go test . -run TestBuildCalendarMultiCurrency -v`
Expected: FAIL — saat ini EUR ter-filter oleh USD-only? Tidak; saat ini filter USD-only jadi GBP tak muncul → `sawGBP` false → FAIL.

- [ ] **Step 3: Ganti filter + grouping di `buildCalendarResponse`**

Di `news.go`, ganti baris `releases := news.GroupReleases(news.FilterUSDImpact(events, "High", "Medium"), nameOf)` (≈`:105`) dengan:

```go
	currencies := news.RelevantCurrencies(instrument)
	releases := news.GroupReleasesByCurrency(news.FilterEvents(events, currencies, "High", "Medium"), nameOf)
```

Perbarui juga komentar di atasnya (≈`:94-98`) menjadi:

```go
	// Tampilkan event High+Medium untuk mata uang relevan instrumen (kedua sisi pasangan;
	// metal/DXY → USD saja). Bias ARAH hanya dihitung untuk event USD (engine Fase 1);
	// event non-USD tampil informasional (verdict netral). Panel News & marker berbagi ini.
```

- [ ] **Step 4: Gate bias hanya untuk USD di loop release**

Di `news.go`, ganti blok `if it.Released { ... }` (≈`:127-137`) menjadi:

```go
		if it.Released {
			if strings.EqualFold(it.Currency, "USD") {
				v := rel.Classify()
				bias := news.InstrumentBias(v.Lean, role)
				it.Verdict = calVerdict{
					Surprise: v.Surprise.String(),
					USDLean:  v.Lean.String(),
					Bias:     bias.String(),
					Label:    v.Label,
					Playbook: news.Playbook(v.Lean, role, bias, instrument),
					Tiebreak: v.Tiebreak,
				}
			} else {
				// Lite: event non-USD tampil tanpa arah.
				it.Verdict = calVerdict{Surprise: "unknown", USDLean: "neutral", Bias: "neutral", Label: "released"}
			}
		} else {
```

(Blok `else { it.Verdict = ... awaiting ... ; next detection }` tetap seperti sekarang.)

- [ ] **Step 5: Jalankan test baru + seluruh test, pastikan hijau**

Run: `go test ./... 2>&1 | tail -20`
Expected: PASS semua (`TestBuildCalendarMultiCurrency` + test Fase 1/Fase 2 tetap hijau — untuk instrumen USD-only seperti `XAU_USD` perilaku identik).

- [ ] **Step 6: Commit**

```bash
git add news.go news_test.go
git commit -m "feat(news): per-instrument multi-currency calendar (bias USD-only, Lite)"
```

---

### Task 3: Frontend — marker badge + clipping

**Files:**
- Modify: `index.html:699-713` (CSS `.nmk` → badge)
- Modify: `index.html:4429` area (tambah `currencyFlag`), `renderNewsMarkers` badge DOM (≈`:4442-4450`), `repositionNewsMarkers` clip (≈`:4460,4466`), `nudgeNewsMarkers` jarak (≈`:4477-4478`)

**Interfaces:**
- Consumes: `newsState.releases[]` (kini multi-currency; item punya `currency`,`impact`,`time`,dst), `nmkImpactClass`, `tsToPx`/`idxToPx`/`DUR`/`currentTF`/`revealed`, `chart.getSize`.
- Produces: `function currencyFlag(cur): string` (emoji regional-indicator, fallback aman `''`); `.nmk` menjadi badge (flag + `.nmk-sev` severity bars, ring=impact, `.is-next` glow ring). Positioning & lifecycle dipertahankan.

- [ ] **Step 1: Ganti CSS `.nmk` (badge)**

Ganti blok `index.html:699-713` (dari `#newsMarkers{...}` s/d `@media (prefers-reduced-motion:reduce){ .nmk.is-next{ animation:none; } }`) dengan:

```css
  #newsMarkers{ position:absolute; inset:0; z-index:6; pointer-events:none; overflow:hidden; }
  .nmk{ position:absolute; bottom:15px; width:22px; height:22px; border-radius:50%;
        transform:translateX(-50%); pointer-events:auto; cursor:pointer;
        display:grid; place-items:center; background:var(--panel-2); border:2px solid var(--muted);
        transition:transform .12s ease, box-shadow .18s ease; }
  .nmk:hover{ transform:translateX(-50%) scale(1.14); z-index:3; }
  .nmk .nmk-fl{ font-size:12px; line-height:1; }
  .nmk.impact-high{ border-color:var(--red); }
  .nmk.impact-medium{ border-color:#e0a63a; }
  .nmk-sev{ position:absolute; right:-3px; bottom:-3px; display:flex; gap:1px; align-items:flex-end;
        height:9px; padding:1px; border-radius:4px; background:var(--bg); }
  .nmk-sev i{ width:2px; border-radius:1px; background:currentColor; }
  .nmk-sev i:nth-child(1){ height:3px; } .nmk-sev i:nth-child(2){ height:5px; } .nmk-sev i:nth-child(3){ height:7px; }
  .nmk.impact-high .nmk-sev{ color:var(--red); } .nmk.impact-medium .nmk-sev{ color:#e0a63a; }
  .nmk.is-next{ box-shadow:0 0 0 2px var(--bg), 0 0 10px 2px rgba(174,185,232,.85); }
  .nmk.is-next::after{ content:""; position:absolute; inset:-4px; border-radius:50%;
        border:1.5px solid var(--luna-glow); animation:nmkPulse 2.4s ease-in-out infinite; }
  @keyframes nmkPulse{ 0%,100%{ opacity:.45; transform:scale(1); } 50%{ opacity:.95; transform:scale(1.14); } }
  @media (prefers-reduced-motion:reduce){ .nmk.is-next::after{ animation:none; opacity:.7; } }
```

- [ ] **Step 2: Tambah `currencyFlag` + build badge DOM**

Di `index.html`, tepat setelah `function nmkImpactClass(...)` (≈`:4429`) tambah:

```js
// currency feed (mis. "USD") → emoji flag via regional-indicator dari 2 huruf pertama
// ("USD"→"US"→🇺🇸). Di platform tanpa emoji-flag otomatis tampil huruf ("US") — fallback berguna.
// Hanya A-Z yang dipetakan (aman utk innerHTML); selain itu string kosong.
function currencyFlag(cur){
  const cc=String(cur||'').toUpperCase().slice(0,2);
  if(!/^[A-Z]{2}$/.test(cc)) return '';
  return cc.replace(/./g, c=>String.fromCodePoint(0x1F1E6 + c.charCodeAt(0)-65));
}
```

Lalu di `renderNewsMarkers`, ganti blok pembuatan elemen (≈`:4444-4449`):

```js
    const el=document.createElement('div');
    el.className='nmk '+nmkImpactClass(r.impact)+(i===nextIdx?' is-next':'');
    el.dataset.idx=i;
    el.title=(r.currency||'')+' '+(r.name||'');   // fallback native tooltip (popup penuh di Task 4)
    if(typeof bindNewsMarker==='function') bindNewsMarker(el);
    layer.appendChild(el);
```

menjadi:

```js
    const el=document.createElement('div');
    el.className='nmk '+nmkImpactClass(r.impact)+(i===nextIdx?' is-next':'');
    el.dataset.idx=i;
    el.title=(r.currency||'')+' '+(r.name||'');   // fallback native tooltip
    const sev=String(r.impact||'').toLowerCase()==='high'?3:2;
    el.innerHTML=`<span class="nmk-fl">${currencyFlag(r.currency)}</span>`
      +`<span class="nmk-sev">${'<i></i>'.repeat(sev)}</span>`;
    if(typeof bindNewsMarker==='function') bindNewsMarker(el);
    layer.appendChild(el);
```

- [ ] **Step 3: Clip ke area plot di `repositionNewsMarkers`**

Di `repositionNewsMarkers`, ganti baris `const W=$('#chart').clientWidth||0;` (≈`:4460`) menjadi:

```js
  let W=$('#chart').clientWidth||0;
  try{ const sz=chart.getSize('candle_pane','main'); if(sz&&sz.width) W=sz.width; }catch(e){}   // batas kanan = area plot (tanpa sumbu harga)
```

(Baris cek `if(x==null || x<0 || x>W)` tetap — kini `W` = lebar plot, jadi marker tak menimpa kolom price.)

- [ ] **Step 4: Sesuaikan jarak nudge untuk lebar badge**

Di `nudgeNewsMarkers`, ganti (≈`:4477-4478`):

```js
    if(vis[i].x - vis[i-1].x < 10){ vis[i].x=vis[i-1].x+10; vis[i].e.style.left=vis[i].x+'px'; }
```

menjadi:

```js
    if(vis[i].x - vis[i-1].x < 24){ vis[i].x=vis[i-1].x+24; vis[i].e.style.left=vis[i].x+'px'; }   // ≈ lebar badge
```

- [ ] **Step 5: Verifikasi browser — badge, clip, next-glow**

Run: `go run .` → login → muat chart. Amati:
- Instrumen FX pasangan (mis. **GBP/USD**): badge untuk **kedua** currency muncul (flag 🇬🇧 & 🇺🇸); ring merah=High, amber=Medium; severity bars 3 (High) vs 2 (Medium).
- Instrumen **XAU/USD**: hanya badge USD.
- Tepat satu badge **next** (glow `--luna-glow` + pulsa); emulasi `prefers-reduced-motion` → pulsa berhenti.
- **Clip:** badge tak pernah menimpa kolom sumbu harga; di luar plot → hilang; reposisi benar saat pan/zoom/ganti TF/resize.
- Tak ada error console (pasca-login).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(news): marker badges — flag + severity bars, impact ring, next glow, clip to plot"
```

---

### Task 4: Frontend — popup label-penuh

**Files:**
- Modify: `index.html:715-726` (CSS `.nmk-pop`)
- Modify: `index.html` `newsBiasLine` (≈`:4492-4495`) & `openNewsPop` innerHTML (≈`:4496-4513`)

**Interfaces:**
- Consumes: `currencyFlag` (Task 3), `nmkImpactClass`, `newsEsc`, `fmtLocal`, `biasArrow`, `newsCurrentInstrument`, `newsState.releases[+idx]`.
- Produces: popup kartu label-penuh (accent impact, header flag+nama+chip impact severity, tanggal, grid Actual/Forecast/Previous, baris bias hanya untuk event USD berarah).

- [ ] **Step 1: Ganti CSS `.nmk-pop`**

Ganti blok `index.html:715-726` (dari `.nmk-pop{...}` s/d `.nmk-pop .np-bias.bearish{...}`) dengan:

```css
  .nmk-pop{ position:absolute; z-index:20; width:248px; background:var(--panel);
     border:1px solid var(--border); border-radius:11px; box-shadow:var(--shadow);
     color:var(--txt); pointer-events:auto; transform:translateX(-50%); overflow:hidden; }
  .nmk-pop .np-acc{ height:4px; }
  .nmk-pop .np-acc.impact-high{ background:var(--red); } .nmk-pop .np-acc.impact-medium{ background:#e0a63a; }
  .nmk-pop .np-body{ padding:13px 15px; }
  .nmk-pop .np-hd{ display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .nmk-pop .np-fl{ font-size:15px; line-height:1; }
  .nmk-pop .np-nm{ font:600 14px 'Space Grotesk',Inter,sans-serif; flex:1; }
  .nmk-pop .np-chip{ font-size:9px; text-transform:uppercase; letter-spacing:.05em; padding:2px 7px;
     border-radius:20px; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
  .nmk-pop .np-chip.impact-high{ color:var(--red); background:rgba(255,111,111,.13); border:1px solid rgba(255,111,111,.4); }
  .nmk-pop .np-chip.impact-medium{ color:#e0a63a; background:rgba(224,166,58,.13); border:1px solid rgba(224,166,58,.4); }
  .nmk-pop .np-chip .nmk-sev{ position:static; background:none; padding:0; height:8px; }
  .nmk-pop .np-tm{ color:var(--muted); font:11px var(--mono,monospace); margin-bottom:11px; }
  .nmk-pop .np-grid{ display:grid; grid-template-columns:1fr auto; gap:6px 12px; font-size:13px; }
  .nmk-pop .np-grid .k{ color:var(--muted); } .nmk-pop .np-grid .v{ font-weight:600; text-align:right; }
  .nmk-pop .np-bias{ margin-top:11px; padding-top:10px; border-top:1px solid var(--border);
     font:600 13px 'Space Grotesk',Inter,sans-serif; }
  .nmk-pop .np-bias.bullish{ color:var(--green); } .nmk-pop .np-bias.bearish{ color:var(--red); }
```

- [ ] **Step 2: Perbarui `newsBiasLine` (sebut instrumen)**

Ganti `newsBiasLine` (≈`:4492-4495`):

```js
function newsBiasLine(v){
  if(!v || !v.bias || v.bias==='neutral') return '';
  return `<div class="np-bias ${newsEsc(v.bias)}">${biasArrow(v.bias)} ${newsEsc(v.bias.toUpperCase())}</div>`;
}
```

menjadi:

```js
function newsBiasLine(v){
  if(!v || !v.bias || v.bias==='neutral') return '';
  const inst=newsEsc((newsCurrentInstrument()||'').replace('_','/'));
  return `<div class="np-bias ${newsEsc(v.bias)}">${biasArrow(v.bias)} ${inst} ${newsEsc(v.bias.toUpperCase())}</div>`;
}
```

- [ ] **Step 3: Ganti innerHTML `openNewsPop` (kartu label-penuh)**

Di `openNewsPop`, ganti dari `const impCls=nmkImpactClass(r.impact);` sampai sebelum `pop.addEventListener('click', ...)` (≈`:4499-4507`) dengan:

```js
  const impCls=nmkImpactClass(r.impact);
  const sev='<i></i>'.repeat(String(r.impact||'').toLowerCase()==='high'?3:2);
  const rows=[['Actual', r.released?(r.actual||'—'):'—'],['Forecast', r.forecast||'—'],['Previous', r.previous||'—']];
  const grid=rows.map(([k,v])=>`<span class="k">${k}</span><span class="v">${newsEsc(v)}</span>`).join('');
  const pop=document.createElement('div'); pop.className='nmk-pop'; pop._for=el;
  pop.innerHTML=`<div class="np-acc ${impCls}"></div><div class="np-body">
      <div class="np-hd"><span class="np-fl">${currencyFlag(r.currency)}</span>
        <span class="np-nm">${newsEsc(r.currency)} ${newsEsc(r.name)}</span>
        <span class="np-chip ${impCls}"><span class="nmk-sev">${sev}</span>${newsEsc(r.impact)}</span></div>
      <div class="np-tm">${newsEsc(fmtLocal(r.time))}</div>
      <div class="np-grid">${grid}</div>
      ${r.released?newsBiasLine(r.verdict):''}</div>`;
```

(Baris berikutnya — `pop.addEventListener('click', ...)`, `mouseenter`, `mouseleave`, `appendChild`, `positionNewsPop()` — TETAP tak berubah. `pop` sudah dibuat di blok ini, jadi hapus deklarasi `const pop=...` lama yang duplikat bila ada — pastikan hanya satu.)

- [ ] **Step 4: Verifikasi browser — popup**

Run: `go run .` → login. 
- Klik/hover badge → kartu: accent bar warna impact; header flag + `CURRENCY Name` + chip impact (severity bars + HIGH/MEDIUM); tanggal-waktu; grid **Actual / Forecast / Previous** label penuh.
- Event **USD** berarah (mis. CPI rilis) → baris **bias** (`▲/▼ INSTRUMENT BULLISH/BEARISH`, warna hijau/merah).
- Event **non-USD** (mis. UK di GBP/USD) → **tanpa** baris bias.
- Popup di atas badge, ter-clamp di tepi, satu popup; hover mouse & tap (emulasi mobile) benar; klik di dalam popup tak menutup; ganti instrumen → popup lama tutup, marker/bias ikut instrumen baru.
- Tak ada error console.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(news): full-label marker popup (flag, impact chip, A/F/P grid, USD bias line)"
```

---

## Catatan verifikasi akhir (setelah semua task)

- `go test ./...` hijau.
- Browser end-to-end: GBP/USD menampilkan badge GBP+USD (flag benar, severity bars, ring impact); XAU/USD hanya USD; next-glow satu & pulsa; reduced-motion tanpa pulsa; badge tak menimpa kolom price & reposisi benar (pan/zoom/TF/resize); popup label-penuh dengan bias hanya untuk USD; toggle off → hilang & persist; ganti instrumen → set marker & bias ikut.
