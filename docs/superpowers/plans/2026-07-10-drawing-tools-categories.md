# Drawing Tools Berkategori ala TradingView — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti rail drawing datar 8-tool jadi rail berkategori dgn flyout ala TradingView, ekspos overlay bawaan klinecharts yang belum dipakai + tambah shape/text custom (circle/ellipse/arrow/callout) + kategori Cursor (cross/dot/arrow/eraser).

**Architecture:** Semua di `index.html`. Ganti `DRAW_TOOLS` (array datar) → `DRAW_GROUPS` (berkategori). Render rail = 1 ikon/kategori; klik → flyout `.dt-flyout`. Tool baru diintegrasikan ke `DRAW_DEFAULT`/`BUILTIN_LINE`/`PERSIST_DRAW`/`MAGNET_REFINE_SKIP`. Overlay custom baru via `registerOverlay`. Cursor mode via `chart.setStyles({crosshair})` + eraser flag di `delHooks().onClick`.

**Tech Stack:** klinecharts 9.8.10 (UMD, CDN), vanilla JS, localStorage.

## Global Constraints

- Semua teks UI **bahasa Inggris** (label tool, title, tooltip).
- Overlay bawaan klinecharts v9 yang tersedia: `straightLine, rayLine, segment, horizontalStraightLine, horizontalRayLine, horizontalSegment, verticalStraightLine, verticalRayLine, verticalSegment, priceLine, priceChannelLine, parallelStraightLine, fibonacciLine, simpleAnnotation, simpleTag`. TIDAK ada rect/circle/triangle/arrow bawaan.
- Warna brand default `#4a71ff`. Token CSS: `--panel --border --txt --muted --accent --shadow`.
- Verifikasi: manual di browser (tak ada unit test FE). Setelah tiap task, buka `index.html` di browser & cek perilaku.
- Commit sering, pesan Indonesian conventional + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Overlay custom baru (circle, ellipse, arrow, callout)

**Files:**
- Modify: `index.html` — tambah 4 `klinecharts.registerOverlay` setelah blok `rect`/`trendline` (~baris 1751, sebelum registrasi horizontal/vertical line).

**Interfaces:**
- Produces: overlay names `circle`, `ellipse`, `arrow`, `callout` (2 titik, pakai `dstyle(overlay)`, `lsLine(st)`, `subBarCoords`, `drawTextColor`).
- Consumes: `dstyle`, `lsLine`, `subBarCoords`, `drawTextColor` (sudah ada).

- [ ] **Step 1: Tambah registerOverlay untuk circle & ellipse**

Sisipkan setelah blok `rect` overlay (setelah baris 1751):

```js
// ===================== custom overlay: circle (pusat → tepi) =====================
klinecharts.registerOverlay({
  name:'circle', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1];
    const r=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); const st=dstyle(overlay); const rl=lsLine(st);
    return [{type:'circle', attrs:{x:a.x,y:a.y,r},
      styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:rl.style, borderDashedValue:rl.dashedValue||[2,2]}}];
  }
});
// ===================== custom overlay: ellipse (bounding box 2 sudut) =====================
klinecharts.registerOverlay({
  name:'ellipse', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates); const xs=C.map(c=>c.x), ys=C.map(c=>c.y);
    const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2;
    const rx=Math.abs(xs[1]-xs[0])/2, ry=Math.abs(ys[1]-ys[0])/2;
    const st=dstyle(overlay); const rl=lsLine(st);
    // klinecharts figure 'arc' penuh 0..2π diskalakan; pakai polyline ellipse manual utk rx≠ry
    const pts=[]; const N=48; for(let i=0;i<=N;i++){ const t=i/N*2*Math.PI; pts.push({x:cx+rx*Math.cos(t), y:cy+ry*Math.sin(t)}); }
    return [{type:'polygon', attrs:{coordinates:pts},
      styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:rl.style, borderDashedValue:rl.dashedValue||[2,2]}}];
  }
});
```

- [ ] **Step 2: Tambah registerOverlay untuk arrow & callout**

Lanjut di bawahnya:

```js
// ===================== custom overlay: arrow (pangkal → ujung, dgn kepala) =====================
klinecharts.registerOverlay({
  name:'arrow', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1]; const st=dstyle(overlay); const ls=lsLine(st);
    const ang=Math.atan2(b.y-a.y,b.x-a.x), hl=Math.max(10,st.size*6), spread=Math.PI/7;
    const h1={x:b.x-hl*Math.cos(ang-spread), y:b.y-hl*Math.sin(ang-spread)};
    const h2={x:b.x-hl*Math.cos(ang+spread), y:b.y-hl*Math.sin(ang+spread)};
    const line=Object.assign({color:st.color,size:st.size},ls);
    return [
      {type:'line', attrs:{coordinates:[a,b]}, styles:line},
      {type:'line', attrs:{coordinates:[h1,b]}, styles:line},
      {type:'line', attrs:{coordinates:[h2,b]}, styles:line},
    ];
  }
});
// ===================== custom overlay: callout (anchor → kotak teks + penunjuk) =====================
klinecharts.registerOverlay({
  name:'callout', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1]; const st=dstyle(overlay); const ls=lsLine(st);
    const t=overlay&&overlay.extendData? String(overlay.extendData):'Text';
    const lines=t.split('\n'), lh=15, pad=6, cw=Math.max(...lines.map(l=>l.length))*7+pad*2, ch=lines.length*lh+pad*2;
    const bx=b.x-cw/2, by=b.y-ch/2;
    const figs=[
      {type:'line', attrs:{coordinates:[a,{x:b.x,y:b.y}]}, styles:Object.assign({color:st.color,size:st.size},ls)},
      {type:'rect', attrs:{x:bx,y:by,width:cw,height:ch}, styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:ls.style}},
    ];
    lines.forEach((ln,i)=>figs.push({type:'text', attrs:{x:bx+pad,y:by+pad+i*lh, text:ln, align:'left', baseline:'top'},
      styles:{color:drawTextColor,size:12,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}}));
    return figs;
  }
});
```

- [ ] **Step 3: Verifikasi di browser** — buka `index.html`, di console jalankan `chart.createOverlay({name:'circle'})` lalu klik 2 titik → lingkaran muncul. Ulang `ellipse`, `arrow`, `callout`. Expected: tiap overlay tergambar tanpa error.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(draw): overlay custom circle/ellipse/arrow/callout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Integrasi tool baru ke sistem style/persist/magnet

**Files:**
- Modify: `index.html` — `DRAW_DEFAULT` (~1663), `BUILTIN_LINE` (~1676), `MAGNET_REFINE_SKIP` (~1632), `PERSIST_DRAW` (~3573).

**Interfaces:**
- Consumes: names dari Task 1 + bawaan klinecharts.
- Produces: semua name baru dikenali oleh `dstyle`, styling popup (gate `DRAW_DEFAULT`), serialize/restore (`PERSIST_DRAW`), styling garis (`BUILTIN_LINE`).

- [ ] **Step 1: Perluas `DRAW_DEFAULT`** — tambah entri (sisipkan sebelum `};` penutup di ~1673):

```js
  // --- garis bawaan klinecharts yang di-ekspos ---
  straightLine:{color:'#4a71ff',size:1,style:'solid'},
  rayLine:{color:'#4a71ff',size:1,style:'solid'},
  horizontalRayLine:{color:'#4a71ff',size:1,style:'solid'},
  priceLine:{color:'#4a71ff',size:1,style:'dashed'},
  parallelStraightLine:{color:'#4a71ff',size:1,style:'solid'},
  priceChannelLine:{color:'#4a71ff',size:1,style:'solid'},
  fibonacciLine:{color:'#4a71ff',size:1,style:'solid'},
  // --- shape custom baru ---
  circle:{color:'#4a71ff',size:1,style:'solid'},
  ellipse:{color:'#4a71ff',size:1,style:'solid'},
  arrow:{color:'#4a71ff',size:2,style:'solid'},
  callout:{color:'#4a71ff',size:1,style:'solid',textAlign:'left',textValign:'top'},
```

- [ ] **Step 2: Perluas `BUILTIN_LINE`** (~1676) — hanya overlay GARIS bawaan (di-styling via `styles.line`):

```js
const BUILTIN_LINE={horizontalStraightLine:1, verticalStraightLine:1,
  straightLine:1, rayLine:1, horizontalRayLine:1, priceLine:1,
  parallelStraightLine:1, priceChannelLine:1, fibonacciLine:1};
```

- [ ] **Step 3: Perluas `MAGNET_REFINE_SKIP`** (~1632) — tambah yang tak relevan magnet:

```js
const MAGNET_REFINE_SKIP={rect:1, fib3:1, verticalStraightLine:1, horizontalStraightLine:1,
  priceLine:1, callout:1, simpleAnnotation:1, simpleTag:1};
```

- [ ] **Step 4: Perluas `PERSIST_DRAW`** (~3573) — semua name baru masuk whitelist:

```js
const PERSIST_DRAW={trendline:1,rect:1,fib3:1,text:1,dateRange:1,longPosition:1,shortPosition:1,
  horizontalStraightLine:1,verticalStraightLine:1,
  straightLine:1,rayLine:1,horizontalRayLine:1,priceLine:1,parallelStraightLine:1,priceChannelLine:1,fibonacciLine:1,
  circle:1,ellipse:1,arrow:1,callout:1,simpleAnnotation:1,simpleTag:1};
```

- [ ] **Step 5: Verifikasi di browser** — gambar `straightLine` & `circle` lewat console `chart.createOverlay(...)`, klik titik, reload halaman → objek tetap ada (persist). Right-click objek → popup style muncul (karena masuk `DRAW_DEFAULT`).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(draw): daftarkan tool baru ke style/persist/magnet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Data model kategori (DRAW_GROUPS) + cursor mode

**Files:**
- Modify: `index.html` — ganti `DRAW_TOOLS` array (~3845-3855) dgn `DRAW_GROUPS`; tambah `setCursorMode` + `eraserOn` flag; hook eraser di `delHooks().onClick` (~3539).

**Interfaces:**
- Produces: `DRAW_GROUPS` (array `{key,title,cursor?,tools:[{name,title,svg,pos?}]}`), `setCursorMode(name)`, global `eraserOn`, `cursorMode`.
- Consumes: `createDraw`, `disarmIcons`, `chart.setStyles`, `removeOverlay`.

- [ ] **Step 1: Ganti `DRAW_TOOLS` dengan `DRAW_GROUPS`** (baris 3845-3855). Simpan SVG lama sbg referensi ikon tool yang sudah ada; tambah ikon baru. Struktur:

```js
const DRAW_GROUPS=[
  {key:'cursor', title:'Cursor', cursor:true, tools:[
    {name:'cross', title:'Cross', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18"/></svg>'},
    {name:'dot', title:'Dot', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>'},
    {name:'arrow', title:'Arrow (no crosshair)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3l6 16 2-6 6-2z"/></svg>'},
    {name:'eraser', title:'Eraser (click object to delete)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 15l6-6 8 8-3 3H9zM14 5l5 5"/></svg>'},
  ]},
  {key:'trend', title:'Trend Lines', tools:[
    {name:'trendline', title:'Trend Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.7"/><circle cx="20" cy="4" r="1.7"/></svg>'},
    {name:'rayLine', title:'Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="22" y2="2"/><circle cx="4" cy="20" r="1.7"/></svg>'},
    {name:'straightLine', title:'Extended Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="2" y1="22" x2="22" y2="2"/></svg>'},
    {name:'horizontalStraightLine', title:'Horizontal Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'horizontalRayLine', title:'Horizontal Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="12" x2="22" y2="12"/><circle cx="4" cy="12" r="1.7"/></svg>'},
    {name:'verticalStraightLine', title:'Vertical Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'priceLine', title:'Price Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="9" x2="21" y2="9" stroke-dasharray="3 3"/><path d="M3 15h10"/></svg>'},
  ]},
  {key:'channel', title:'Channels', tools:[
    {name:'parallelStraightLine', title:'Parallel Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="17" x2="21" y2="7"/><line x1="3" y1="21" x2="21" y2="11"/></svg>'},
    {name:'priceChannelLine', title:'Price Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="16" x2="21" y2="8"/><line x1="3" y1="20" x2="21" y2="12"/><line x1="3" y1="12" x2="21" y2="4"/></svg>'},
  ]},
  {key:'fib', title:'Fibonacci', tools:[
    {name:'fib3', title:'Fib Retracement', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>'},
    {name:'fibonacciLine', title:'Fib Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="4" y1="20" x2="20" y2="20"/></svg>'},
  ]},
  {key:'shapes', title:'Shapes', tools:[
    {name:'rect', title:'Rectangle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>'},
    {name:'circle', title:'Circle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'},
    {name:'ellipse', title:'Ellipse', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>'},
    {name:'arrow', title:'Arrow', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><path d="M20 4v6M20 4h-6"/></svg>'},
  ]},
  {key:'positions', title:'Positions', tools:[
    {name:'longPosition', pos:'long', title:'Long Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="16" height="14" rx="1.5"/><line x1="4" y1="12" x2="20" y2="12"/><path d="M12 16 V8 M9.5 10.5 L12 8 l2.5 2.5"/></svg>'},
    {name:'shortPosition', pos:'short', title:'Short Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="16" height="14" rx="1.5"/><line x1="4" y1="12" x2="20" y2="12"/><path d="M12 8 V16 M9.5 13.5 L12 16 l2.5 -2.5"/></svg>'},
    {name:'dateRange', title:'Date Range', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 5 V19 M18 5 V19 M9 12 h6 M9 12 l2 -2 M9 12 l2 2 M15 12 l-2 -2 M15 12 l-2 2"/></svg>'},
  ]},
  {key:'text', title:'Text', tools:[
    {name:'text', title:'Text', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 6 h14 M12 6 V19"/></svg>'},
    {name:'callout', title:'Callout', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 16l-2 4 6-4"/></svg>'},
    {name:'simpleAnnotation', title:'Annotation', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v9"/><circle cx="12" cy="16" r="2"/></svg>'},
    {name:'simpleTag', title:'Tag', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h14l4-4-4-4H3z"/></svg>'},
  ]},
];
```

- [ ] **Step 2: Tambah cursor mode** — sisipkan sebelum render rail (sebelum `const _dt=$('#drawtools')`):

```js
let cursorMode = localStorage.getItem('br_cursor') || 'cross';
let eraserOn = (cursorMode==='eraser');
function setCursorMode(name){
  if(inProgressId){ try{chart.removeOverlay(inProgressId);}catch(_){} drawIds=drawIds.filter(id=>id!==inProgressId); inProgressId=null; }
  disarmIcons();
  eraserOn=(name==='eraser'); cursorMode=name; try{localStorage.setItem('br_cursor',name);}catch(_){}
  try{
    if(name==='arrow') chart.setStyles({crosshair:{show:false}});
    else if(name==='dot') chart.setStyles({crosshair:{show:true, horizontal:{line:{show:false}}, vertical:{line:{show:false}}}});
    else chart.setStyles({crosshair:{show:true, horizontal:{line:{show:true}}, vertical:{line:{show:true}}}}); // cross & eraser
  }catch(_){}
  document.body.classList.toggle('eraser-on', eraserOn);
}
```

- [ ] **Step 3: Hook eraser di `delHooks().onClick`** (~3539). Ganti baris:

```js
  onClick:(e)=>{ selectedId=e.overlay.id; return false; },
```

dengan:

```js
  onClick:(e)=>{ if(eraserOn){ try{chart.removeOverlay(e.overlay.id);}catch(_){} return false; } selectedId=e.overlay.id; return false; },
```

- [ ] **Step 4: Verifikasi di browser** — di console: `setCursorMode('arrow')` → crosshair hilang; `setCursorMode('cross')` → kembali; `setCursorMode('eraser')` lalu klik objek → objek terhapus. `DRAW_GROUPS` terdefinisi (`DRAW_GROUPS.length===7`).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(draw): model kategori DRAW_GROUPS + cursor mode (cross/dot/arrow/eraser)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Render rail berkategori + flyout

**Files:**
- Modify: `index.html` — ganti blok render rail (baris 3857-3858: `const _dt=...; DRAW_TOOLS.forEach(...)`) dgn render `DRAW_GROUPS`; tambah CSS `.dt-flyout`/`.dt-item`/`.eraser-on` (dekat `.dtool` ~228).

**Interfaces:**
- Consumes: `DRAW_GROUPS`, `createDraw`, `setCursorMode`, `disarmIcons`, `$`.
- Produces: fungsi `buildDrawRail()`, elemen flyout `#dtFlyout`.

- [ ] **Step 1: Tambah CSS** — setelah baris 228 (`.dtool svg{...}`):

```css
  .dt-cat{position:relative}
  .dt-cat.armed{background:rgba(74,113,255,.16);color:var(--accent);border-radius:9px}
  #dtFlyout{position:fixed;z-index:1100;display:none;flex-direction:column;min-width:180px;padding:4px;
    background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)}
  #dtFlyout.show{display:flex}
  .dt-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;cursor:pointer;color:var(--txt);font-size:13px}
  .dt-item:hover{background:rgba(74,113,255,.12)}
  .dt-item svg{width:17px;height:17px;flex:0 0 auto;color:var(--muted)}
  .dt-item.active{color:var(--accent)}
  .dt-item.active svg{color:var(--accent)}
  body.eraser-on #chart{cursor:crosshair}
```

- [ ] **Step 2: Ganti render rail** (baris 3857-3858) dgn:

```js
const _dt=$('#drawtools');
const _fly=document.createElement('div'); _fly.id='dtFlyout'; document.body.appendChild(_fly);
let _flyOpenKey=null;
function toolByName(n){ for(const g of DRAW_GROUPS){ const t=g.tools.find(x=>x.name===n); if(t) return t; } return null; }
function lastToolOf(g){ const saved=localStorage.getItem('br_lasttool_'+g.key); return (saved&&g.tools.find(t=>t.name===saved))||g.tools[0]; }
function closeFlyout(){ _fly.classList.remove('show'); _flyOpenKey=null; }
function openFlyout(g, catBtn){
  _fly.innerHTML=''; _flyOpenKey=g.key;
  const cur=(g.cursor?cursorMode:lastToolOf(g).name);
  g.tools.forEach(t=>{ const it=document.createElement('div'); it.className='dt-item'+(t.name===cur?' active':'');
    it.innerHTML=t.svg+'<span>'+t.title+'</span>';
    it.onclick=(ev)=>{ ev.stopPropagation(); pickTool(g, t, catBtn); };
    _fly.appendChild(it); });
  const r=catBtn.getBoundingClientRect(); _fly.classList.add('show');
  let top=r.top; const fh=_fly.offsetHeight; if(top+fh>window.innerHeight-8) top=Math.max(8,window.innerHeight-8-fh);
  _fly.style.left=(r.right+6)+'px'; _fly.style.top=top+'px';
}
function pickTool(g, t, catBtn){
  catBtn.dataset.tool=t.name; catBtn.title=g.title+': '+t.title; catBtn.innerHTML=t.svg;
  if(g.cursor){ setCursorMode(t.name); catBtn.classList.add('armed'); }
  else { try{localStorage.setItem('br_lasttool_'+g.key,t.name);}catch(_){} createDraw(t.name, catBtn); }
  closeFlyout();
}
function buildDrawRail(){
  DRAW_GROUPS.forEach(g=>{
    const cat=document.createElement('button'); cat.className='dtool dt-cat'; cat.dataset.cat=g.key;
    const init=g.cursor?(toolByName(cursorMode)||g.tools[0]):lastToolOf(g);
    cat.dataset.tool=init.name; cat.title=g.title+': '+init.title; cat.innerHTML=init.svg;
    cat.onclick=(e)=>{ e.stopPropagation();
      if(_flyOpenKey===g.key){ closeFlyout(); return; }
      openFlyout(g, cat); };
    _dt.appendChild(cat);
  });
  // arm cursor kategori sesuai cursorMode awal
  const cc=_dt.querySelector('.dt-cat[data-cat="cursor"]'); if(cc && cursorMode!=='eraser'==false){} // no-op placeholder
}
buildDrawRail();
window.addEventListener('click',()=>{ if(_flyOpenKey) closeFlyout(); });
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && _flyOpenKey) closeFlyout(); });
```

- [ ] **Step 3: Terapkan cursor mode awal saat load** — setelah `buildDrawRail();` panggil sekali agar crosshair sesuai simpanan (tanpa membatalkan gambar): tambah:

```js
try{ if(cursorMode==='arrow') chart.setStyles({crosshair:{show:false}});
     else if(cursorMode==='dot') chart.setStyles({crosshair:{show:true,horizontal:{line:{show:false}},vertical:{line:{show:false}}}}); }catch(_){}
document.body.classList.toggle('eraser-on', cursorMode==='eraser');
```

- [ ] **Step 4: Hapus placeholder no-op** di `buildDrawRail` (baris `const cc=...no-op`) — ganti jadi arm ikon cursor bila `cursorMode` aktif:

```js
  const cc=_dt.querySelector('.dt-cat[data-cat="cursor"]'); if(cc) cc.classList.add('armed');
```

- [ ] **Step 5: Verifikasi di browser** — rail tampil 7 ikon kategori + magnet/hide/trash. Klik ikon kategori → flyout muncul di kanan dgn daftar tool + label. Pilih tool → ikon kategori berubah jadi tool itu, flyout tutup, mode gambar aktif. Reload → ikon kategori masih tool terakhir. Klik di luar / Esc → flyout tutup. Cursor group: pilih Arrow → crosshair mati.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(draw): rail berkategori + flyout ala TradingView (ingat tool terakhir)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Callout pakai editor teks + verifikasi menyeluruh

**Files:**
- Modify: `index.html` — `onDrawEnd` (`applyTextInput`) atau alur `createDraw` untuk callout membuka editor teks (reuse `openOverlayTextEditor`).

**Interfaces:**
- Consumes: `openOverlayTextEditor`, `applyTextInput`, `expandBox`.

- [ ] **Step 1: Cek `applyTextInput`** — cari fungsinya:

Run: `grep -n "function applyTextInput" index.html`

Baca isinya; ia membuka editor untuk overlay `text`. Tambahkan `callout` agar setelah digambar langsung minta teks. Bila `applyTextInput` mengecek `o.name==='text'`, ubah jadi `(o.name==='text'||o.name==='callout')`.

- [ ] **Step 2: Terapkan perubahan** (contoh, sesuaikan dgn kode aktual):

```js
// di applyTextInput: perluas kondisi pembuka editor
if(o && (o.name==='text' || o.name==='callout')) openOverlayTextEditor(o, true);
```

- [ ] **Step 3: Verifikasi menyeluruh di browser** (checklist spec §Testing):
  1. Tiap kategori: buka flyout, gambar tiap tool → muncul benar.
  2. Ikon kategori = tool terakhir, bertahan setelah reload.
  3. Persist: gambar circle/arrow/straightLine/priceLine/parallelChannel → reload → tetap ada; ganti TF → tetap ada.
  4. Styling: right-click circle/arrow → popup style → ubah warna/size → berubah & tersimpan.
  5. Cursor: Cross/Dot/Arrow ubah crosshair; Arrow matikan crosshair; Eraser hapus objek yg diklik; pilih cursor membatalkan gambar in-progress.
  6. Magnet aktif untuk tool garis baru; tak error utk annotation/callout.
  7. Callout: setelah gambar → editor teks muncul → isi teks → tampil di kotak.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(draw): callout buka editor teks + finalisasi verifikasi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** Cursor (Task 3) ✓; Trend Lines/Channels/Fibonacci/Positions/Text via DRAW_GROUPS (Task 3) + integrasi (Task 2) ✓; Shapes custom (Task 1) ✓; flyout + ingat-tool (Task 4) ✓; persist/style/magnet (Task 2) ✓; callout teks (Task 5) ✓.
- **Placeholder scan:** Task 4 Step 2 memuat no-op placeholder yang SENGAJA dihapus di Step 4 (di-flag eksplisit). Task 5 Step 1-2 bergantung pada isi `applyTextInput` aktual → step meminta baca & sesuaikan (bukan tebakan buta).
- **Type consistency:** name overlay konsisten antar DRAW_GROUPS / DRAW_DEFAULT / BUILTIN_LINE / PERSIST_DRAW. `setCursorMode`/`eraserOn`/`cursorMode` konsisten Task 3↔4.
- **Catatan risiko implementasi:** (a) crosshair "dot" — API `crosshair.horizontal.line.show` di klinecharts 9.8.10 perlu dicek; bila tak ada, fallback dot = biarkan cross. (b) `parallelStraightLine`/`priceChannelLine` 3 titik — pastikan serialize points utuh (sudah generik). (c) figure `polygon`/`circle`/`arc` tersedia di klinecharts 9.8.10 — verifikasi di Task 1 Step 3; bila `polygon` tak ada, ellipse pakai banyak `line`.
