# Indicator Legend (TradingView-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti UI indikator jadi gaya TradingView — legend on-chart per-indikator (nama+nilai live, hover → hide/gear/remove) + modal "Indicators" berpencarian menggantikan dropdown `ƒx`.

**Architecture:** Semua di `index.html` monolitik, blok indikator `6711–6877` + CSS `180–206` + styles chart `~2599/2619`. Legend dibangun HTML overlay penuh di dalam `#chart`; legend indikator native klinecharts dimatikan (`indicator.tooltip.showRule:'none'`). Nilai live & posisi pane dibaca lewat **API publik** klinecharts 9.8.10: `getIndicatorByPaneId().result[]`, `getSize(paneId,'root')`, `overrideIndicator({visible})`, `subscribeAction('onCrosshairChange')`. Editor parameter (`openIndEditor`) dipakai ulang.

**Tech Stack:** Vanilla JS, klinecharts 9.8.10 (UMD, di-pin), CSS custom-properties (`--panel/--border/--accent/--txt/--muted/--btn-hover`).

## Global Constraints

- klinecharts **di-pin 9.8.10**. API publik yang dipakai sudah dikonfirmasi dari `dist/index.d.ts`; tetap bungkus tiap pemanggilan chart dalam `try/catch` (graceful degradation — kegagalan tak boleh mematahkan chart).
- **Teks UI bahasa Inggris** (label/tombol/tooltip). Komentar & commit boleh Indonesian.
- **Tanpa unit test frontend** — verifikasi manual via browser (`PORT=8765 ./luna-trade`, butuh `.env` OANDA; login OANDA untuk candle). Tiap task diakhiri verifikasi manual + "tak ada error JS di console".
- **PR kecil:** Fase 1 (Task 1–4) = satu PR; Fase 2 (Task 5) = PR terpisah. Branch: `zihar/zihar/feat/indicator-legend-tradingview` (sudah dibuat).
- Variabel existing yang dipakai: `chart`, `IND_DEFS`, `indDef()`, `activeInd` (name→paneId), `indParams`, `effParams()`, `defParams()`, `addInd()`, `removeInd()`, `openIndEditor()`, `persistInd()`, `savedInd()`, `updateIndBadge()`, `inst` (simbol aktif), `currentTF`, `decimalsFor(inst)`, `$()`.
- Format `localStorage 'br_indicators'`: array `{name, calcParams, hidden}` (backward-compat: string murni & entri tanpa `hidden` → `hidden:false`).

---

## FASE 1 — Legend on-chart (PR A)

### Task 1: Container legend + matikan legend native + render nama/params

**Files:**
- Modify: `index.html` — CSS setelah baris `206` (`.ind-gear:hover`)
- Modify: `index.html` — objek `darkStyles` (~2599) & `lightStyles` (~2619): tambah `indicator.tooltip.showRule:'none'`
- Modify: `index.html` — blok indikator, sisipkan setelah `updateIndBadge()` (baris ~6780), sebelum `openIndEditor`
- Modify: `index.html` — `addInd()` (6752) & `removeInd()` (6767): panggil `renderIndLegends()`

**Interfaces:**
- Produces: `hiddenInd` (obj name→true), `ensureIndLegendWrap()→HTMLElement|null`, `renderIndLegends()`, `positionIndLegends()`, `indLegPaneId(name)→string`.
- Consumes: existing `activeInd`, `IND_DEFS`, `indDef`, `effParams`, `chart.getSize`.

- [ ] **Step 1: Tambah CSS** — sisipkan setelah baris 206:

```css
  /* legend on-chart per-indikator (ala TradingView) — overlay HTML di dalam #chart */
  .ind-legends{ position:absolute; inset:0; z-index:6; pointer-events:none; }
  .ind-leg{ position:absolute; left:12px; display:flex; flex-direction:column; gap:1px;
    pointer-events:none; font:600 11.5px/1.25 'Inter',sans-serif; white-space:nowrap; }
  .ind-leg-head{ display:inline-flex; align-items:center; gap:6px; pointer-events:auto;
    padding:1px 4px; margin-left:-4px; border-radius:6px; transition:background .12s ease; }
  .ind-leg-head:hover{ background:color-mix(in srgb, var(--panel) 78%, transparent); }
  .ind-leg-name{ color:var(--txt); }
  .ind-leg-params{ color:var(--muted); font-weight:500; }
  .ind-leg.hidden .ind-leg-name, .ind-leg.hidden .ind-leg-params{ opacity:.45; }
  .ind-leg-vals{ display:inline-flex; gap:8px; color:var(--muted); font-weight:500; }
  .ind-leg-btns{ display:none; align-items:center; gap:2px; }
  .ind-leg-head:hover .ind-leg-btns{ display:inline-flex; }
  .ind-leg-btn{ background:transparent; border:0; color:var(--muted); cursor:pointer;
    font-size:12px; line-height:1; padding:2px 3px; border-radius:4px; }
  .ind-leg-btn:hover{ color:var(--txt); background:var(--btn-hover); }
  .ind-leg-btn:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
```

- [ ] **Step 2: Matikan legend indikator native** — di `darkStyles` dan `lightStyles`, tambah properti `indicator` (sejajar `candle`). Cari `candle:{` di kedua objek dan tambahkan sibling:

```js
    indicator:{ tooltip:{ showRule:'none' } },
```

(showRule valid: `'always'|'follow_cross'|'none`; `'none'` mematikan teks nama+nilai native. `candle.tooltip` OHLC tak terpengaruh.)

- [ ] **Step 3: Tambah fungsi legend** — sisipkan setelah `updateIndBadge()` (baris ~6780):

```js
// ===== legend on-chart per-indikator (ala TradingView) =====
// Dibangun HTML overlay penuh (legend indikator native dimatikan via styles). Nilai live &
// posisi pane dibaca lewat API publik klinecharts 9.8.10 (getIndicatorByPaneId/getSize),
// semua try/catch → gagal = degradasi anggun (angka/posisi diabaikan, kontrol tetap jalan).
const hiddenInd={};   // name -> true bila plot di-hide (pane tetap ada)
let indLegendWrap=null;
function ensureIndLegendWrap(){
  if(indLegendWrap && indLegendWrap.isConnected) return indLegendWrap;
  const host=document.getElementById('chart'); if(!host) return null;
  indLegendWrap=document.createElement('div'); indLegendWrap.className='ind-legends';
  host.appendChild(indLegendWrap); return indLegendWrap;
}
function indLegPaneId(name){ return activeInd[name]; }   // 'candle_pane' utk overlay; id sub-pane utk osilator
function legParamsText(name){ const p=effParams(name); const d=indDef(name);
  if(!p||!p.length) return '';
  if(d.params && d.params.kind==='controls') return '';   // QT: params non-numerik → tak ditampilkan
  return p.join(' '); }
function renderIndLegends(){
  const wrap=ensureIndLegendWrap(); if(!wrap) return;
  const names=Object.keys(activeInd);
  wrap.innerHTML=names.map(name=>{
    const d=indDef(name); const hid=!!hiddenInd[name];
    return `<div class="ind-leg${hid?' hidden':''}" data-leg="${name}">`+
      `<div class="ind-leg-head">`+
        `<span class="ind-leg-name">${d?d.name:name}</span>`+
        `<span class="ind-leg-params">${legParamsText(name)}</span>`+
        `<span class="ind-leg-btns">`+
          `<button class="ind-leg-btn leg-eye" data-leg-act="eye" title="${hid?'Show':'Hide'}">${hid?'&#128584;':'&#128065;'}</button>`+
          `<button class="ind-leg-btn leg-gear" data-leg-act="gear" title="Settings">&#9881;</button>`+
          `<button class="ind-leg-btn leg-rm" data-leg-act="rm" title="Remove">&times;</button>`+
        `</span>`+
      `</div>`+
      `<div class="ind-leg-vals"></div>`+
    `</div>`;
  }).join('');
  positionIndLegends();
}
function positionIndLegends(){
  const wrap=indLegendWrap; if(!wrap) return;
  // overlay indikator (candle pane) di-stack di bawah baris info instrumen (top ~30px).
  // osilator: top = top pane-nya (getSize('root')). Fallback: sembunyikan bila getSize gagal.
  let overlayTop=30;
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg; const pid=indLegPaneId(name); const d=indDef(name);
    if(d && d.overlay){ el.style.top=overlayTop+'px'; el.style.display=''; overlayTop+=el.offsetHeight+2; return; }
    let top=null;
    try{ const b=chart.getSize(pid,'root'); if(b && isFinite(b.top)) top=b.top; }catch(e){}
    if(top==null){ el.style.display='none'; return; }
    el.style.display=''; el.style.top=(top+4)+'px';
  });
}
```

- [ ] **Step 4: Panggil render dari addInd/removeInd** — di `addInd()` sebelum `}catch(e){}` penutup (setelah `if(cp) indParams[name]=cp.slice();`) tambah `try{ renderIndLegends(); }catch(e){}`; di `removeInd()` setelah `delete activeInd[name];` tambah `delete hiddenInd[name]; try{ renderIndLegends(); }catch(e){}`.

- [ ] **Step 5: Verifikasi manual** — jalankan `PORT=8765 ./luna-trade`, buka `http://localhost:8765`, login OANDA, muat chart.
  - Tambah MA & RSI lewat menu `ƒx` lama.
  - **Expected:** legend native klinecharts hilang; muncul baris HTML `MA 5 10 30 60` di kiri-atas candle pane, dan `RSI 6 12 24` di kiri-atas pane RSI. Hover baris → muncul tombol 👁 ⚙ ✕ (belum berfungsi). Console tanpa error.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(indicator): legend on-chart per-indikator (nama+params) + matikan legend native"
```

---

### Task 2: Nilai live (crosshair + bar terakhir) + warna sesuai plot

**Files:**
- Modify: `index.html` — blok legend (setelah `positionIndLegends`)
- Modify: `index.html` — panggilan render nilai dari `renderIndLegends` (Step akhir) & subscribe crosshair

**Interfaces:**
- Produces: `updateIndLegendValues(di)`, `lastBarIndex()→number`, `indLineColors()→string[]`.
- Consumes: `chart.getIndicatorByPaneId`, `chart.getDataList`, `chart.getVisibleRange`, `chart.getStyles`, `decimalsFor`, `inst`.

- [ ] **Step 1: Tambah pembaca nilai** — sisipkan setelah `positionIndLegends()`:

```js
function lastBarIndex(){ try{ const dl=chart.getDataList(); return dl.length?dl.length-1:null; }catch(e){ return null; } }
function indLineColors(){ try{ const s=chart.getStyles(); const l=s&&s.indicator&&s.indicator.lines;
  return Array.isArray(l)? l.map(x=>x&&x.color).filter(Boolean) : []; }catch(e){ return []; } }
function fmtIndNum(name,v){ if(v==null||!isFinite(v)) return null;
  const d=indDef(name); const dec=(d&&d.overlay)?decimalsFor(inst):2; return (+v).toFixed(dec); }
function updateIndLegendValues(di){
  const wrap=indLegendWrap; if(!wrap) return;
  if(di==null) di=lastBarIndex(); if(di==null) return;
  const colors=indLineColors();
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg; const box=el.querySelector('.ind-leg-vals'); if(!box) return;
    let html=''; let li=0;
    try{
      const ind=chart.getIndicatorByPaneId(indLegPaneId(name), name);
      const row=ind && ind.result ? ind.result[di] : null;
      if(ind && row){
        (ind.figures||[]).forEach(fig=>{
          if(!fig || fig.key==null) return;
          const raw=row[fig.key]; const num=fmtIndNum(name, raw);
          const isLine=(fig.type==null || fig.type==='line');
          const col=isLine ? (colors[li%Math.max(1,colors.length)]||'var(--muted)') : 'var(--muted)';
          if(isLine) li++;
          if(num!=null) html+=`<span style="color:${col}">${num}</span>`;
        });
      }
    }catch(e){}
    box.innerHTML=html;
    box.style.display = html ? '' : 'none';
  });
}
```

- [ ] **Step 2: Update nilai dari renderIndLegends** — di akhir `renderIndLegends()` (setelah `positionIndLegends();`) tambah `try{ updateIndLegendValues(null); }catch(e){}`.

- [ ] **Step 3: Subscribe crosshair** — sisipkan setelah blok legend (dekat subscribe existing, mis. sesudah baris ~6445 pola `onCrosshairChange`, atau di akhir blok indikator). Gunakan blok baru:

```js
try{ chart.subscribeAction('onCrosshairChange', d=>{
  try{ const di=(d && typeof d.dataIndex==='number') ? d.dataIndex : null; updateIndLegendValues(di); }catch(e){}
}); }catch(e){}
```

- [ ] **Step 4: Verifikasi manual** — reload, tambah MA + RSI.
  - **Expected:** baris legend menampilkan angka (mis. `1.08421 1.08380 …` untuk MA — desimal ikut instrumen; `52.31 …` untuk RSI 2-desimal), berwarna mendekati warna garis. Geser crosshair → angka ikut bar di bawah kursor. Tarik crosshair keluar chart → angka kembali ke bar terakhir. Console tanpa error; bila baca nilai gagal, baris angka hilang tapi nama tetap.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(indicator): nilai indikator live di legend (ikut crosshair, warna sesuai plot)"
```

---

### Task 3: Kontrol hover — hide / gear / remove + persist status hidden

**Files:**
- Modify: `index.html` — `renderIndLegends()` (tambah wiring event di akhir fungsi)
- Modify: `index.html` — tambah `toggleIndVisible(name)`
- Modify: `index.html` — `persistInd()`/`savedInd()`/bootstrap restore (6748–6751, 6872)
- Modify: `index.html` — `addInd()` (terapkan visible saat restore)

**Interfaces:**
- Produces: `toggleIndVisible(name)`.
- Consumes: `openIndEditor`, `removeInd`, `updateIndBadge`, `persistInd`, `chart.overrideIndicator`.

- [ ] **Step 1: Wire tombol** — di akhir `renderIndLegends()` (sebelum `positionIndLegends();`) tambah:

```js
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg;
    el.querySelectorAll('[data-leg-act]').forEach(btn=>btn.onclick=(ev)=>{
      ev.stopPropagation();
      const act=btn.dataset.legAct;
      if(act==='gear') openIndEditor(name);
      else if(act==='eye') toggleIndVisible(name);
      else if(act==='rm'){ removeInd(name); persistInd(); updateIndBadge(); try{ renderIndMenu(); }catch(e){} }
    });
  });
```

(`renderIndMenu` masih ada di Fase 1; di Fase 2 diganti `renderIndModalState`.)

- [ ] **Step 2: Tambah toggleIndVisible** — sisipkan setelah `updateIndLegendValues`:

```js
function toggleIndVisible(name){
  if(!activeInd[name]) return;
  const vis = !!hiddenInd[name];   // saat ini hidden → jadikan visible
  hiddenInd[name] = !vis ? true : false;
  try{ chart.overrideIndicator({name, visible: !hiddenInd[name]}, indLegPaneId(name)); }catch(e){}
  persistInd(); renderIndLegends();
}
```

- [ ] **Step 3: Extend persist** — ganti `persistInd()` (6748) jadi:

```js
function persistInd(){ try{ localStorage.setItem('br_indicators',
  JSON.stringify(Object.keys(activeInd).map(n=>({name:n, calcParams:indParams[n]||null, hidden:!!hiddenInd[n]})))); }catch(e){} }
```

Ganti `savedInd()` (6750) jadi (toleransi string lama & tanpa `hidden`):

```js
function savedInd(){ try{ const a=JSON.parse(localStorage.getItem('br_indicators')||'[]'); if(!Array.isArray(a)) return [];
  return a.map(el=> typeof el==='string' ? {name:el, calcParams:null, hidden:false} : {name:el.name, calcParams:el.calcParams||null, hidden:!!el.hidden}).filter(x=>x&&x.name); }catch(e){ return []; } }
```

- [ ] **Step 4: Restore status hidden** — ganti baris bootstrap (6872):

```js
savedInd().forEach(s=>{ if(s.calcParams) indParams[s.name]=s.calcParams.slice(); addInd(s.name);
  if(s.hidden && activeInd[s.name]){ hiddenInd[s.name]=true; try{ chart.overrideIndicator({name:s.name, visible:false}, activeInd[s.name]); }catch(e){} } });
updateIndBadge(); try{ renderIndLegends(); }catch(e){}
```

- [ ] **Step 5: Verifikasi manual** — reload, tambah MA + RSI.
  - **Expected:** hover → klik 👁 pada MA → garis MA hilang dari candle (pane candle utuh), ikon jadi mata-coret & nama meredup; klik lagi → garis balik. Klik 👁 pada RSI → plot RSI hilang **tapi sub-pane RSI tetap ada** (tak collapse). Klik ⚙ → editor parameter terbuka; ubah period → plot & angka legend berubah. Klik ✕ → indikator + baris legend hilang. Reload → status hide MA bertahan. Console bersih.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(indicator): tombol hide/gear/remove di legend + persist status hidden"
```

---

### Task 4: Reposisi legend saat resize / scroll / zoom / ganti data

**Files:**
- Modify: `index.html` — tambah observer & subscribe di akhir blok legend

**Interfaces:**
- Consumes: `positionIndLegends`, `updateIndLegendValues`, `lastBarIndex`, `chart.subscribeAction`.

- [ ] **Step 1: Tambah reposisi** — sisipkan di akhir blok legend (setelah subscribe crosshair Task 2):

```js
// posisi sub-pane bergeser saat resize / tambah-hapus pane / scroll → reposisi legend.
try{ const host=document.getElementById('chart');
  if(host && window.ResizeObserver){ new ResizeObserver(()=>{ try{ positionIndLegends(); }catch(e){} }).observe(host); }
}catch(e){}
try{ chart.subscribeAction('onScroll', ()=>{ try{ positionIndLegends(); updateIndLegendValues(null); }catch(e){} }); }catch(e){}
try{ chart.subscribeAction('onZoom',   ()=>{ try{ positionIndLegends(); updateIndLegendValues(null); }catch(e){} }); }catch(e){}
```

- [ ] **Step 2: Reposisi setelah tambah/hapus osilator** — sub-pane muncul/hilang mengubah tinggi pane lain. `renderIndLegends()` sudah memanggil `positionIndLegends()`, tapi layout klinecharts baru settle setelah frame berikut. Di akhir `renderIndLegends()` tambah:

```js
  requestAnimationFrame(()=>{ try{ positionIndLegends(); }catch(e){} });
```

- [ ] **Step 3: Verifikasi manual** — tambah RSI + MACD (dua sub-pane), lalu:
  - Resize window → legend RSI/MACD tetap menempel di top pane masing-masing.
  - Hapus RSI → legend MACD naik mengikuti pane-nya.
  - Scroll/zoom chart → nilai legend update ke bar terakhir yang terlihat; posisi tetap benar.
  - **Expected:** tak ada legend "menggantung" di posisi lama; console bersih.

- [ ] **Step 4: Commit + buka PR Fase 1**

```bash
git add index.html
git commit -m "feat(indicator): reposisi legend osilator saat resize/scroll/zoom/hapus pane"
git push -u origin zihar/zihar/feat/indicator-legend-tradingview
gh pr create --base main --title "feat(indicator): legend on-chart ala TradingView (hide/gear/remove + nilai live)" --body "Fase 1 spec 2026-07-14-indicator-legend-tradingview. Legend HTML overlay per-indikator, legend native dimatikan. Modal ƒx menyusul di PR terpisah."
```

---

## FASE 2 — Modal "Indicators" (PR B)

> Buka setelah Fase 1 merge. Rebase: `git fetch origin && git rebase origin/main`.

### Task 5: Modal berpencarian menggantikan dropdown ƒx

**Files:**
- Modify: `index.html` — markup `#indMenu` (1460) → `#indModal`
- Modify: `index.html` — CSS `.ind-menu/.ind-item/.ind-check/.ind-grp` (188–206) → CSS modal
- Modify: `index.html` — `IND_DEFS` (6715): tambah `desc`
- Modify: `index.html` — ganti `renderIndMenu` + IIFE toggle (6858–6877) → modal
- Modify: `index.html` — panggilan `renderIndMenu` di `removeInd` wiring (Task 3 Step 1) & `removeAllInd` (6774)

**Interfaces:**
- Produces: `openIndModal()`, `closeIndModal()`, `renderIndModal()`, `renderIndModalState()`.
- Consumes: `addInd`, `removeInd`, `persistInd`, `updateIndBadge`, `renderIndLegends`, `IND_DEFS`, `activeInd`.

- [ ] **Step 1: Tambah `desc` ke IND_DEFS** — tambahkan properti `desc` pada tiap entri (6716–6739), mis:

```js
  {name:'MA',   label:'MA — Moving Average', desc:'Trend-following average', overlay:true,
```

Isi ringkas (≤ ~40 char, English) untuk MA/EMA/BOLL/VOL/MACD/RSI/QT: `'Trend-following average'`, `'Weighted recent-price average'`, `'Volatility bands ±σ'`, `'Traded volume per bar'`, `'Momentum: MA convergence'`, `'Momentum oscillator 0–100'`, `'Quarterly Theory fractal'`.

- [ ] **Step 2: Ganti markup** — baris 1460 `<div class="ind-menu" id="indMenu"></div>` jadi:

```html
        <div class="ind-modal" id="indModal" hidden>
          <div class="ind-modal-box" role="dialog" aria-label="Indicators">
            <div class="ind-modal-head">
              <span class="ind-modal-title">Indicators</span>
              <button class="ind-modal-x" id="indModalX" title="Close" aria-label="Close">&times;</button>
            </div>
            <div class="ind-modal-search"><input type="text" id="indSearch" placeholder="Search indicators" autocomplete="off"></div>
            <div class="ind-modal-body">
              <div class="ind-modal-cats" id="indCats"></div>
              <div class="ind-modal-list" id="indList"></div>
            </div>
          </div>
        </div>
```

- [ ] **Step 3: Ganti CSS** — hapus `.ind-menu`/`.ind-menu.open` (188–191) & `.ind-grp`/`.ind-item*`/`.ind-check`/`#indMenu *` (195–206); tambahkan:

```css
  .ind-modal{ position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,.5); }
  .ind-modal[hidden]{ display:none; }
  .ind-modal-box{ width:min(560px,92vw); max-height:min(70vh,560px); display:flex; flex-direction:column;
    background:var(--panel); border:1px solid var(--border); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  .ind-modal-head{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px 8px; }
  .ind-modal-title{ font:700 14px/1 'Inter',sans-serif; color:var(--txt); }
  .ind-modal-x{ background:transparent; border:0; color:var(--muted); font-size:20px; cursor:pointer;
    line-height:1; padding:2px 6px; border-radius:6px; }
  .ind-modal-x:hover{ color:var(--txt); background:var(--btn-hover); }
  .ind-modal-search{ padding:0 14px 10px; }
  .ind-modal-search input{ width:100%; height:34px; padding:0 10px; border-radius:8px;
    border:1px solid var(--border); background:var(--bg,transparent); color:var(--txt); font-size:13px; }
  .ind-modal-search input:focus{ outline:none; border-color:var(--accent); }
  .ind-modal-body{ display:flex; min-height:0; flex:1; border-top:1px solid var(--border); }
  .ind-modal-cats{ width:130px; padding:8px; border-right:1px solid var(--border); overflow-y:auto; }
  .ind-cat{ padding:7px 9px; border-radius:7px; font-size:12.5px; color:var(--muted); cursor:pointer; }
  .ind-cat:hover{ background:var(--btn-hover); color:var(--txt); }
  .ind-cat.on{ background:rgba(74,113,255,.14); color:var(--accent); font-weight:600; }
  .ind-modal-list{ flex:1; padding:8px; overflow-y:auto; }
  .ind-row{ display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:8px; cursor:pointer; }
  .ind-row:hover{ background:var(--btn-hover); }
  .ind-row-main{ flex:1; min-width:0; }
  .ind-row-name{ font:600 13px/1.2 'Inter',sans-serif; color:var(--txt); }
  .ind-row.on .ind-row-name{ color:var(--accent); }
  .ind-row-desc{ font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ind-row-badge{ font-size:11px; color:var(--accent); opacity:0; }
  .ind-row.on .ind-row-badge{ opacity:1; }
  .ind-empty{ padding:18px 10px; color:var(--muted); font-size:12.5px; text-align:center; }
```

- [ ] **Step 4: Ganti JS (6858–6877)** — hapus `renderIndMenu` + IIFE toggle, ganti:

```js
let indModalCat='All', indModalQ='';
function indCatOf(d){ return d.overlay?'Overlays':'Oscillators'; }
function openIndModal(){ const m=$('#indModal'); if(!m) return; m.hidden=false; renderIndModal();
  const s=$('#indSearch'); if(s){ s.value=indModalQ; setTimeout(()=>s.focus(),0); } }
function closeIndModal(){ const m=$('#indModal'); if(m) m.hidden=true; }
function renderIndModal(){
  const cats=['All','Overlays','Oscillators'];
  const cbox=$('#indCats'); if(cbox) cbox.innerHTML=cats.map(c=>`<div class="ind-cat${c===indModalCat?' on':''}" data-cat="${c}">${c}</div>`).join('');
  renderIndModalState();
  const cb=$('#indCats'); if(cb) cb.querySelectorAll('.ind-cat').forEach(el=>el.onclick=()=>{ indModalCat=el.dataset.cat; renderIndModal(); });
}
function renderIndModalState(){
  const list=$('#indList'); if(!list) return;
  const q=indModalQ.trim().toLowerCase();
  const items=IND_DEFS.filter(d=>{
    if(indModalCat!=='All' && indCatOf(d)!==indModalCat) return false;
    if(!q) return true;
    return (d.name+' '+d.label+' '+(d.desc||'')).toLowerCase().includes(q);
  });
  list.innerHTML = items.length ? items.map(d=>
    `<div class="ind-row${activeInd[d.name]?' on':''}" data-ind="${d.name}">`+
      `<div class="ind-row-main"><div class="ind-row-name">${d.label}</div>`+
      `<div class="ind-row-desc">${d.desc||''}</div></div>`+
      `<span class="ind-row-badge">Added &#10003;</span>`+
    `</div>`).join('') : `<div class="ind-empty">No indicators match "${indModalQ}"</div>`;
  list.querySelectorAll('.ind-row').forEach(el=>el.onclick=()=>{
    const name=el.dataset.ind;
    if(activeInd[name]) removeInd(name); else addInd(name);
    persistInd(); updateIndBadge(); renderIndModalState();
    track('indicator',{name, on: !!activeInd[name]});
  });
}
(function(){
  const btn=$('#indBtn'), modal=$('#indModal'); if(!btn||!modal) return;
  btn.onclick=(e)=>{ e.stopPropagation(); openIndModal(); };
  const x=$('#indModalX'); if(x) x.onclick=closeIndModal;
  modal.addEventListener('mousedown',e=>{ if(e.target===modal) closeIndModal(); });   // klik backdrop
  const s=$('#indSearch'); if(s) s.oninput=()=>{ indModalQ=s.value; renderIndModalState(); };
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !modal.hidden) closeIndModal(); });
})();
```

- [ ] **Step 5: Ganti sisa referensi `renderIndMenu`** — di `removeAllInd()` (6774) ganti `try{ renderIndMenu(); }catch(e){}` → `try{ renderIndModalState(); renderIndLegends(); }catch(e){}`. Di wiring tombol ✕ legend (Task 3 Step 1) ganti `try{ renderIndMenu(); }catch(e){}` → `try{ renderIndModalState(); }catch(e){}`. Cari sisa `renderIndMenu` lain: `grep -n "renderIndMenu" index.html` harus kosong.

- [ ] **Step 6: Verifikasi manual** — reload.
  - Klik `ƒx` → modal tengah layar terbuka: judul "Indicators", search, sidebar All/Overlays/Oscillators, daftar dengan nama+deskripsi.
  - Ketik "rsi" → daftar terfilter; ketik "zzz" → "No indicators match". Klik kategori Oscillators → hanya VOL/MACD/RSI.
  - Klik baris MA → badge "Added ✓" muncul, badge `ƒx` naik, legend MA muncul di chart. Klik lagi → hilang.
  - Escape / klik backdrop / tombol × → modal tutup. Tak ada gear ⚙ di daftar (settings hanya via legend). Console bersih.
  - `grep -n "renderIndMenu\|ind-menu\|indMenu" index.html` → kosong.

- [ ] **Step 7: Commit + PR Fase 2**

```bash
git add index.html
git commit -m "feat(indicator): modal Indicators berpencarian menggantikan dropdown ƒx"
git push
gh pr create --base main --title "feat(indicator): modal Indicators (search + kategori) ganti dropdown ƒx" --body "Fase 2 spec 2026-07-14-indicator-legend-tradingview. Settings per-indikator kini hanya via legend on-chart (PR Fase 1)."
```

---

## Self-Review (diisi penulis rencana)

**Spec coverage:**
- Modal Indicators (search+kategori, tanpa gear) → Task 5. ✓
- Legend on-chart (nama+params+nilai live, warna) → Task 1–2. ✓
- Hover hide/gear/remove → Task 3. ✓
- Hide = pane tetap, plot disembunyikan → Task 3 (`overrideIndicator visible`). ✓
- Persist hidden + backward-compat `br_indicators` → Task 3 Step 3–4. ✓
- Editor gear dipakai ulang → Task 3 Step 1 (`openIndEditor`). ✓
- Matikan legend native → Task 1 Step 2. ✓
- Sumber nilai (crosshair dataIndex + last bar fallback) → Task 2. ✓
- Posisi sub-pane via getSize + reposisi resize/scroll → Task 1/4. ✓
- Graceful degradation try/catch → seluruh akses chart dibungkus. ✓
- Teks UI English → label/desc/tooltip English. ✓

**Placeholder scan:** tak ada TBD/TODO; semua step berisi kode nyata.

**Type/nama konsisten:** `renderIndLegends`, `positionIndLegends`, `updateIndLegendValues`, `toggleIndVisible`, `indLegPaneId`, `hiddenInd`, `openIndModal/closeIndModal/renderIndModal/renderIndModalState` dipakai konsisten lintas task. `renderIndMenu` lama dihapus penuh di Task 5 Step 5 (grep verifikasi).

**Catatan risiko diketahui:** pencocokan warna angka legend ke garis plot bersifat best-effort (urutan `styles.indicator.lines` di-cycle per figure line) — bila meleset, hanya warna yang tak sempurna, angka & fungsi tetap benar.
