# Bar Replay — Smooth Forming Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saat Bar Replay, bar terakhir "terbentuk" bertahap dari data TF lebih halus (Play halus), dan saat ganti TF bar terakhir = bar TF baru yang memuat cursor `T` (partial), tanpa loncat.

**Architecture:** Cursor absolut `T` tetap sumber kebenaran. Render = `revealed(currentTF)` (bar tutup, anti-lookahead) + 1 bar **partial** sintetis (`buildReplayPartial`, agregasi sub-bar TF halus s/d `T`). Play = loop frame (setTimeout rekursif) yang memajukan `T` proporsional `speed`, render tiap frame. Semua di `index.html`.

**Tech Stack:** Vanilla JS di `index.html` (monolitik), klinecharts 9.8.10, OANDA candles via `fetchCandles`. Tanpa framework test JS.

## Global Constraints

- Teks UI ke pengguna **bahasa Inggris**; komentar kode & commit boleh Indonesian.
- **Anti-lookahead**: OHLC forming bar hanya dari data yang tutup ≤ `T`.
- **Tidak mengubah**: `revealed()`, semantik pick-exclusive & label trading-day (PR #41), eksekusi trade/alert (tetap dievaluasi saat bar penuh currentTF menutup via `onNewBar`), mode Live.
- Tanpa framework test → **gate tiap task**: (a) cek sintaks Node atas script inline `index.html`; (b) task berlogika-murni juga lulus harness Node; (c) task integrasi diverifikasi manual di browser (`PORT=8765 ./luna-trade`, login OANDA).
- Cek sintaks (dipakai berulang):
  ```bash
  node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,a='';while((m=re.exec(h)))a+='\n;{\n'+m[1]+'\n}\n';new (require('vm').Script)(a,{filename:'x'});console.log('SYNTAX OK');"
  ```

## File Structure

- **Modify** `index.html` — satu-satunya file kode. Sisipan berkelompok:
  - State replay (dekat `let formingSeed`): tambah `replayPartial`, `REPLAY_FRAME_MS`.
  - Cache & helper (dekat `ensureM5Window` / `m5WinCache`): `fineWinCache`, `pickFineTF`, `ensureFineWindow`, `buildReplayPartial`.
  - `render(full)`: sisip forming bar.
  - `switchTF(tf)`: hitung `replayPartial`.
  - `step(d)`, `exitReplay()`, handler klik `#chart` (pick): bersihkan `replayPartial`.
  - `play()`/`pause()`/`playFrame()`: loop frame halus (ganti `setInterval(step(1))`).
- **Create (sementara, TIDAK di-commit ke repo)** `scratchpad/test_forming.js` — harness Node uji logika murni.

---

### Task 1: State + helper logika murni (pickFineTF, ensureFineWindow, buildReplayPartial)

**Files:**
- Modify: `index.html` (state dekat `let formingSeed = null;`; helper setelah fungsi `ensureM5Window`)
- Test: `/private/tmp/claude-501/-Users-zihar-Projects-luna-trade/990af64d-3611-46df-aae2-0c3123cb8bef/scratchpad/test_forming.js`

**Interfaces:**
- Consumes: global `DUR`, `TF_LIST`, `tfData`, `T`, `replayMode`, `inst`, `fetchCandles`, `revealed(tf)`.
- Produces:
  - `pickFineTF(coarseTF: string, spanMs: number) → string|null`
  - `ensureFineWindow(fineTF: string, open: number, end: number) → Promise<Array|null>`
  - `buildReplayPartial(tf: string) → Promise<{timestamp,open,high,low,close}|null>`
  - state `replayPartial: {tf,candle}|null`, `const fineWinCache={}`, `const REPLAY_FRAME_MS=40`

- [ ] **Step 1: Tulis harness test (gagal dulu)** — buat `scratchpad/test_forming.js`:

```js
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
function grab(name){ const i=html.indexOf(name); if(i<0) throw new Error('not found: '+name);
  let k=html.indexOf('{',i),depth=0; for(;k<html.length;k++){ if(html[k]==='{')depth++; else if(html[k]==='}'){depth--; if(depth===0){k++;break;}} }
  return html.slice(i,k); }
const DUR={M1:6e4,M2:12e4,M4:24e4,M5:3e5,M10:6e5,M15:9e5,M30:18e5,H1:36e5,H2:72e5,H3:108e5,H4:1.44e7,H6:2.16e7,H8:2.88e7,H12:4.32e7,D:8.64e7,W:6.048e8,MN:2.63e9};
const ctx={DUR,Math,console,inst:'EUR_USD',replayMode:true,tfData:{},T:null,fineWinCache:{}};
ctx.revealed=function(tf){const arr=ctx.tfData[tf];if(!arr)return[];const d=DUR[tf];let lo=0,h=arr.length;
  while(lo<h){const m=(lo+h)>>1;if(arr[m].timestamp+d<=ctx.T)lo=m+1;else h=m;}return arr.slice(0,lo);};
const START=Date.parse('2026-07-06T00:00:00Z'), END=Date.parse('2026-07-10T00:00:00Z');
function priceAt(t){return 1.10+(t-START)/6e4*0.00001;}
function agg(tf,open){const d=DUR[tf],o=priceAt(open),c=priceAt(open+d-6e4);return{timestamp:open,open:o,high:Math.max(o,c),low:Math.min(o,c),close:c};}
function buildTF(tf){const d=DUR[tf],a=[];for(let t=START;t+d<=END;t+=d)a.push(agg(tf,t));return a;}
ctx.fetchCandles=async function(tf,opt){const dur=DUR[tf],from=Date.parse(opt.from),count=opt.count,out=[];
  for(let t=Math.ceil((from-START)/dur)*dur+START;t<END&&out.length<count;t+=dur)out.push(agg(tf,t));return out;};
vm.createContext(ctx);
vm.runInContext(grab('function pickFineTF')+'\n'+grab('async function ensureFineWindow')+'\n'+grab('async function buildReplayPartial'),ctx);
(async()=>{
  ctx.tfData.M15=buildTF('M15'); ctx.tfData.H4=buildTF('H4'); ctx.tfData.D=buildTF('D');
  ctx.T=Date.parse('2026-07-07T10:15:00Z');
  const pH4=await ctx.buildReplayPartial('H4');
  const A1 = pH4 && pH4.timestamp<=ctx.T && pH4.timestamp+DUR.H4>ctx.T;              // partial memuat T
  const A2 = pH4 && pH4.high<=priceAt(ctx.T)+1e-12 && pH4.close<=priceAt(ctx.T)+1e-12; // anti-lookahead
  ctx.T=Date.parse('2026-07-07T12:00:00Z'); const pB=await ctx.buildReplayPartial('H4');
  const A3 = pB===null;                                                             // T di boundary H4 → null
  const A4 = ctx.pickFineTF('D',DUR.D)==='M5' && ctx.pickFineTF('H4',DUR.H4)==='M1' && ctx.pickFineTF('M5',DUR.M5)==='M1';
  const ok=[A1,A2,A3,A4].every(Boolean);
  console.log({A1,A2,A3,A4}); console.log(ok?'ALL PASS':'FAIL'); process.exit(ok?0:1);
})();
```

- [ ] **Step 2: Jalankan → harus GAGAL** (fungsi belum ada):

Run: `node scratchpad/test_forming.js`
Expected: error `not found: function pickFineTF` (exit ≠ 0).

- [ ] **Step 3: Tambah state** — sisipkan setelah baris `let formingSeed = null;`:

```js
let replayPartial = null;    // {tf,candle}: bar berjalan sintetis TF aktif @ cursor T (mode replay)
const REPLAY_FRAME_MS = 40;  // ~25fps render saat Play halus
```

- [ ] **Step 4: Tambah cache** — sisipkan setelah baris `const m5WinCache={};`:

```js
const fineWinCache={};       // "INST|fineTF|open|end" → array sub-bar (forming bar replay)
```

- [ ] **Step 5: Tambah 3 helper** — sisipkan tepat setelah penutup fungsi `ensureM5Window` (`  catch(e){ return null; }\n}`):

```js
// ===== Bar Replay: forming bar TF aktif @ cursor T (agregasi sub-bar TF halus, anti-lookahead) =====
function pickFineTF(coarseTF, spanMs){
  for(const f of ['M1','M5','M15','M30','H1','H4']){
    if(DUR[f]>=DUR[coarseTF]) break;
    if(spanMs/DUR[f] <= 1000) return f;
  }
  return null;   // coarseTF sudah cukup halus → forming bar tak perlu
}
// Hybrid: pakai data ter-load bila menutupi [open,end); kalau tidak fetch on-demand (di-cache).
async function ensureFineWindow(fineTF, open, end){
  const key=inst+'|'+fineTF+'|'+open+'|'+end; if(fineWinCache[key]) return fineWinCache[key];
  const loaded=tfData[fineTF];
  if(loaded && loaded.length && loaded[0].timestamp<=open && loaded[loaded.length-1].timestamp+DUR[fineTF]>=end){
    const slice=loaded.filter(b=>b.timestamp>=open && b.timestamp<end);
    if(slice.length){ fineWinCache[key]=slice; return slice; }
  }
  const count=Math.min(5000, Math.ceil((end-open)/DUR[fineTF])+3);
  try{ const data=await fetchCandles(fineTF,{from:new Date(open).toISOString(), count});
       const slice=data.filter(b=>b.timestamp>=open && b.timestamp<end); fineWinCache[key]=slice; return slice; }
  catch(e){ return null; }
}
// Susun candle partial TF `tf` @ cursor T. Return {timestamp,open,high,low,close} atau null.
async function buildReplayPartial(tf){
  if(!replayMode || T==null) return null;
  const arr=tfData[tf]; if(!arr||!arr.length) return null;
  const rev=revealed(tf);                       // bar tutup penuh ≤ T
  const forming=arr[rev.length];                // bar pertama yg BELUM tutup (pemuat T)
  if(!forming) return null;
  const open=forming.timestamp;                  // HANYA open (waktu) dipakai; OHLC bar kasar diabaikan
  if(open>=T) return null;                        // T di boundary/gap → tak ada partial
  const end=arr[rev.length+1]?arr[rev.length+1].timestamp:open+DUR[tf];
  const fineTF=pickFineTF(tf, end-open); if(!fineTF) return null;
  const fine=await ensureFineWindow(fineTF, open, Math.min(end, T+DUR[fineTF])); if(!fine||!fine.length) return null;
  let o=null,h=-Infinity,l=Infinity,c=null, fdur=DUR[fineTF];
  for(const b of fine){
    if(b.timestamp<open) continue;
    if(b.timestamp>=end) break;
    if(b.timestamp+fdur>T) break;                 // sub-bar belum tutup pada T → stop (anti-lookahead)
    if(o==null) o=b.open;
    if(b.high>h) h=b.high; if(b.low<l) l=b.low; c=b.close;
  }
  if(o==null) return null;
  return {timestamp:open, open:o, high:h, low:l, close:c};
}
```

- [ ] **Step 6: Jalankan harness → harus PASS**:

Run: `node scratchpad/test_forming.js`
Expected: `{A1:true,A2:true,A3:true,A4:true}` lalu `ALL PASS` (exit 0).

- [ ] **Step 7: Cek sintaks inline** (perintah di Global Constraints). Expected: `SYNTAX OK`.

- [ ] **Step 8: Commit** (JANGAN commit file scratchpad):

```bash
git add index.html
git commit -m "feat(replay): helper forming bar (pickFineTF/ensureFineWindow/buildReplayPartial) + state"
```

---

### Task 2: Sisip forming bar ke `render()`

**Files:**
- Modify: `index.html` — fungsi `render(full)`.

**Interfaces:**
- Consumes: `replayMode`, `replayPartial` (Task 1), `revealed(currentTF)`, `tfData`, `chart`.
- Produces: perilaku render yang menampilkan `replayPartial.candle` sbg bar terakhir.

- [ ] **Step 1: Ubah blok apply data di `render`** — ganti:

```js
  const data=revealed(currentTF);
  if(full || lastLen<0 || data.length<lastLen){ chart.applyNewData(data); }
  else if(data.length>lastLen){ for(let k=lastLen;k<data.length;k++) chart.updateData(data[k]); }
  lastLen=data.length;
```

menjadi:

```js
  const data=revealed(currentTF);
  // Bar Replay: sisipkan forming bar (partial) sbg bar terakhir bila valid utk TF & cursor T saat ini.
  let draw=data, hasPartial=false;
  if(replayMode && replayPartial && replayPartial.tf===currentTF && replayPartial.candle){
    const nextOpen = tfData[currentTF] && tfData[currentTF][data.length] ? tfData[currentTF][data.length].timestamp : null;
    if(replayPartial.candle.timestamp===nextOpen){ draw=data.concat([replayPartial.candle]); hasPartial=true; }
  }
  if(full || hasPartial || lastLen<0 || draw.length<lastLen){ chart.applyNewData(draw); }
  else if(draw.length>lastLen){ for(let k=lastLen;k<draw.length;k++) chart.updateData(draw[k]); }
  lastLen=draw.length;
```

- [ ] **Step 2: Cek sintaks inline**. Expected: `SYNTAX OK`.

- [ ] **Step 3: Verifikasi manual ringan** — `PORT=8765 ./luna-trade`, login, buka console:

```js
// di console browser (mode replay, TF M15): paksa sebuah partial & render
replayMode=true; replayPartial={tf:currentTF, candle:{timestamp: revealed(currentTF).length?tfData[currentTF][revealed(currentTF).length]?.timestamp:null, open:1,high:1,low:1,close:1}};
```
Expected: tidak error; bila `timestamp` valid, muncul 1 bar tambahan di ujung; set `replayPartial=null; render()` → hilang. (Uji kasar; perilaku nyata diuji di Task 4/5.)

- [ ] **Step 4: Commit**:

```bash
git add index.html
git commit -m "feat(replay): render sisipkan forming bar sbg bar terakhir"
```

---

### Task 3: Wiring `switchTF` + pembersihan `replayPartial`

**Files:**
- Modify: `index.html` — `switchTF(tf)`, `step(d)`, `exitReplay()`, handler klik `#chart` (pick).

**Interfaces:**
- Consumes: `buildReplayPartial` (Task 1), `replayMode`, `replayPartial`, `render`.
- Produces: `replayPartial` ter-set saat ganti TF (bila `T` mid-bar) & ter-`null` saat `T` berubah diskrit.

- [ ] **Step 1: `switchTF` — hitung partial sebelum render** — di dalam `switchTF`, ganti baris:

```js
  lastLen=-1; render(true);
  if(loadTok!=null) chartLoad.hide(loadTok);
```

menjadi:

```js
  replayPartial=null;
  if(replayMode){ try{ const c=await buildReplayPartial(tf); if(c) replayPartial={tf,candle:c}; }catch(e){} }
  lastLen=-1; render(true);
  if(loadTok!=null) chartLoad.hide(loadTok);
```

(Catatan: `switchTF` sudah `async`. Baris `render(true)`/`chartLoad.hide` yang dimaksud adalah yang tepat sebelum `reanchorFuturePoints(futSnap)`.)

- [ ] **Step 2: `step(d)` — bersihkan partial** — di `step`, sebelum baris terakhir `render();`, sisipkan:

```js
  replayPartial=null;   // Step = 1 bar penuh → T re-align ke boundary, forming bar tak berlaku
```

- [ ] **Step 3: `exitReplay()` — bersihkan partial** — setelah baris `pickMode=false;`, sisipkan:

```js
  replayPartial=null;
```

- [ ] **Step 4: handler pick — bersihkan partial** — di listener klik `#chart`, pada `setTimeout(...)`, ganti:

```js
  setTimeout(()=>{ T=ts; lastLen=-1; render(true);
```

menjadi:

```js
  setTimeout(()=>{ T=ts; replayPartial=null; lastLen=-1; render(true);
```

- [ ] **Step 5: Cek sintaks inline**. Expected: `SYNTAX OK`.

- [ ] **Step 6: Verifikasi manual** — server + login. Replay M15, Play sebentar lalu **Pause di tengah bar** (Task 4 belum ada → simulasikan: `T = tfData['M15'][revealed('M15').length].timestamp + DUR.M15/2; render()` di console), lalu ganti ke H1/H4/D.
Expected: bar terakhir TF baru = bar yang memuat `T` (partial), tanggal benar (trading-day utk Daily), tak loncat hari. `Next` → bar utuh (partial hilang).

- [ ] **Step 7: Commit**:

```bash
git add index.html
git commit -m "feat(replay): switchTF hitung forming bar + bersihkan saat step/exit/pick"
```

---

### Task 4: Playback halus (`play`/`pause`/`playFrame`)

**Files:**
- Modify: `index.html` — `play()`, `pause()`, dan (ganti) mekanisme timer play. Tambah `playFrame()`.

**Interfaces:**
- Consumes: `T`, `currentTF`, `DUR`, `tfData`, `revealed`, `buildReplayPartial`, `onNewBar`, `autoExtend`, `pauseIfNoData`, `render`, `syncReplayPill`, `REPLAY_FRAME_MS`, `$('#speed')`, `$('#playBtn')`.
- Produces: `play()` memutar `T` maju proporsional `speed`, render tiap frame; `pause()` menghentikan; `playTimer` menampung id `setTimeout`.

- [ ] **Step 1: Ganti `play()`** — ganti definisi lama:

```js
function play(){ if(T==null)return; if(!replayMode){ stopLive(); setReplayUI(true); } playing=true; $('#playBtn').textContent='⏸'; try{syncReplayPill();}catch(e){} playTimer=setInterval(()=>step(1),1000/(+$('#speed').value)); }
```

dengan:

```js
function play(){
  if(T==null) return;
  if(!replayMode){ stopLive(); setReplayUI(true); }
  playing=true; $('#playBtn').textContent='⏸'; try{syncReplayPill();}catch(e){}
  playFrame();
}
// Loop frame halus: majukan T proporsional speed (bar/detik), render forming bar tiap frame.
async function playFrame(){
  if(!playing) return;
  const arr=tfData[currentTF]; if(!arr||!arr.length){ pause(); return; }
  const rev=revealed(currentTF);
  if(rev.length>=arr.length){ autoExtend(currentTF); pauseIfNoData(); if(playing) playTimer=setTimeout(playFrame,200); return; }
  const dur=DUR[currentTF], speed=+$('#speed').value||1;
  const beforeLen=rev.length;
  T += Math.max(1, dur*speed*REPLAY_FRAME_MS/1000);   // maju proporsional speed (frame ~fixed)
  const after=revealed(currentTF);
  for(let k=beforeLen;k<after.length;k++) onNewBar(after[k]);   // bar yg baru menutup → cek trade/alert
  if(after.length-1 > arr.length-30) autoExtend(currentTF);
  replayPartial=null;
  try{ const c=await buildReplayPartial(currentTF); if(c) replayPartial={tf:currentTF,candle:c}; }catch(e){}
  render();
  if(playing) playTimer=setTimeout(playFrame, REPLAY_FRAME_MS);
}
```

- [ ] **Step 2: Ganti `pause()`** — ganti:

```js
function pause(){ playing=false; $('#playBtn').textContent='▶'; try{syncReplayPill();}catch(e){} clearInterval(playTimer); }
```

dengan:

```js
function pause(){ playing=false; $('#playBtn').textContent='▶'; try{syncReplayPill();}catch(e){} clearTimeout(playTimer); clearInterval(playTimer); }
```

- [ ] **Step 3: `$('#speed').onchange`** — pastikan tetap:

```js
$('#speed').onchange=()=>{ if(playing){pause();play();} };
```
(Tak wajib diubah; `playFrame` membaca `speed` tiap frame. Biarkan apa adanya.)

- [ ] **Step 4: Cek sintaks inline**. Expected: `SYNTAX OK`.

- [ ] **Step 5: Verifikasi manual** — server + login. Replay M15 → **Play**.
Expected: bar terakhir tumbuh bertahap (open→wick→body) lalu menutup & bar berikutnya mulai; tidak lompat. **Pause** di tengah → bar tampil partial. Ubah **speed** → laju berubah, tetap halus di speed rendah. **Exit**/**Next** → normal.

- [ ] **Step 6: Commit**:

```bash
git add index.html
git commit -m "feat(replay): playback halus (forming bar tumbuh bertahap per frame)"
```

---

### Task 5: Verifikasi end-to-end + hapus artefak

**Files:**
- Hapus: `scratchpad/test_forming.js` (tak di-repo; cukup pastikan tidak ter-commit).

- [ ] **Step 1: Jalankan checklist spec** (server + login OANDA):
  1. Replay M15 **Play** → forming bar tumbuh bertahap, menutup, lanjut; tak lompat.
  2. Saat Play (T mid-bar), ganti TF H1/H4/D → bar terakhir = bar TF baru memuat momen (partial), tanggal trading-day benar, tak loncat hari.
  3. **Next/Prev** = 1 candle penuh; setelah step bar terakhir = bar utuh (bukan partial).
  4. Anti-lookahead: high/low/close forming bar ≤ data s/d T (silang-cek step manual di TF halus).
  5. Daily Play: bar harian terbentuk dari M5 dalam waktu wajar; window M5 ter-fetch/cache tanpa error.
  6. Console bebas error JS.

- [ ] **Step 2: Pastikan tak ada file/console.log debug ter-commit**:

```bash
git status --porcelain          # scratchpad tak boleh muncul sbg staged
grep -n "REPLAY-DBG\|console.log(" index.html || echo "no debug logs"
```
Expected: tak ada log debug baru; `scratchpad/test_forming.js` tidak ter-track.

- [ ] **Step 3: (Bila semua lolos) buka PR** — lihat "Execution Handoff".

## Self-Review

**1. Spec coverage:**
- Forming bar visual (revealed + partial) → Task 1 (builder) + Task 2 (render). ✓
- Play halus (frame, proporsional speed, clamp via frame tetap) → Task 4. ✓
- Next/Prev tak berubah → Task 3 Step 2 hanya menambah `replayPartial=null`; logika step utuh. ✓
- Ganti TF partial + label trading-day → Task 3 Step 1 (label dari PR #41, tak diubah). ✓
- Pembersihan partial → Task 3 Steps 2–4. ✓
- Anti-lookahead → Task 1 builder + harness A2. ✓
- Non-tujuan (SL/TP intra-bar) → trade/alert via `onNewBar` per bar-close di Task 4 Step 1; tak ada eksekusi intra-bar. ✓

**2. Placeholder scan:** Tidak ada TBD/TODO; semua step berisi kode nyata. ✓

**3. Type consistency:** `replayPartial` = `{tf,candle}` konsisten di Task 1/2/3/4. `buildReplayPartial` return `{timestamp,open,high,low,close}|null` dibungkus `{tf,candle}` di pemanggil. `pickFineTF/ensureFineWindow` signatur konsisten. `playTimer` dipakai untuk `setTimeout` (Task 4) & di-clear di `pause`. ✓

**Catatan clamp:** frame tetap `REPLAY_FRAME_MS` (40ms) = render rate tetap ~25fps; di speed tinggi `T` maju lebih banyak per frame (bisa lewati >1 bar → loop `onNewBar` menutup semua bar terlewati). Ini realisasi "clamp 16ms + maju beberapa sub-bar" dari spec.
