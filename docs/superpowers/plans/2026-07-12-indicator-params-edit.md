# Edit Parameter Indikator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User bisa mengedit parameter (calcParams) tiap indikator teknikal via popup editor per-indikator, diterapkan live & tersimpan lintas reload.

**Architecture:** `IND_DEFS` diperkaya skema parameter (`list` variadic / `fixed` bernama). Menu ƒx dapat gear ⚙ per baris → popup editor `.ind-editor` (reuse `makeDraggable`+`GRIP`+CSS `.pp-*`). Perubahan diterapkan live via `chart.overrideIndicator({name,calcParams}, paneId)` tanpa recreate. Persistensi `br_indicators` pindah dari `string[]` ke `[{name,calcParams}]` dengan migrasi mundur.

**Tech Stack:** HTML/JS monolitik (`index.html`), klinecharts 9.8.10 (CDN). Tanpa unit test — verifikasi manual via browser (Playwright MCP), sintaks via `node --check` pada script yang diekstrak.

## Global Constraints

- Semua perubahan di `index.html` saja. Satu fitur = satu PR (branch `zihar/zihar/feat/indicator-params`).
- Teks UI bahasa Inggris (label editor, tombol). Komentar kode boleh Indonesian.
- Reuse yang ada: `makeDraggable(el,'.pp-grip')`, `GRIP`, CSS `.pp-lbl/.pp-row/.pp-act/.objpop`, `activeInd`, `$`, `track`, `updateIndBadge`, `persistInd/savedInd`, `renderIndMenu`.
- Jangan sentuh chart sekunder (`secondaries`) & jangan tambah indikator baru / edit styles (di luar scope — lihat spec).
- Verifikasi sintaks (tiap task):
  ```bash
  cd <scratchpad> && node -e 'const fs=require("fs");const h=fs.readFileSync("/Users/zihar/Projects/luna-trade/index.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,a="";while((m=re.exec(h))){a+="\n;{\n"+m[1]+"\n}\n";}fs.writeFileSync("chk.js",a);' && node --check chk.js && echo OK
  ```
- Verifikasi browser: server `PORT=8765 ./luna-trade` sudah jalan; login akun test `test@luna.local` / `LunaTest123!`; instance klinecharts app TIDAK terekspos global (`window.chart`=DIV). Fungsi top-level (function declaration) jadi global → bisa dipanggil dari console/Playwright. Buka menu via `$('#indBtn').click()`.

---

### Task 1: Skema parameter di `IND_DEFS` + state & helper

**Files:**
- Modify: `index.html` blok indikator (`const IND_DEFS=[...]` ~6000-6007, dan tepat setelah `const activeInd={};` ~6008)

**Interfaces:**
- Produces: `IND_DEFS[i].params` (`{kind:'list', label, def:number[], min, max, step}` atau `{kind:'fixed', fields:[{label,def,min,max,step}]}`); `indParams` (obj name→number[]); `indDef(name)`, `defParams(name)→number[]|null`, `effParams(name)→number[]|null`.

- [ ] **Step 1: Ganti `IND_DEFS` dengan versi berskema**

Cari `const IND_DEFS=[` dan ganti seluruh array (sampai `];`) dengan:

```js
const IND_DEFS=[
  {name:'MA',   label:'MA — Moving Average',       overlay:true,
    params:{kind:'list', label:'Period', def:[5,10,30,60], min:1, max:400, step:1}},
  {name:'EMA',  label:'EMA — Exp. Moving Average', overlay:true,
    params:{kind:'list', label:'Period', def:[6,12,20], min:1, max:400, step:1}},
  {name:'BOLL', label:'BOLL — Bollinger Bands',    overlay:true,
    params:{kind:'fixed', fields:[
      {label:'Period', def:20, min:1, max:400, step:1},
      {label:'StdDev', def:2,  min:0.1, max:10, step:0.1}]}},
  {name:'VOL',  label:'VOL — Volume',              overlay:false,
    params:{kind:'list', label:'Period', def:[5,10,20], min:1, max:400, step:1}},
  {name:'MACD', label:'MACD',                      overlay:false,
    params:{kind:'fixed', fields:[
      {label:'Short', def:12, min:1, max:400, step:1},
      {label:'Long',  def:26, min:1, max:400, step:1},
      {label:'Signal',def:9,  min:1, max:400, step:1}]}},
  {name:'RSI',  label:'RSI',                        overlay:false,
    params:{kind:'list', label:'Period', def:[6,12,24], min:1, max:400, step:1}},
];
```

- [ ] **Step 2: Tambah state & helper** tepat setelah baris `const activeInd={};`

```js
const indParams={};   // name -> calcParams[] efektif (kosong/absen = pakai default skema)
function indDef(name){ return IND_DEFS.find(d=>d.name===name); }
function defParams(name){ const d=indDef(name); if(!d||!d.params) return null;
  return d.params.kind==='list' ? d.params.def.slice() : d.params.fields.map(f=>f.def); }
function effParams(name){ const p=indParams[name]; return (p&&p.length) ? p.slice() : defParams(name); }
```

- [ ] **Step 3: Cek sintaks** — jalankan perintah `node --check` (Global Constraints). Expected: `OK`.

- [ ] **Step 4: Verifikasi browser** — reload `localhost:8765`, di console:
  `IND_DEFS.map(d=>[d.name,d.params.kind])` → 6 entri dgn kind benar; `defParams('MACD')` → `[12,26,9]`; `effParams('MA')` → `[5,10,30,60]`. Tak ada error console.

- [ ] **Step 5: Commit**

```bash
git add index.html && git commit -m "feat(indicators): skema parameter di IND_DEFS + helper effParams/defParams"
```

---

### Task 2: Terapkan calcParams saat create + persist skema baru + migrasi

**Files:**
- Modify: `index.html` — `addInd` (~6011), `persistInd`/`savedInd` (~6009-6010), loader restore (~6044)

**Interfaces:**
- Consumes: `effParams`, `indParams`, `indDef` (Task 1); `activeInd`, `updateIndBadge`.
- Produces: `setIndParams(name, calcParams:number[])` (apply live + persist); `addInd` kini melewatkan calcParams; `br_indicators` = `[{name, calcParams:number[]|null}]`.

- [ ] **Step 1: Ganti `addInd`** (blok `function addInd(name){ ... }`) dengan:

```js
function addInd(name){
  const def=indDef(name); if(!def||activeInd[name]) return;
  try{
    const cp=effParams(name);
    const val = cp ? {name, calcParams:cp} : name;
    const pid = def.overlay ? chart.createIndicator(val, true, {id:'candle_pane'}) : chart.createIndicator(val);
    activeInd[name] = def.overlay ? 'candle_pane' : pid;
    if(cp) indParams[name]=cp.slice();
  }catch(e){}
}
function setIndParams(name, calcParams){
  indParams[name]=calcParams.slice();
  try{ chart.overrideIndicator({name, calcParams}, activeInd[name]); }catch(e){}
  persistInd();
}
```

- [ ] **Step 2: Ganti `persistInd` & `savedInd`** dengan skema baru + migrasi:

```js
function persistInd(){ try{ localStorage.setItem('br_indicators',
  JSON.stringify(Object.keys(activeInd).map(n=>({name:n, calcParams:indParams[n]||null})))); }catch(e){} }
function savedInd(){ try{ const a=JSON.parse(localStorage.getItem('br_indicators')||'[]'); if(!Array.isArray(a)) return [];
  return a.map(el=> typeof el==='string' ? {name:el, calcParams:null} : el).filter(x=>x&&x.name); }catch(e){ return []; } }
```

- [ ] **Step 3: Ganti loader restore** — cari `savedInd().forEach(addInd);` dan ganti dengan:

```js
savedInd().forEach(s=>{ if(s.calcParams) indParams[s.name]=s.calcParams.slice(); addInd(s.name); });
```
(baris `updateIndBadge();` yang mengikutinya tetap.)

- [ ] **Step 4: Cek sintaks** — `node --check` → `OK`.

- [ ] **Step 5: Verifikasi browser**
  - Reload, login. Console: nyalakan MA →
    `$('#indBtn').click()` lalu klik item MA (atau `addInd('MA'); persistInd();`).
  - `setIndParams('MA',[7,25,99])` → garis MA di chart berubah (7/25/99). `localStorage.br_indicators` berisi `[{"name":"MA","calcParams":[7,25,99]}]`.
  - **Reload** → MA muncul dengan periode 7/25/99 (tersimpan).
  - **Migrasi lama:** `localStorage.setItem('br_indicators','["MA","RSI"]')` → reload → MA & RSI termuat default, tanpa error; `localStorage.br_indicators` kini bentuk objek.

- [ ] **Step 6: Commit**

```bash
git add index.html && git commit -m "feat(indicators): apply calcParams saat create + setIndParams live + persist skema baru + migrasi"
```

---

### Task 3: Gear ⚙ per baris di menu ƒx

**Files:**
- Modify: `index.html` — `renderIndMenu` (~6032-6043); CSS menu indikator (~180-202)

**Interfaces:**
- Consumes: `activeInd`, `addInd`, `removeInd`, `persistInd`, `updateIndBadge`, `track`.
- Produces: gear `.ind-gear[data-gear=name]` per baris; memanggil `openIndEditor(name)` (didefinisikan Task 4 — untuk task ini buat stub sementara agar bisa diuji, diganti di Task 4).

- [ ] **Step 1: Tambah stub `openIndEditor`** tepat sebelum `function renderIndMenu(){` (akan diisi penuh di Task 4):

```js
function openIndEditor(name){ console.log('openIndEditor', name); }  // STUB → Task 4
```

- [ ] **Step 2: Ganti `renderIndMenu`** dengan versi bergear:

```js
function renderIndMenu(){
  const m=$('#indMenu'); if(!m) return;
  const grp=(title,items)=>`<div class="ind-grp">${title}</div>`+items.map(d=>
    `<div class="ind-item${activeInd[d.name]?' on':''}" data-ind="${d.name}"><span class="ind-check">✓</span><span class="ind-lbl">${d.label}</span><button class="ind-gear" data-gear="${d.name}" title="Settings">⚙</button></div>`).join('');
  m.innerHTML=grp('Overlays',IND_DEFS.filter(d=>d.overlay))+grp('Oscillators',IND_DEFS.filter(d=>!d.overlay));
  m.querySelectorAll('.ind-item').forEach(el=>el.onclick=(ev)=>{
    if(ev.target.closest('.ind-gear')) return;   // gear ditangani terpisah
    const name=el.dataset.ind;
    if(activeInd[name]) removeInd(name); else addInd(name);
    persistInd(); renderIndMenu(); updateIndBadge();
    track('indicator',{name, on: !!activeInd[name]});
  });
  m.querySelectorAll('.ind-gear').forEach(g=>g.onclick=(ev)=>{ ev.stopPropagation(); openIndEditor(g.dataset.gear); });
}
```

- [ ] **Step 3: Tambah CSS** (di dekat blok `.ind-menu`/`.ind-item`, ~180-202) — scoped `#indMenu` agar tak ganggu chart-type menu yang berbagi `.ind-item`:

```css
  #indMenu .ind-item{ display:flex; align-items:center; gap:6px; }
  #indMenu .ind-lbl{ flex:1; min-width:0; }
  .ind-gear{ margin-left:auto; background:transparent; border:0; color:var(--muted); cursor:pointer; font-size:13px; line-height:1; padding:2px 4px; border-radius:4px; }
  .ind-gear:hover{ color:var(--txt); background:var(--btn-hover); }
```

- [ ] **Step 4: Cek sintaks** — `node --check` → `OK`.

- [ ] **Step 5: Verifikasi browser** — reload; `$('#indBtn').click()` → menu terbuka, tiap baris punya ⚙ di kanan; klik teks baris = toggle on/off (badge berubah); klik ⚙ → console cetak `openIndEditor <name>` **tanpa** men-toggle baris. Chart-type menu (`#ctBtn`) tetap normal.

- [ ] **Step 6: Commit**

```bash
git add index.html && git commit -m "feat(indicators): gear settings per baris di menu fx (buka editor param)"
```

---

### Task 4: Popup editor parameter (`.ind-editor`)

**Files:**
- Modify: `index.html` — ganti stub `openIndEditor` (Task 3) + tambah `renderIndEditor`/`closeIndEditor` + listener tutup; CSS `.ind-editor`

**Interfaces:**
- Consumes: `indDef`, `effParams`, `defParams`, `setIndParams` (Tasks 1-2); `addInd`, `activeInd`, `persistInd`, `renderIndMenu`, `updateIndBadge`, `makeDraggable`, `GRIP`, `$`.
- Produces: editor mengambang tunggal; state `indEditorEl`, `indEditorName`; `renderIndEditor()`, `closeIndEditor()`.

- [ ] **Step 1: Ganti stub `openIndEditor`** dengan implementasi + fungsi pendukung:

```js
let indEditorEl=null, indEditorName=null;
function openIndEditor(name){
  const def=indDef(name); if(!def||!def.params) return;
  if(!activeInd[name]){ addInd(name); persistInd(); renderIndMenu(); updateIndBadge(); }
  if(!indEditorEl){ indEditorEl=document.createElement('div'); indEditorEl.className='objpop ind-editor'; document.body.appendChild(indEditorEl); makeDraggable(indEditorEl,'.pp-grip'); }
  indEditorName=name; renderIndEditor();
  const b=$('#indBtn').getBoundingClientRect();
  indEditorEl.style.left=Math.max(8,Math.min(b.left, innerWidth-240))+'px';
  indEditorEl.style.top=(b.bottom+6)+'px';
  indEditorEl.classList.add('show');
}
function closeIndEditor(){ if(indEditorEl) indEditorEl.classList.remove('show'); indEditorName=null; }
function renderIndEditor(){
  const name=indEditorName, def=indDef(name), p=def.params; const cp=(effParams(name)||[]).slice();
  let body='';
  if(p.kind==='fixed'){
    body=p.fields.map((f,i)=>`<div class="pp-lbl">${f.label}</div><div class="pp-row"><input type="number" class="ie-num" data-i="${i}" min="${f.min}" max="${f.max}" step="${f.step||1}" value="${cp[i]!=null?cp[i]:f.def}"></div>`).join('');
  } else {
    const rows=cp.map((v,i)=>`<div class="pp-row ie-listrow"><input type="number" class="ie-num" data-i="${i}" min="${p.min}" max="${p.max}" step="${p.step||1}" value="${v}"><button class="ie-x" data-i="${i}" title="Remove"${cp.length<=1?' disabled':''}>×</button></div>`).join('');
    body=`<div class="pp-lbl">${p.label}</div>${rows}<div class="pp-row"><button class="ie-add">+ Add</button></div>`;
  }
  indEditorEl.innerHTML=GRIP+`<div class="pp-lbl ie-title">${def.label}</div>${body}<div class="pp-act"><button class="ie-reset">Reset to default</button></div>`;
  const readNums=()=>[...indEditorEl.querySelectorAll('.ie-num')].map(inp=>parseFloat(inp.value));
  const clampField=(i,val)=>{ const f=(p.kind==='fixed')?p.fields[i]:p; return Math.min(f.max,Math.max(f.min,val)); };
  let deb=null;
  indEditorEl.querySelectorAll('.ie-num').forEach(inp=>inp.oninput=()=>{
    clearTimeout(deb); deb=setTimeout(()=>{
      const arr=readNums(); if(arr.some(v=>!isFinite(v))) return;   // input kosong/NaN → jangan terapkan
      setIndParams(name, arr.map((v,i)=>clampField(i,v)));
    },150);
  });
  if(p.kind==='list'){
    indEditorEl.querySelectorAll('.ie-x').forEach(x=>x.onclick=()=>{ if(cp.length<=1) return; const arr=cp.slice(); arr.splice(+x.dataset.i,1); setIndParams(name,arr); renderIndEditor(); });
    const add=indEditorEl.querySelector('.ie-add'); if(add) add.onclick=()=>{ const arr=cp.slice(); arr.push(cp[cp.length-1]||p.def[0]||14); setIndParams(name,arr); renderIndEditor(); };
  }
  indEditorEl.querySelector('.ie-reset').onclick=()=>{ setIndParams(name, defParams(name)); renderIndEditor(); };
}
document.addEventListener('mousedown',e=>{ if(indEditorEl&&indEditorEl.classList.contains('show') && !indEditorEl.contains(e.target) && !e.target.closest('#indMenu') && !e.target.closest('#indBtn')) closeIndEditor(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && indEditorEl&&indEditorEl.classList.contains('show')) closeIndEditor(); });
```

- [ ] **Step 2: Tambah CSS `.ind-editor`** (dekat CSS popup lain, mis. `.fibpop`):

```css
  .ind-editor{ width:200px; }
  .ind-editor .ie-title{ font-weight:600; }
  .ind-editor .ie-listrow{ display:flex; gap:6px; align-items:center; }
  .ind-editor .ie-num{ flex:1; min-width:0; }
  .ind-editor .ie-x{ background:transparent; border:0; color:var(--muted); cursor:pointer; font-size:14px; line-height:1; padding:0 4px; }
  .ind-editor .ie-x:disabled{ opacity:.3; cursor:default; }
```
(Tombol `.ie-add`/`.ie-reset` mewarisi style tombol dalam `.objpop .pp-act`/popup existing; jika belum ada style tombol generik di `.objpop`, tambahkan `.ind-editor button.ie-add,.ind-editor button.ie-reset{ font:inherit; cursor:pointer; }` — verifikasi tampilan di Step 4 dan sesuaikan.)

- [ ] **Step 3: Cek sintaks** — `node --check` → `OK`.

- [ ] **Step 4: Verifikasi browser** (akun test, chart ter-load)
  - `$('#indBtn').click()` → klik ⚙ pada **MA**: popup muncul (judul "MA — Moving Average"), 4 baris periode + × + "+ Add" + "Reset to default".
  - Ubah periode pertama → garis MA berubah **live** (<~200ms). "+ Add" → baris baru + garis baru. Hapus (×) → garis hilang; saat tersisa 1 baris, × disabled.
  - ⚙ **BOLL** → field bernama **Period / StdDev**; ubah StdDev=3 → lebar band berubah. ⚙ **MACD** → **Short/Long/Signal**.
  - ⚙ pada indikator yang **off** → indikator menyala + editor terbuka.
  - **Reset to default** → nilai & garis kembali default. Klik luar / **Esc** → editor tutup.
  - **Reload** → parameter teredit pulih. Console tanpa error. Screenshot editor MA & BOLL.

- [ ] **Step 5: Commit**

```bash
git add index.html && git commit -m "feat(indicators): popup editor parameter per-indikator (list/fixed, live, add/remove, reset)"
```

---

### Task 5: Verifikasi default runtime & end-to-end final

**Files:**
- Modify (bila perlu): `index.html` — angka `def` di `IND_DEFS` agar 1:1 dengan default library.

**Interfaces:**
- Consumes: seluruh fitur Tasks 1-4.

- [ ] **Step 1: Konfirmasi default library** — di browser console, nyalakan tiap indikator lalu inspeksi calcParams aktual klinecharts. Karena instance app tak global, gunakan jalur aplikasi: nyalakan indikator tanpa override (mis. hapus `br_indicators`, reload, `addInd('MA')` tanpa params) — namun `addInd` kini selalu kirim `effParams` (=default skema). Jadi verifikasi terbalik: pastikan **garis yang dirender default skema == perilaku klinecharts default** dengan membandingkan visual terhadap dokumentasi/versi. Bila ada indikator yang default sk-nya ternyata beda dari library (mis. EMA/VOL), **selaraskan angka `def`** di `IND_DEFS`.
  - Praktis: untuk tiap indikator, sementara set `params.def` ke nilai yang diragukan → reset → amati; MA[5,10,30,60], BOLL[20,2], MACD[12,26,9], RSI[6,12,24] adalah standar TV & klinecharts; EMA[6,12,20] & VOL[5,10,20] konfirmasi visual (jumlah garis benar).

- [ ] **Step 2: Bila ada penyesuaian `def`, cek sintaks** — `node --check` → `OK`.

- [ ] **Step 3: End-to-end final** (browser, akun test) — jalankan seluruh daftar Verifikasi spec §Verifikasi (1-6): toggle, edit list & fixed, add/remove, reset, reload-persist, migrasi skema lama, console bersih. Ambil screenshot editor (MA list + BOLL fixed) sebagai bukti.

- [ ] **Step 4: Commit (bila ada perubahan def)**

```bash
git add index.html && git commit -m "fix(indicators): selaraskan default calcParams skema dengan library (verifikasi runtime)"
```

- [ ] **Step 5: Buka PR & merge**

```bash
git push -u origin zihar/zihar/feat/indicator-params
gh pr create --base main --title "feat(indicators): edit parameter indikator (calcParams per-indikator)" --body "<ringkas: spec + verifikasi>"
gh pr merge <n> --merge --delete-branch
```

---

## Self-review (penulis plan)

- **Spec coverage:** skema list/fixed → Task 1; apply live `overrideIndicator` + `addInd` calcParams → Task 2; persist+migrasi → Task 2; gear ⚙ entry → Task 3; popup editor (fixed/list/add/remove/reset/live/close, enable-if-off) → Task 4; validasi clamp/min-1/NaN-abaikan → Task 4; default runtime-verify → Task 5; verifikasi manual → tiap task + Task 5. Semua item spec tercakup.
- **Placeholder scan:** tak ada TBD/TODO tersisa; stub `openIndEditor` (Task 3) eksplisit diganti di Task 4 (bukan placeholder tak jelas).
- **Type consistency:** `effParams/defParams/indDef` (Task 1) dipakai konsisten di Tasks 2-4; `setIndParams(name, number[])` dipakai seragam; `activeInd[name]` = paneId di semua tempat; `indParams` obj name→number[]; nama fungsi editor (`openIndEditor/renderIndEditor/closeIndEditor`) konsisten Task 3↔4.
