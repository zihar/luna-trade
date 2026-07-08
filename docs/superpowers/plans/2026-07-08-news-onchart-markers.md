# News On-Chart Event Markers (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menampilkan event ekonomi USD (High + Medium) sebagai tick di sumbu waktu chart, tersinkron pan/zoom/TF, dengan glow `--luna-glow` untuk event mendatang terdekat + popup detail.

**Architecture:** Backend memperluas filter kalender ke High+Medium (helper generik `FilterUSDImpact`). Frontend memisah fetch (`refreshNewsData`) dari render sehingga marker tampil walau panel News tertutup; marker adalah layer DOM `#newsMarkers` di atas canvas yang diposisikan via `convertToPixel` dan di-reposisi pada pan/zoom/TF/resize (meniru pola `price-timer`/`.pick-cut`). Popup detail muncul saat hover (desktop) / tap (mobile). Toggle "On chart" di header panel News, persist localStorage.

**Tech Stack:** Go std-lib (backend), vanilla JS + klinecharts + CSS di `index.html` (frontend). Backend TDD via `go test`. Frontend diverifikasi di browser (repo tak punya harness test JS).

## Global Constraints

- **Teks UI berbahasa Inggris** — semua label/tombol/chip yang tampil ke user (mis. "On chart", "impact") English. Komentar kode boleh Indonesia (ikut gaya file).
- **Anti-XSS:** semua field dari feed kalender pihak ketiga (name/currency/impact/forecast/previous/actual/bias) WAJIB dilewatkan `newsEsc(...)` sebelum masuk `innerHTML`.
- **Filter tunggal:** panel News & marker berbagi data yang sama (`GET /api/news/calendar` → `newsState`). Tidak ada fetch/parse kedua.
- **Warna impact:** High = `var(--red)`, Medium = amber `#e0a63a` (senada `.impact-Medium` yang sudah ada).
- **Signature glow:** event mendatang terdekat pakai `--luna-glow`; pulsa dimatikan pada `@media (prefers-reduced-motion:reduce)`.
- **Hanya chart primer** (`chart` global). `secondaries` (read-only) dilewati.
- **Persist key:** `localStorage['br_newsMarkers']` (`'1'` = on default, `'0'` = off).
- **Non-goals (YAGNI):** marker non-USD, clustering canggih, drag marker, edge-chip, `setOffsetRightDistance`.

**Cara menjalankan app untuk verifikasi browser:** `go run .` (server di `http://localhost:8765`, meng-serve `index.html`). Endpoint `/api/news/calendar` memakai feed publik Forex Factory (tanpa key), jadi News jalan tanpa kredensial OANDA.

---

### Task 1: Backend — filter USD High+Medium

**Files:**
- Modify: `internal/news/calendar.go:110-119` (tambah `FilterUSDImpact`, refactor `FilterUSDHighImpact`)
- Modify: `news.go:104` (pakai filter High+Medium di `buildCalendarResponse`)
- Test: `internal/news/calendar_test.go` (tambah test `FilterUSDImpact`)
- Test: `news_test.go` (verifikasi event Medium USD ikut masuk response)

**Interfaces:**
- Consumes: `Event{Country, Impact string}` (sudah ada, `calendar.go:23`).
- Produces: `func FilterUSDImpact(events []Event, impacts ...string) []Event` — filter event USD dengan salah satu impact yang diminta (case-insensitive). `buildCalendarResponse` kini menyertakan event USD Medium (bukan hanya High) di `Releases`.

- [ ] **Step 1: Tulis test yang gagal untuk `FilterUSDImpact`**

Tambah ke `internal/news/calendar_test.go` (perluas `sampleFeed` dengan satu event USD Medium + satu Medium non-USD, lalu test):

```go
const sampleFeedMixed = `[
  {"title":"CPI m/m","country":"USD","date":"2026-07-10T12:30:00+00:00","impact":"High","forecast":"0.3%","previous":"0.2%","actual":"0.4%"},
  {"title":"ISM Services PMI","country":"USD","date":"2026-07-08T14:00:00+00:00","impact":"Medium","forecast":"53.1","previous":"52.8","actual":""},
  {"title":"German Factory Orders m/m","country":"EUR","date":"2026-07-06T06:00:00+00:00","impact":"Medium","forecast":"1.1%","previous":"-3.8%","actual":""},
  {"title":"Non-Farm Employment Change","country":"USD","date":"2026-07-11T12:30:00+00:00","impact":"High","forecast":"180K","previous":"200K","actual":""}
]`

func TestFilterUSDImpact(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeedMixed))

	high := FilterUSDImpact(ev, "High")
	if len(high) != 2 {
		t.Fatalf("High-only: want 2, got %d", len(high))
	}

	both := FilterUSDImpact(ev, "High", "Medium")
	if len(both) != 3 {
		t.Fatalf("High+Medium: want 3 USD events, got %d", len(both))
	}
	for _, e := range both {
		if e.Country != "USD" {
			t.Fatalf("filter leaked non-USD: %+v", e)
		}
		if e.Impact != "High" && e.Impact != "Medium" {
			t.Fatalf("filter leaked impact %q", e.Impact)
		}
	}
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `go test ./internal/news/ -run TestFilterUSDImpact -v`
Expected: FAIL — `undefined: FilterUSDImpact`.

- [ ] **Step 3: Implementasi `FilterUSDImpact` + refactor `FilterUSDHighImpact`**

Ganti `internal/news/calendar.go:110-119` dengan:

```go
// FilterUSDImpact menyaring event USD dengan salah satu impact yang diminta
// (case-insensitive). Contoh: FilterUSDImpact(ev, "High", "Medium").
func FilterUSDImpact(events []Event, impacts ...string) []Event {
	var out []Event
	for _, e := range events {
		if !strings.EqualFold(e.Country, "USD") {
			continue
		}
		for _, imp := range impacts {
			if strings.EqualFold(e.Impact, imp) {
				out = append(out, e)
				break
			}
		}
	}
	return out
}

// FilterUSDHighImpact menyaring event USD ber-impact High (case-insensitive).
func FilterUSDHighImpact(events []Event) []Event {
	return FilterUSDImpact(events, "High")
}
```

- [ ] **Step 4: Jalankan test filter + test lama, pastikan hijau**

Run: `go test ./internal/news/ -v`
Expected: PASS semua (termasuk `TestFilterUSDHighImpact` lama & `TestFilterUSDImpact` baru).

- [ ] **Step 5: Tulis test yang gagal — response menyertakan event Medium USD**

Tambah ke `news_test.go` (lihat `sampleEvents` yang sudah ada di file itu untuk pola; tambahkan satu event USD Medium di sana bila belum ada, lalu):

```go
func TestBuildCalendarIncludesMedium(t *testing.T) {
	now := time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC)
	events := []news.Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(48 * time.Hour), Forecast: "0.3%", Previous: "0.2%"},
		{Title: "ISM Services PMI", Country: "USD", Impact: "Medium", Time: now.Add(2 * time.Hour), Forecast: "53.1", Previous: "52.8"},
		{Title: "German Factory Orders", Country: "EUR", Impact: "Medium", Time: now.Add(time.Hour)},
	}
	resp := buildCalendarResponse(events, "XAU_USD", now, now, false)

	var sawMedium bool
	for _, it := range resp.Releases {
		if it.Currency != "USD" {
			t.Fatalf("non-USD leaked into releases: %+v", it)
		}
		if it.Impact == "Medium" {
			sawMedium = true
		}
	}
	if !sawMedium {
		t.Fatalf("expected a Medium USD release in response, got %d releases", len(resp.Releases))
	}
}
```

- [ ] **Step 6: Jalankan test, pastikan gagal**

Run: `go test . -run TestBuildCalendarIncludesMedium -v`
Expected: FAIL — belum ada event Medium di releases (`buildCalendarResponse` masih High-only).

- [ ] **Step 7: Wire filter High+Medium ke `buildCalendarResponse`**

Ganti `news.go:104`:

```go
	releases := news.GroupReleases(news.FilterUSDHighImpact(events), nameOf)
```

menjadi:

```go
	releases := news.GroupReleases(news.FilterUSDImpact(events, "High", "Medium"), nameOf)
```

- [ ] **Step 8: Jalankan seluruh test backend, pastikan hijau**

Run: `go test ./... 2>&1 | tail -20`
Expected: PASS semua paket (test Fase 1 tetap hijau, dua test baru hijau).

- [ ] **Step 9: Commit**

```bash
git add internal/news/calendar.go internal/news/calendar_test.go news.go news_test.go
git commit -m "feat(news): expand calendar filter to USD High+Medium (FilterUSDImpact)"
```

---

### Task 2: Frontend — pisah fetch dari render + poll always-on

**Files:**
- Modify: `index.html:4351-4362` (tambah state `newsState`, `newsMarkersEnabled`, rename fetch → `refreshNewsData`, `loadNews` jadi thin wrapper)
- Modify: `index.html:4224-4237` (`initPriceTimer` — mulai poll always-on + subscribeAction reposisi)
- Modify: `index.html:4433-4436` & `:4446` (`setNewsOpen` — hentikan poll data ganda, biarkan hanya countdown)
- Modify: `index.html:3975` (`selectSymbol` — refresh news tanpa gate panel, agar marker/bias ikut ganti instrumen walau panel tertutup)

**Interfaces:**
- Consumes: `newsCurrentInstrument()` (`:4351`), `renderNews(d)` (`:4370`), `chart.subscribeAction` (`:4234`).
- Produces:
  - `let newsState = null` — respons `/api/news/calendar` last-good (dipakai panel & marker).
  - `function newsMarkersEnabled(): boolean` — baca `localStorage['br_newsMarkers']!=='0'` (default true).
  - `function refreshNewsData(): void` — fetch → set `newsState` → `renderNews` (bila panel terbuka) → `renderNewsMarkers` (bila ada & enabled).
  - `function loadNews(): void` — alias `refreshNewsData()` (kompat pemanggil lama).

- [ ] **Step 1: Tambah state + refactor fetch**

Ganti `index.html:4352-4362` (dari `let _newsTimer=null,...` s/d penutup `loadNews`) dengan:

```js
let _newsTimer=null, _newsCountdown=null;
let newsState=null;   // respons /api/news/calendar last-good — dibagi panel & marker on-chart
// Toggle marker on-chart (Fase 2). Default ON. '0' = off.
function newsMarkersEnabled(){ return localStorage.getItem('br_newsMarkers')!=='0'; }
// Fetch kalender utk instrumen aktif → simpan ke newsState → render panel (bila terbuka)
// & marker on-chart (bila enabled). Dipanggil saat chart ready, ganti instrumen, poll 60s.
function refreshNewsData(){
  const reqInst=newsCurrentInstrument();
  fetch('/api/news/calendar?instrument='+encodeURIComponent(reqInst))
    .then(r=>{ if(!r.ok) throw new Error('http'); return r.json(); })
    .then(d=>{ newsState=d;
      if(!$('#newspanel').classList.contains('hidden')) renderNews(d);
      if(newsMarkersEnabled() && typeof renderNewsMarkers==='function') renderNewsMarkers();
    })
    .catch(()=>{
      // Panel terbuka → tampilkan error Fase 1. Marker: pertahankan last-good (jangan hapus).
      if(!$('#newspanel').classList.contains('hidden')){
        const body=$('#newsBody');
        body.innerHTML='<div class="news-empty">News feed unavailable.'
          +' <button id="newsRetry" class="wl-x">Retry</button></div>';
        const b=$('#newsRetry'); if(b) b.onclick=refreshNewsData;
      }
    });
}
function loadNews(){ refreshNewsData(); }   // kompat: pemanggil lama (selectSymbol, setNewsOpen)
```

- [ ] **Step 2: Mulai poll always-on + reposisi di `initPriceTimer`**

Di `index.html`, sisipkan sebelum `updatePriceTimer();` penutup `initPriceTimer` (`:4236`):

```js
  // News: fetch data saat chart ready + poll 60s (marker tampil walau panel tertutup).
  try{ refreshNewsData(); }catch(e){}
  clearInterval(_newsTimer); _newsTimer=setInterval(()=>{ try{ refreshNewsData(); }catch(e){} }, 60000);
  // Reposisi marker saat pan/zoom (reposition & popup didefinisikan di Task 3/4; try/catch aman bila belum ada).
  try{ chart.subscribeAction('onScroll', ()=>{ try{ repositionNewsMarkers(); }catch(e){} }); }catch(e){}
  try{ chart.subscribeAction('onZoom',   ()=>{ try{ repositionNewsMarkers(); }catch(e){} }); }catch(e){}
```

- [ ] **Step 3: Hentikan poll data ganda di `setNewsOpen`**

Di `index.html:4433-4436` (cabang `if(open)`), ganti blok:

```js
    if(typeof loadNews==='function') loadNews();   // didefinisikan di Task 7
    clearInterval(_newsTimer); _newsTimer=setInterval(loadNews, 60000);          // refresh data tiap 60s
    clearInterval(_newsCountdown); _newsCountdown=setInterval(tickNewsCountdown, 1000);   // countdown tiap detik
```

menjadi (poll data kini always-on di initPriceTimer; buka panel cukup fetch sekali + countdown per-detik):

```js
    if(typeof loadNews==='function') loadNews();                                 // fresh saat buka
    clearInterval(_newsCountdown); _newsCountdown=setInterval(tickNewsCountdown, 1000);   // countdown tiap detik
```

Lalu di cabang `else` (`:4446`), hapus baris yang menghentikan `_newsTimer` (poll data harus tetap jalan walau panel ditutup):

```js
    clearInterval(_newsTimer); _newsTimer=null;
    clearInterval(_newsCountdown); _newsCountdown=null;
```

menjadi:

```js
    clearInterval(_newsCountdown); _newsCountdown=null;
```

- [ ] **Step 4: Lepas gate panel di `selectSymbol`**

Ganti `index.html:3975`:

```js
  if(!$('#newspanel').classList.contains('hidden') && typeof loadNews==='function') loadNews();   // instrumen aktif berubah → sync bias card News (Task 7)
```

menjadi (refresh selalu → marker/bias ikut instrumen walau panel tertutup; `refreshNewsData` hanya render panel bila terbuka):

```js
  if(typeof refreshNewsData==='function') refreshNewsData();   // instrumen berubah → sync bias card + marker (walau panel tertutup)
```

- [ ] **Step 5: Verifikasi browser — refactor tak mengubah perilaku panel + data fetched saat tertutup**

Run: `go run .` lalu buka `http://localhost:8765`. Di DevTools console:
- Muat halaman TANPA membuka News. Tunggu ~1 dtk → ketik `newsState` → Expected: objek berisi `releases` (bukti fetch jalan walau panel tertutup).
- Buka News (tombol News) → panel render bias card + kalender seperti sebelumnya (kini termasuk event Medium USD → dot amber).
- Ganti instrumen (mis. XAU→EUR/USD) → bias card ikut berubah.
- Tutup News, tunggu >60 dtk → Network tab menunjukkan `/api/news/calendar` tetap dipoll (tak berhenti).
Expected: semua lolos; tak ada error console.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(news): split fetch from render (newsState) + always-on 60s poll"
```

---

### Task 3: Frontend — layer marker, rendering & positioning

**Files:**
- Modify: `index.html` (CSS, dekat blok News `~:694`) — style `#newsMarkers` + `.nmk`
- Modify: `index.html` (JS, tepat sesudah `loadNews` `~:4362`) — `ensureNewsLayer`, `renderNewsMarkers`, `repositionNewsMarkers`, `nudgeNewsMarkers`
- Modify: `index.html:2000` (ResizeObserver — tambah reposisi)
- Modify: `index.html:2296` (`render()` — tambah reposisi di akhir)

**Interfaces:**
- Consumes: `newsState.releases[]` (tiap item: `{name,time,currency,impact,released,forecast,previous,actual,verdict}`), `revealed(currentTF)`, `DUR`, `currentTF`, `tsToPx` (`:1467`), `idxToPx` (`:1466`), `newsMarkersEnabled()` (Task 2).
- Produces:
  - `function ensureNewsLayer(): HTMLElement` — buat/return `<div id="newsMarkers">` sekali.
  - `function renderNewsMarkers(): void` — rebuild `.nmk` tick per event; tandai `.is-next` (event mendatang terdekat wall-clock); panggil `repositionNewsMarkers()`.
  - `function repositionNewsMarkers(): void` — set `left` px tiap tick; `display:none` bila di luar plot.
  - `let _newsLayer` (module-level, dipakai Task 4).
  - `function nmkImpactClass(imp): string` — `'impact-high'` / `'impact-medium'`.
  - Hook: `bindNewsMarker(el)` dipanggil per-tick bila tersedia (didefinisikan Task 4).

- [ ] **Step 1: Tambah CSS marker**

Sisipkan di `index.html` setelah baris `.cal-item.released{...}` (`~:693`):

```css
  /* News on-chart markers (Fase 2) — tick di sumbu waktu; glow --luna-glow utk event terdekat */
  #newsMarkers{ position:absolute; inset:0; z-index:6; pointer-events:none; overflow:hidden; }
  .nmk{ position:absolute; bottom:24px; width:2px; height:14px; border-radius:2px;
        transform:translateX(-50%); pointer-events:auto; cursor:pointer;
        transition:height .12s ease, box-shadow .18s ease; }
  .nmk::after{ content:""; position:absolute; top:-3px; left:50%; transform:translateX(-50%);
        width:6px; height:6px; border-radius:50%; background:inherit; }
  .nmk.impact-high{ background:var(--red); }
  .nmk.impact-medium{ background:#e0a63a; }
  .nmk:hover{ height:18px; }
  .nmk.is-next{ background:var(--luna-glow); box-shadow:0 0 8px 1px rgba(174,185,232,.85);
        animation:nmkPulse 2.4s ease-in-out infinite; }
  .nmk.is-next::after{ background:var(--luna-glow); }
  @keyframes nmkPulse{ 0%,100%{ box-shadow:0 0 6px 0 rgba(174,185,232,.5); }
                       50%{ box-shadow:0 0 12px 2px rgba(174,185,232,.95); } }
  @media (prefers-reduced-motion:reduce){ .nmk.is-next{ animation:none; } }
```

- [ ] **Step 2: Tambah JS rendering + positioning**

Sisipkan di `index.html` tepat setelah `function loadNews(){ refreshNewsData(); }` (`~:4362`):

```js
// ---- News on-chart markers (Fase 2): layer DOM tersinkron pan/zoom ----
let _newsLayer=null;
function ensureNewsLayer(){
  if(_newsLayer) return _newsLayer;
  _newsLayer=document.createElement('div'); _newsLayer.id='newsMarkers';
  $('#chart').appendChild(_newsLayer);
  return _newsLayer;
}
// impact feed → kelas warna tick (hanya High/Medium yg dikirim backend; fallback medium).
function nmkImpactClass(imp){ return String(imp||'').toLowerCase()==='high' ? 'impact-high' : 'impact-medium'; }
// Rebuild seluruh tick dari newsState.releases. Event mendatang terdekat (wall-clock now)
// dapat kelas .is-next (glow). Timestamp rusak → di-skip (defensif).
function renderNewsMarkers(){
  const layer=ensureNewsLayer();
  if(!newsMarkersEnabled()){ layer.style.display='none'; layer.innerHTML=''; return; }
  layer.style.display='';
  const rels=(newsState&&newsState.releases)||[];
  const now=Date.now();
  let nextIdx=-1, nextT=Infinity;
  rels.forEach((r,i)=>{ const t=Date.parse(r.time); if(!isNaN(t)&&t>now&&t<nextT){ nextT=t; nextIdx=i; } });
  layer.innerHTML='';
  rels.forEach((r,i)=>{
    if(isNaN(Date.parse(r.time))) return;   // timestamp rusak → skip
    const el=document.createElement('div');
    el.className='nmk '+nmkImpactClass(r.impact)+(i===nextIdx?' is-next':'');
    el.dataset.idx=i;
    el.title=(r.currency||'')+' '+(r.name||'');   // fallback native tooltip (popup penuh di Task 4)
    if(typeof bindNewsMarker==='function') bindNewsMarker(el);
    layer.appendChild(el);
  });
  repositionNewsMarkers();
}
// Set posisi X tiap tick: event lampau (ts<=lastTs) → tsToPx; mendatang → idxToPx via
// dataIndex terproyeksi (pola reanchorFuturePoints). Di luar plot → display:none.
function repositionNewsMarkers(){
  const layer=_newsLayer; if(!layer || layer.style.display==='none') return;
  const a=(typeof revealed==='function')?revealed(currentTF):null;
  if(!a||!a.length) return;
  const li=a.length-1, lt=a[li].timestamp, dur=DUR[currentTF];
  const W=$('#chart').clientWidth||0;
  const rels=(newsState&&newsState.releases)||[];
  layer.querySelectorAll('.nmk').forEach(el=>{
    const r=rels[+el.dataset.idx]; const t=r?Date.parse(r.time):NaN;
    if(!r||isNaN(t)){ el.style.display='none'; return; }
    let x = t<=lt ? tsToPx(t) : idxToPx(li+(t-lt)/dur);
    if(x==null || x<0 || x>W){ el.style.display='none'; return; }
    el.style.display=''; el.style.left=x+'px';
  });
  nudgeNewsMarkers();
  if(typeof repositionNewsPop==='function') repositionNewsPop();   // ikutkan popup terbuka (Task 4)
}
// Dua tick berdekatan (<10px) → geser kecil ke kanan agar keduanya bisa di-hover.
function nudgeNewsMarkers(){
  const layer=_newsLayer; if(!layer) return;
  const vis=[...layer.querySelectorAll('.nmk')].filter(e=>e.style.display!=='none')
    .map(e=>({e,x:parseFloat(e.style.left)||0})).sort((p,q)=>p.x-q.x);
  for(let i=1;i<vis.length;i++){
    if(vis[i].x - vis[i-1].x < 10){ vis[i].x=vis[i-1].x+10; vis[i].e.style.left=vis[i].x+'px'; }
  }
}
```

- [ ] **Step 3: Reposisi saat resize & tiap render**

Di `index.html:2000`, ganti:

```js
new ResizeObserver(()=>{ chart.resize(); try{updatePriceTimer();}catch(e){} }).observe($('#chart'));
```

menjadi:

```js
new ResizeObserver(()=>{ chart.resize(); try{updatePriceTimer();}catch(e){} try{repositionNewsMarkers();}catch(e){} }).observe($('#chart'));
```

Di `index.html:2296`, sesudah `updatePriceTimer();` (baris terakhir `render()`), tambah:

```js
  try{ repositionNewsMarkers(); }catch(e){}   // marker ikut pan/zoom/TF/playback
```

- [ ] **Step 4: Verifikasi browser — tick tampil & tersinkron**

Run: `go run .` → `http://localhost:8765`. Load data chart (instrumen USD, mis. XAU_USD, TF M15). Amati:
- Tick ramping muncul di atas sumbu waktu: event lampau di atas bar historisnya, event mendatang di area kanan (posisi X sesuai waktu).
- Warna: High = merah (`--red`), Medium = amber.
- Event mendatang terdekat menyala (glow biru `--luna-glow`, berpulsa).
- Pan & zoom chart → tick ikut bergeser dan tetap sejajar waktunya; tick di luar area chart hilang.
- Ganti TF (M15↔H1) → tick reposisi benar.
- Aktifkan `prefers-reduced-motion` (DevTools → Rendering → Emulate CSS prefers-reduced-motion: reduce) → glow tetap, pulsa berhenti.
Expected: semua lolos; tak ada error console.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(news): on-chart event markers — tick layer synced to pan/zoom/TF + next-glow"
```

---

### Task 4: Frontend — popup detail + interaksi hover/tap

**Files:**
- Modify: `index.html` (CSS, sesudah blok `.nmk` `~:707`) — style `.nmk-pop`
- Modify: `index.html` (JS, sesudah `nudgeNewsMarkers` `~:4362+`) — `bindNewsMarker`, `openNewsPop`, `closeNewsPop`, `positionNewsPop`, `repositionNewsPop`, `newsBiasLine`
- Modify: `index.html` di `ensureNewsLayer` — pasang listener klik-luar sekali

**Interfaces:**
- Consumes: `newsState.releases[]`, `newsEsc` (`:4369`), `fmtLocal` (`:4363`), `biasArrow` (`:4365`), `.nmk` tick dari Task 3 (`el.dataset.idx`, `el.style.left`).
- Produces:
  - `function bindNewsMarker(el): void` — pasang hover (desktop) + click/tap (toggle) → popup.
  - `function openNewsPop(el): void` / `closeNewsPop(): void` — satu popup pada satu waktu.
  - `function repositionNewsPop(): void` — reposisi popup terbuka (dipanggil dari `repositionNewsMarkers`).
  - `function newsBiasLine(v): string` — baris bias (arah + warna) bila `v.bias` non-neutral; else `''`.

- [ ] **Step 1: Tambah CSS popup**

Sisipkan di `index.html` setelah blok `@media (prefers-reduced-motion:reduce){ .nmk.is-next... }` (Task 3):

```css
  .nmk-pop{ position:absolute; z-index:20; min-width:168px; max-width:232px;
     background:var(--panel); border:1px solid var(--border); border-radius:8px;
     box-shadow:var(--shadow); padding:9px 11px; font-size:12px; color:var(--txt);
     pointer-events:auto; transform:translateX(-50%); }
  .nmk-pop .np-hd{ display:flex; justify-content:space-between; gap:8px; align-items:baseline; margin-bottom:4px; }
  .nmk-pop .np-nm{ font-weight:600; }
  .nmk-pop .np-tm{ color:var(--muted); font:11px var(--mono,monospace); white-space:nowrap; }
  .nmk-pop .np-imp{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .nmk-pop .np-imp.impact-high{ color:var(--red); } .nmk-pop .np-imp.impact-medium{ color:#e0a63a; }
  .nmk-pop .np-fig{ color:var(--muted); } .nmk-pop .np-fig b{ color:var(--txt); }
  .nmk-pop .np-bias{ margin-top:6px; font-weight:600; font-family:'Space Grotesk',sans-serif; }
  .nmk-pop .np-bias.bullish{ color:var(--green); } .nmk-pop .np-bias.bearish{ color:var(--red); }
```

- [ ] **Step 2: Tambah JS popup + interaksi**

Sisipkan di `index.html` setelah `nudgeNewsMarkers` (`~:4362+`, sebelum `function fmtLocal`):

```js
// ---- News marker popup (hover desktop / tap mobile) ----
let _newsPop=null, _newsPopHideT=null;
function bindNewsMarker(el){
  el.addEventListener('mouseenter', ()=>{ clearTimeout(_newsPopHideT); openNewsPop(el); });
  el.addEventListener('mouseleave', ()=>{ _newsPopHideT=setTimeout(closeNewsPop, 180); });
  el.addEventListener('click', (e)=>{ e.stopPropagation();
    if(_newsPop && _newsPop._for===el){ closeNewsPop(); } else { openNewsPop(el); } });
}
// Baris bias arah utk instrumen aktif — hanya bila event menghasilkan arah (non-neutral).
function newsBiasLine(v){
  if(!v || !v.bias || v.bias==='neutral') return '';
  return `<div class="np-bias ${newsEsc(v.bias)}">${biasArrow(v.bias)} ${newsEsc(v.bias.toUpperCase())}</div>`;
}
function openNewsPop(el){
  const r=((newsState&&newsState.releases)||[])[+el.dataset.idx]; if(!r) return;
  closeNewsPop();
  const impCls=nmkImpactClass(r.impact);
  const fig=`F: <b>${newsEsc(r.forecast||'—')}</b> · P: ${newsEsc(r.previous||'—')}`
    + (r.released?` · A: <b>${newsEsc(r.actual||'—')}</b>`:'');
  const pop=document.createElement('div'); pop.className='nmk-pop'; pop._for=el;
  pop.innerHTML=`<div class="np-hd"><span class="np-nm">${newsEsc(r.currency)} ${newsEsc(r.name)}</span>
      <span class="np-tm">${newsEsc(fmtLocal(r.time))}</span></div>
    <div class="np-imp ${impCls}">${newsEsc(r.impact)} impact</div>
    <div class="np-fig">${fig}</div>
    ${r.released?newsBiasLine(r.verdict):''}`;
  pop.addEventListener('mouseenter', ()=>clearTimeout(_newsPopHideT));
  pop.addEventListener('mouseleave', ()=>{ _newsPopHideT=setTimeout(closeNewsPop,180); });
  $('#chart').appendChild(pop); _newsPop=pop;
  positionNewsPop();
}
// Popup selalu di ATAS tick (tick di dekat sumbu bawah → ruang di atas cukup); clamp
// horizontal agar tak keluar tepi kiri/kanan chart.
function positionNewsPop(){
  if(!_newsPop||!_newsPop._for) return;
  const el=_newsPop._for, cW=$('#chart').clientWidth;
  const x=parseFloat(el.style.left)||0, halfW=_newsPop.offsetWidth/2+6;
  _newsPop.style.left=Math.max(halfW, Math.min(x, cW-halfW))+'px';
  _newsPop.style.bottom='46px';   // tepat di atas tick (bottom:24px + tinggi ~14 + gap)
}
function repositionNewsPop(){
  if(!_newsPop||!_newsPop._for) return;
  if(_newsPop._for.style.display==='none'){ closeNewsPop(); return; }   // tick keluar layar → tutup
  positionNewsPop();
}
function closeNewsPop(){ if(_newsPop){ _newsPop.remove(); _newsPop=null; } }
```

- [ ] **Step 3: Klik-luar menutup popup (pasang sekali di `ensureNewsLayer`)**

Di `ensureNewsLayer` (Task 3), sesudah `$('#chart').appendChild(_newsLayer);`, tambah:

```js
  document.addEventListener('click', ()=>{ if(typeof closeNewsPop==='function') closeNewsPop(); });
```

- [ ] **Step 4: Verifikasi browser — popup & bias**

Run: `go run .` → `http://localhost:8765`. Instrumen XAU_USD.
- Desktop: hover tick CPI/PPI/NFP yang sudah rilis → popup muncul di atas tick, berisi currency+nama, waktu lokal, impact (warna sesuai), F/P/A, dan baris bias (▲/▼ hijau/merah). Geser mouse ke popup → tetap terbuka; keluar → tutup dgn grace.
- Hover event netral (mis. ISM/FOMC) → popup TANPA baris bias.
- Tick dekat tepi kanan/kiri → popup ter-clamp, tak keluar chart.
- Ganti instrumen (XAU→USD_JPY) → buka popup event berarah → baris bias ikut berubah arah.
- Emulasi mobile (DevTools device toolbar): tap tick → popup toggle; tap di luar → tutup.
- Pan chart saat popup terbuka → popup ikut tick; tick keluar layar → popup tutup.
Expected: semua lolos; tak ada error console.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(news): marker popup (hover/tap) with event detail + active-instrument bias"
```

---

### Task 5: Frontend — toggle "On chart" + persist

**Files:**
- Modify: `index.html:1175` (header panel News — tambah checkbox switch)
- Modify: `index.html` (CSS, dekat `.wl-head` `~:648`) — style `.nmk-toggle`
- Modify: `index.html` (JS, dekat wiring toggle lain `~:4459`) — init + change handler

**Interfaces:**
- Consumes: `newsMarkersEnabled()` (Task 2), `renderNewsMarkers()` (Task 3), `closeNewsPop()` (Task 4), `_newsLayer`.
- Produces: checkbox `#newsMarkerToggle`; menulis `localStorage['br_newsMarkers']`.

- [ ] **Step 1: Tambah checkbox ke header News**

Ganti `index.html:1175`:

```html
    <div class="wl-head">News<span class="grow"></span><button class="wl-x" id="newsClose" title="Hide News" aria-label="Close">✕</button></div>
```

menjadi:

```html
    <div class="wl-head">News<span class="grow"></span>
      <label class="nmk-toggle" title="Show events on chart"><input type="checkbox" id="newsMarkerToggle"> On chart</label>
      <button class="wl-x" id="newsClose" title="Hide News" aria-label="Close">✕</button></div>
```

- [ ] **Step 2: Tambah CSS toggle**

Sisipkan setelah blok `.wl-head::before{...}` (`~:648`):

```css
  .nmk-toggle{ display:inline-flex; align-items:center; gap:4px; font-size:10px;
    text-transform:none; letter-spacing:0; color:var(--muted); cursor:pointer; margin-right:8px; }
  .nmk-toggle input{ accent-color:var(--luna-glow); cursor:pointer; margin:0; }
```

- [ ] **Step 3: Init state + change handler**

Sisipkan di `index.html` dekat wiring toggle lain (setelah `$('#toggleTrades').onclick=toggleTrades;` `~:4461`):

```js
// Toggle marker on-chart — sinkron localStorage; off → sembunyikan layer & tutup popup.
(function initNewsMarkerToggle(){
  const cb=$('#newsMarkerToggle'); if(!cb) return;
  cb.checked=newsMarkersEnabled();
  cb.addEventListener('change', ()=>{
    localStorage.setItem('br_newsMarkers', cb.checked?'1':'0');
    if(typeof closeNewsPop==='function') closeNewsPop();
    renderNewsMarkers();   // enabled=false → renderNewsMarkers menyembunyikan & mengosongkan layer
  });
})();
```

- [ ] **Step 4: Verifikasi browser — toggle & persist**

Run: `go run .` → `http://localhost:8765`. Buka News.
- Checkbox "On chart" default tercentang; tick tampil di chart.
- Uncheck → semua tick hilang seketika (popup ikut tutup bila terbuka).
- Reload halaman → checkbox tetap ter-uncheck & tick tetap hilang (persist).
- Check kembali → tick muncul lagi; reload → tetap tampil.
Expected: semua lolos; tak ada error console.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(news): 'On chart' toggle for event markers (persist br_newsMarkers)"
```

---

## Catatan verifikasi akhir (setelah semua task)

- `go test ./...` hijau.
- Alur end-to-end di browser: buka app tanpa News → tick sudah tampil; buka News → panel + tick konsisten (filter sama, Medium amber di dua tempat); pan/zoom/TF/resize → tick & popup benar; toggle off → hilang & persist; `prefers-reduced-motion` → tanpa pulsa; ganti instrumen → bias popup & panel ikut berubah.
