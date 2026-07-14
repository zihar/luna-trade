# QT Fractal Indicator (Modul C, PR-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Modul C (QT Fractal) dari `mml.pine` jadi custom indicator klinecharts pertama di Luna Trade — kotak Quarterly Theory per-quarter, level auto dari TF, anchor jam New York DST-aware, label netral (Inggris). Fase AMD/warna ditunda ke PR-2.

**Architecture:** Registrasi satu custom indicator via `klinecharts.registerIndicator` (overlay di `candle_pane`) yang di-`calc` membangun "segmen" quarter dari `dataList` single-TF dan di-`draw` merender kotak + label pakai `xAxis/yAxis.convertToPixel`. Indikator didaftarkan ke katalog `IND_DEFS` yang sudah ada sehingga otomatis dapat toggle menu ƒx, gear ⚙, dan persist `localStorage`. Editor gear diperluas untuk kontrol `select`/`bool`.

**Tech Stack:** JavaScript (vanilla, inline di `index.html`), klinecharts v9.8.10 (UMD), `Intl.DateTimeFormat` untuk timezone NY. Verifikasi: Node scratch script (assertion fungsi murni) + browser manual.

## Global Constraints

- Semua teks yang tampil ke UI **bahasa Inggris** (label/tombol/chip/tooltip). Komentar kode boleh Indonesian.
- Branch dari & PR ke `main`. Branch fitur: `zihar/zihar/feat/qt-fractal-indicator` (sudah dibuat).
- Commit conventional (Indonesian) + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 1 fitur = 1 PR; PR kecil. Scope PR ini = **visual saja** (tanpa fase AMD/warna/gap-anchor/ATR).
- Chart = klinecharts **v9.8.10**. Indikator overlay ditambah via `chart.createIndicator(val, true, {id:'candle_pane'})` (lihat `addInd`, `index.html:6616`).
- Anchor QT selalu zona `America/New_York`, **independen** dari timezone tampilan user.
- Frontend tanpa unit test framework — fungsi murni diverifikasi via Node scratch script; visual via browser (`PORT=8765 ./luna-trade`, butuh login OANDA untuk candle).
- Config indikator disimpan sebagai `calcParams` **array posisi-tetap** agar `persistInd`/`overrideIndicator`/`savedInd` (`index.html:6608-6614`) tetap jalan tanpa ubah skema penyimpanan.

## File Structure

- **Modify `index.html`** — semua perubahan PR ini ada di file monolitik ini (mengikuti pola repo; tidak me-restructure):
  - Blok baru `registerCustomIndicators()` + util QT (waktu NY, anchor, calc, draw), ditempatkan **sebelum** `klinecharts.init` (`index.html:2629`), sejajar dengan blok `registerOverlay` yang sudah ada (~`index.html:2151`+).
  - Entri baru di array `IND_DEFS` (`index.html:6586-6604`).
  - Perluasan `renderIndEditor`/`openIndEditor` (~`index.html:6646-6685`) untuk kontrol `select`/`bool`.
  - Penyesuaian kecil `defParams`/`effParams`/`setIndParams` bila skema param baru butuh (lihat Task 6).
- **Scratch (tidak di-commit):** `scratchpad/qt-verify.mjs` — Node assertion untuk util waktu & anchor.

---

### Task 1: Helper `tfSeconds(tf)` + verifikasi TF→level mapping

**Files:**
- Modify: `index.html` (dekat `GRAN`, `index.html:1744`)
- Verify: `scratchpad/qt-verify.mjs`

**Interfaces:**
- Produces: `tfSeconds(tf: string): number` — detik per satu bar TF (mis. `'M5'→300`, `'M15'→900`, `'H1'→3600`, `'H4'→14400`, `'D'→86400`). Dipakai `qtLevel` (Task 3) & `calc` (Task 4).

- [ ] **Step 1: Cek label TF yang dipakai app**

Run: `grep -nE "currentTF|GRAN|'M5'|'M15'|'H1'|'H4'|revealed\(" index.html | head -30`
Tujuan: konfirmasi string TF kanonik (mis. `M1/M5/M15/M30/H1/H4/D/W/MN`). Gunakan string persis ini di map.

- [ ] **Step 2: Tambah helper `tfSeconds`**

Tambahkan dekat `GRAN` (`index.html:1744`):

```javascript
// Detik per 1 bar TF (untuk pemilihan level QT). Sesuaikan key dgn label TF kanonik app.
const TF_SECONDS = {M1:60, M5:300, M15:900, M30:1800, H1:3600, H4:14400, D:86400, W:604800, MN:2592000};
function tfSeconds(tf){ return TF_SECONDS[tf] || 0; }
```

(Jika Step 1 menunjukkan label berbeda, sesuaikan key `TF_SECONDS` agar cocok.)

- [ ] **Step 3: Buat scratch verifier & assert mapping**

Create `scratchpad/qt-verify.mjs`:

```javascript
// Verifikasi fungsi murni QT (dijalankan dgn: node scratchpad/qt-verify.mjs).
// Salin fungsi dari index.html apa adanya ke sini utk diuji terisolasi.
const TF_SECONDS = {M1:60, M5:300, M15:900, M30:1800, H1:3600, H4:14400, D:86400, W:604800, MN:2592000};
const tfSeconds = tf => TF_SECONDS[tf] || 0;

let fails = 0;
function eq(got, want, msg){ if(got!==want){ console.error(`FAIL ${msg}: got ${got}, want ${want}`); fails++; } }

eq(tfSeconds('M5'), 300, 'tfSeconds M5');
eq(tfSeconds('H1'), 3600, 'tfSeconds H1');
eq(tfSeconds('H4'), 14400, 'tfSeconds H4');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails?1:0);
```

- [ ] **Step 4: Jalankan verifier**

Run: `node scratchpad/qt-verify.mjs`
Expected: `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(qt): helper tfSeconds untuk pemilihan level QT

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Util waktu New York (DST-aware)

**Files:**
- Modify: `index.html` (blok util QT baru, sebelum `klinecharts.init` `index.html:2629`)
- Verify: `scratchpad/qt-verify.mjs`

**Interfaces:**
- Produces:
  - `nyParts(ts: number): {y,mo,d,h,min,dow}` — komponen waktu di `America/New_York` untuk epoch-ms `ts`. `dow`: 1=Sunday..7=Saturday (mirror Pine `dayofweek`).
  - `nyTimestamp(y, mo, d, h, min): number` — epoch-ms untuk waktu dinding NY yang diberikan (DST-aware). Mirror Pine `timestamp("America/New_York", ...)`.
- Dipakai semua anchor di Task 3.

- [ ] **Step 1: Tulis assertion dulu (scratch) untuk nyParts & nyTimestamp**

Tambahkan ke `scratchpad/qt-verify.mjs` (fungsi + assertion). Salin implementasi kandidat berikut:

```javascript
const NY = 'America/New_York';
const _dtf = new Intl.DateTimeFormat('en-US', {timeZone:NY, hourCycle:'h23',
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short'});
const _DOW = {Sun:1,Mon:2,Tue:3,Wed:4,Thu:5,Fri:6,Sat:7};
function nyParts(ts){
  const p = {}; for(const {type,value} of _dtf.formatToParts(ts)) p[type]=value;
  return {y:+p.year, mo:+p.month, d:+p.day, h:+p.hour, min:+p.minute, dow:_DOW[p.weekday]};
}
// Cari epoch-ms utk waktu dinding NY (y,mo,d,h,min). Offset NY = -5 (EST) / -4 (EDT);
// coba kedua offset, pilih yang saat di-nyParts kembali persis ke input (hindari jam ilang/dobel DST).
function nyTimestamp(y, mo, d, h, min){
  min = min || 0;
  for(const off of [4,5]){                     // jam yg ditambah ke waktu NY utk dapat UTC
    const guess = Date.UTC(y, mo-1, d, h+off, min);
    const p = nyParts(guess);
    if(p.y===y && p.mo===mo && p.d===d && p.h===h && p.min===min) return guess;
  }
  // fallback (transisi DST): pakai offset EST.
  return Date.UTC(y, mo-1, d, h+5, min);
}

// --- assertions ---
// 2026-01-15 12:00 EST = 17:00 UTC.
eq(nyTimestamp(2026,1,15,12,0), Date.UTC(2026,0,15,17,0), 'nyTimestamp EST noon');
// 2026-07-15 12:00 EDT = 16:00 UTC.
eq(nyTimestamp(2026,7,15,12,0), Date.UTC(2026,6,15,16,0), 'nyTimestamp EDT noon');
// round-trip: nyParts(nyTimestamp(...)) == input, di musim panas & dingin.
{ const p = nyParts(nyTimestamp(2026,7,15,18,0)); eq(`${p.y}-${p.mo}-${p.d} ${p.h}:${p.min}`, '2026-7-15 18:0', 'roundtrip EDT'); }
{ const p = nyParts(nyTimestamp(2026,1,15,18,0)); eq(`${p.y}-${p.mo}-${p.d} ${p.h}:${p.min}`, '2026-1-15 18:0', 'roundtrip EST'); }
// dow: 2026-07-13 adalah Senin → dow 2.
eq(nyParts(Date.UTC(2026,6,13,16,0)).dow, 2, 'dow Monday');
```

- [ ] **Step 2: Jalankan — pastikan lolos di scratch**

Run: `node scratchpad/qt-verify.mjs`
Expected: `ALL PASS` (bila gagal, perbaiki `nyTimestamp`/`nyParts` di scratch dulu sampai lolos).

- [ ] **Step 3: Tempel fungsi identik ke `index.html`**

Buat blok komentar + fungsi `nyParts`/`nyTimestamp` (isi identik dengan yang sudah lolos di scratch) di area util QT baru, **sebelum** `klinecharts.init` (`index.html:2629`). Awali dengan komentar:

```javascript
// ===================== QT Fractal (Modul C) — util waktu NY (DST-aware) =====================
// Anchor Quarterly Theory selalu America/New_York, independen dari timezone tampilan user.
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(qt): util waktu New York DST-aware (nyParts/nyTimestamp)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Anchor siklus + level + quarter + label (Inggris)

**Files:**
- Modify: `index.html` (lanjutan blok util QT)
- Verify: `scratchpad/qt-verify.mjs`

**Interfaces:**
- Consumes: `nyParts`, `nyTimestamp` (Task 2), `tfSeconds` (Task 1).
- Produces:
  - `qtSessStart(t)`, `qtDayStart(t)`, `qtWeekStart(t)`, `qtMonthAnchor(y,mo)`, `qtMonthCycleStart(t)` — semua epoch-ms.
  - `qtCycleStart(lvl, t)` — dispatch; `lvl`: 1=Session 2=Daily 3=Weekly 4=Monthly.
  - `qtLevel(tfSec, opt)` → 0..4 (0=off). `opt`: `'auto'|'session'|'daily'|'weekly'|'monthly'`.
  - `qtQuarter(lvl, t)` → -1..4 (4=special block).
  - `qtLabelText(lvl, t, q)` → string **Inggris**.

- [ ] **Step 1: Tulis assertion (scratch) untuk anchor & quarter**

Tambahkan fungsi + assertion ke `scratchpad/qt-verify.mjs`. Implementasi kandidat (port dari Pine `mml.pine:358-458`):

```javascript
const MS_DAY = 86400000, MS_WK = 604800000, MS_Q90 = 5400000;
function qtSessStart(t){ const {y,mo,d,h}=nyParts(t); const sh = h>=18?18 : h<6?0 : h<12?6 : 12; return nyTimestamp(y,mo,d,sh,0); }
function qtDayStart(t){ const p=nyParts(t); if(p.h<18){ const pr=nyParts(t-18*3600000); return nyTimestamp(pr.y,pr.mo,pr.d,18,0);} return nyTimestamp(p.y,p.mo,p.d,18,0); }
function qtWeekStart(t){
  const p=nyParts(t); const sunMs=t-(p.dow-1)*MS_DAY; const s=nyParts(sunMs); let s18=nyTimestamp(s.y,s.mo,s.d,18,0);
  if(t<s18){ const pr=nyParts(t-MS_WK); const sun2=pr.dow; const s2=nyParts((t-MS_WK)-(sun2-1)*MS_DAY); s18=nyTimestamp(s2.y,s2.mo,s2.d,18,0);} return s18;
}
function qtMonthAnchor(y,mo){ const dow1=nyParts(nyTimestamp(y,mo,1,12,0)).dow; const fmDay=1+((2-dow1+7)%7); return qtWeekStart(nyTimestamp(y,mo,fmDay,12,0)); }
function qtMonthCycleStart(t){
  const {y,mo}=nyParts(t); const aThis=qtMonthAnchor(y,mo); let cs=aThis;
  if(t<aThis){ const py=mo===1?y-1:y, pmo=mo===1?12:mo-1; cs=qtMonthAnchor(py,pmo); }
  else { const ny=mo===12?y+1:y, nmo=mo===12?1:mo+1; const aNext=qtMonthAnchor(ny,nmo); if(t>=aNext) cs=aNext; }
  return cs;
}
function qtCycleStart(lvl,t){ return lvl===2?qtDayStart(t) : lvl===3?qtWeekStart(t) : lvl===4?qtMonthCycleStart(t) : qtSessStart(t); }
function qtLevel(tfSec, opt){
  const auto = tfSec<=300?1 : tfSec<=900?2 : tfSec<=3600?3 : tfSec<=14400?4 : 0;
  return opt==='session'?1 : opt==='daily'?2 : opt==='weekly'?3 : opt==='monthly'?4 : auto;
}
function qtQuarter(lvl,t){
  if(lvl===1){ let q=Math.floor((t-qtSessStart(t))/MS_Q90); return q<0?0:q>3?3:q; }
  if(lvl===2){ const h=nyParts(t).h; return h>=18?0 : h<6?1 : h<12?2 : 3; }
  if(lvl===3){ const off=Math.round((qtDayStart(t)-qtWeekStart(t))/MS_DAY); return off<0?-1 : off<=4?off : -1; }
  if(lvl===4){ const off=Math.round((qtWeekStart(t)-qtMonthCycleStart(t))/MS_WK); return off<0?-1 : off<=3?off : off===4?4 : -1; }
  return -1;
}
function qtLabelText(lvl,t,q){
  if(lvl===1){ const h=nyParts(t).h; const sn=h>=18?'Asia':h<6?'London':h<12?'NY-AM':'PM'; return `${sn} · Q${q+1}`; }
  if(lvl===2){ const sn=q===0?'Asia':q===1?'London':q===2?'NY-AM':'PM'; return `${sn} · Q${q+1}`; }
  if(lvl===3){ const dn=['Mon','Tue','Wed','Thu','Fri'][q]||'Fri'; return q<=3?`${dn} · Q${q+1}`:`${dn} · sp`; }
  return q<=3?`W${q+1} · Q${q+1}`:`W5 · sp`;
}

// --- assertions ---
// Level auto per TF.
eq(qtLevel(tfSeconds('M5'),'auto'), 1, 'level M5=Session');
eq(qtLevel(tfSeconds('M15'),'auto'), 2, 'level M15=Daily');
eq(qtLevel(tfSeconds('H1'),'auto'), 3, 'level H1=Weekly');
eq(qtLevel(tfSeconds('H4'),'auto'), 4, 'level H4=Monthly');
eq(qtLevel(tfSeconds('D'),'auto'), 0, 'level D=off');
eq(qtLevel(tfSeconds('H1'),'session'), 1, 'level manual override');
// Daily quarter dari jam NY: 20:00 EDT (Senin) = 00:00 UTC Selasa → q0 (Asia, h>=18).
eq(qtQuarter(2, Date.UTC(2026,6,14,0,0)), 0, 'dailyQ 20:00NY=Asia');
// 08:00 EDT = 12:00 UTC → h=8 → q2 (NY-AM).
eq(qtQuarter(2, Date.UTC(2026,6,14,12,0)), 2, 'dailyQ 08:00NY=NY-AM');
// qtDayStart: 08:00 EDT hari X → hari X 18:00 kemarin? h<18 → mundur ke kemarin 18:00.
{ const t=Date.UTC(2026,6,14,12,0); const ds=nyParts(qtDayStart(t)); eq(`${ds.h}`, '18', 'dayStart hour 18'); }
// Label Inggris.
eq(qtLabelText(3, 0, 0).slice(0,3), 'Mon', 'label weekly Mon');
eq(qtLabelText(2, Date.UTC(2026,6,14,12,0), 2), 'NY-AM · Q3', 'label daily NY-AM');
```

- [ ] **Step 2: Jalankan verifier**

Run: `node scratchpad/qt-verify.mjs`
Expected: `ALL PASS` (perbaiki di scratch dulu bila gagal — terutama batas jam/DST).

- [ ] **Step 3: Tempel fungsi identik ke `index.html`**

Salin `MS_DAY/MS_WK/MS_Q90` + semua fungsi anchor/level/quarter/label (isi identik yang lolos scratch) ke blok util QT di `index.html`, setelah util Task 2.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(qt): anchor siklus + level + quarter + label netral (Inggris)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `calc` — bangun segmen quarter + registrasi indikator

**Files:**
- Modify: `index.html` (blok util QT: fungsi `qtBuildSegments`, `registerCustomIndicators`; panggil sebelum `klinecharts.init` `index.html:2629`)
- Verify: `scratchpad/qt-verify.mjs` + browser console

**Interfaces:**
- Consumes: semua fungsi Task 1-3.
- Produces:
  - `qtBuildSegments(dataList, lvl, N): Array<{startTs,endTs,hi,lo,level,q,text}>` — segmen per (cycle,quarter) untuk N siklus terakhir. `dataList` = array kline klinecharts (`{timestamp,open,high,low,close}`).
  - Efek samping: `klinecharts.registerIndicator({name:'QT', ...})` terdaftar (calc memanggil `qtBuildSegments` & simpan ke `indicator.result`/cache; `draw` diisi di Task 5 — sementara return `false`).
- `calcParams` posisi tetap: `[levelCode:number, N:number, fill:0|1, label:0|1]`. `levelCode`: 0=auto,1=session,2=daily,3=weekly,4=monthly.

- [ ] **Step 1: Tulis assertion (scratch) untuk qtBuildSegments**

Tambahkan `qtBuildSegments` + assertion ke `scratchpad/qt-verify.mjs`. Implementasi kandidat:

```javascript
const LVL_OPT = ['auto','session','daily','weekly','monthly'];
function qtBuildSegments(dataList, lvl, N){
  if(!dataList || !dataList.length || lvl<=0) return [];
  const segs = new Map();                        // key `${cycleStart}|${q}` → seg
  for(const k of dataList){
    const t = k.timestamp;
    const q = qtQuarter(lvl, t);
    if(q < 0) continue;                          // di luar siklus (weekend/jeda)
    const cs = qtCycleStart(lvl, t);
    const key = cs + '|' + q;
    let s = segs.get(key);
    if(!s){ s = {cycleStart:cs, startTs:t, endTs:t, hi:k.high, lo:k.low, level:lvl, q, text:qtLabelText(lvl, t, q)}; segs.set(key, s); }
    else { s.endTs=t; if(k.high>s.hi)s.hi=k.high; if(k.low<s.lo)s.lo=k.low; }
  }
  // urut waktu, ambil N siklus terakhir.
  const arr = [...segs.values()].sort((a,b)=> a.startTs-b.startTs);
  const cycles = [...new Set(arr.map(s=>s.cycleStart))].sort((a,b)=>a-b);
  const keep = new Set(cycles.slice(-N));
  return arr.filter(s=> keep.has(s.cycleStart));
}

// --- assertion: 3 hari data H? Bangun daily-level dari candle sintetis per jam ---
{
  const data = [];
  // 2026-07-13 18:00 NY (=22:00 UTC EDT) .. +30 jam, 1 candle/jam.
  const base = nyTimestamp(2026,7,13,18,0);
  for(let i=0;i<30;i++){ const t=base+i*3600000; data.push({timestamp:t, open:1,high:2+i*0.01,low:1-i*0.005,close:1.5}); }
  const segs = qtBuildSegments(data, 2, 4);      // daily level
  // Harus ada quarter Asia(0)/London(1)/NY-AM(2)/PM(3) untuk hari itu.
  const qs = [...new Set(segs.map(s=>s.q))].sort();
  eq(JSON.stringify(qs), JSON.stringify([0,1,2,3]), 'daily segments punya 4 quarter');
  // hi tiap segmen >= lo.
  eq(segs.every(s=> s.hi>=s.lo), true, 'segmen hi>=lo');
}
```

- [ ] **Step 2: Jalankan verifier**

Run: `node scratchpad/qt-verify.mjs`
Expected: `ALL PASS`

- [ ] **Step 3: Tempel `qtBuildSegments` + registrasi indikator ke `index.html`**

Tambahkan `LVL_OPT` + `qtBuildSegments` (identik scratch), lalu registrasi:

```javascript
// State draw dibagi calc→draw (klinecharts panggil calc lalu draw pada indikator yg sama).
function registerCustomIndicators(){
  klinecharts.registerIndicator({
    name: 'QT',
    shortName: 'QT Fractal',
    // calcParams: [levelCode, N, fill, label]
    calcParams: [0, 4, 0, 1],
    figures: [],
    calc: (dataList, indicator) => {
      const cp = indicator.calcParams || [0,4,0,1];
      const lvl = qtLevel(tfSeconds(currentTF), LVL_OPT[cp[0]] || 'auto');
      indicator.extendData = { segments: qtBuildSegments(dataList, lvl, cp[1]|0 || 4), fill: !!cp[2], label: cp[3]!==0, lvl };
      return dataList.map(() => ({}));   // per-bar ringan → klinecharts anggap "punya data"
    },
    draw: () => false   // diisi Task 5
  });
}
```

Panggil `registerCustomIndicators()` **sekali**, sebelum `klinecharts.init` (`index.html:2629`). (Bila `currentTF` belum terdefinisi di titik registrasi, `calc` tetap aman karena dievaluasi belakangan saat indikator ditambahkan.)

- [ ] **Step 4: Verifikasi registrasi di browser (tanpa perlu login)**

Run: `PORT=8765 ./luna-trade` lalu buka `http://localhost:8765`.
Di console browser:
```javascript
klinecharts.getSupportedIndicators?.().includes?.('QT')   // atau cek tak error saat createIndicator('QT')
chart.createIndicator({name:'QT',calcParams:[0,4,0,1]}, true, {id:'candle_pane'});
```
Expected: tak ada error JS; indikator 'QT' terdaftar & bisa ditambahkan. (Tanpa login candle kosong → belum menggambar; itu wajar, draw belum diisi.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(qt): calc bangun segmen quarter + registrasi custom indicator QT

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `draw` — render kotak + label

**Files:**
- Modify: `index.html` (isi `draw` di `registerCustomIndicators`)
- Verify: browser (butuh login OANDA)

**Interfaces:**
- Consumes: `indicator.extendData.segments` (Task 4).
- Produces: rendering kotak per segmen + label netral. Tak ada API baru.

- [ ] **Step 1: Implementasi `draw`**

Ganti `draw: () => false` dengan:

```javascript
draw: ({ ctx, indicator, xAxis, yAxis }) => {
  const ed = indicator.extendData; if(!ed || !ed.segments || !ed.segments.length) return false;
  const NEUTRAL = '#8892a6';                       // warna netral PR-1 (warna fase AMD → PR-2)
  ctx.save();
  ctx.font = '10px -apple-system,system-ui,sans-serif';
  for(const s of ed.segments){
    const x1 = xAxis.convertToPixel(s.startTs);    // klinecharts memetakan timestamp→x
    const x2 = xAxis.convertToPixel(s.endTs);
    const yT = yAxis.convertToPixel(s.hi);
    const yB = yAxis.convertToPixel(s.lo);
    const x = Math.min(x1,x2), w = Math.max(2, Math.abs(x2-x1)), y = Math.min(yT,yB), h = Math.max(1, Math.abs(yB-yT));
    if(ed.fill){ ctx.fillStyle = 'rgba(136,146,166,0.10)'; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = NEUTRAL; ctx.lineWidth = 1; ctx.setLineDash([2,2]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    if(ed.label){
      ctx.fillStyle = NEUTRAL; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(s.text, x + w - 2, y + h - 2);
    }
  }
  ctx.restore();
  return false;
}
```

Catatan: bila `xAxis.convertToPixel(timestamp)` di klinecharts 9.8.10 ternyata butuh dataIndex bukan timestamp, konversi via `chart` timestamp→dataIndex atau simpan `startIdx/endIdx` di segmen (Task 4). Verifikasi di Step 2; sesuaikan bila perlu (lihat Risiko di spec: fallback overlay).

- [ ] **Step 2: Verifikasi visual di browser (login OANDA)**

Run: `PORT=8765 ./luna-trade` → login → buka instrument (mis. XAU_USD).
- TF **5m** → kotak per 90-menit (Session), label `Asia/London/NY-AM/PM · Q1..4`.
- TF **15m** → kotak per sesi (Daily).
- TF **1H** → kotak per hari (Weekly), label `Mon..Fri · Q1..4`.
- TF **4H** → kotak per minggu (Monthly), label `W1..W5 · Q1..4`.
- TF **D** → tak menggambar.
- Kotak "ngepas" high–low tiap quarter; jumlah = N (default 4) siklus terakhir; pan/zoom → kotak ikut geser; tak ada error console.

Bandingkan mata-ke-mata dgn screenshot TradingView user.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(qt): draw kotak quarter + label netral di candle_pane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Integrasi katalog ƒx + editor gear (select/bool)

**Files:**
- Modify: `index.html` — `IND_DEFS` (`index.html:6586`), `renderIndEditor`/`openIndEditor` (~`6646-6685`), `defParams`/`effParams` (`6607-6608`) bila perlu.
- Verify: browser

**Interfaces:**
- Consumes: indikator 'QT' terdaftar (Task 4-5).
- Produces: entri QT di menu ƒx + editor gear yang bisa render `select`/`number`/`bool`. Config → `calcParams` `[levelCode,N,fill,label]`.

- [ ] **Step 1: Tambah entri QT ke `IND_DEFS`**

Tambah ke array `IND_DEFS` (`index.html:6586`). Skema `params` kind baru `'controls'`:

```javascript
{name:'QT', label:'QT Fractal — Quarterly Theory', overlay:true,
  params:{kind:'controls', controls:[
    {type:'select', label:'Level', options:['Auto (by TF)','Session','Daily','Weekly','Monthly'], def:0},
    {type:'number', label:'Cycles', def:4, min:1, max:20, step:1},
    {type:'bool',   label:'Fill',   def:0},
    {type:'bool',   label:'Label',  def:1},
  ]}},
```

- [ ] **Step 2: Perluas `defParams` untuk kind `'controls'`**

Di `defParams` (`index.html:6607`), tambah cabang:

```javascript
function defParams(name){ const d=indDef(name); if(!d||!d.params) return null;
  if(d.params.kind==='controls') return d.params.controls.map(c=>c.def);
  return d.params.kind==='list' ? d.params.def.slice() : d.params.fields.map(f=>f.def); }
```

- [ ] **Step 3: Perluas `renderIndEditor` untuk render controls**

Di `renderIndEditor` (~`index.html:6660`), tangani `def.params.kind==='controls'`: untuk tiap control render sesuai `type`:
- `select` → `<select>` dgn `options`, `onchange` → tulis index ke `calcParams[i]` lalu `setIndParams(name, cp)`.
- `number` → `<input type=number>` (debounce 150ms seperti yang ada) → `calcParams[i]`.
- `bool` → `<input type=checkbox>` → `calcParams[i] = checked?1:0`.

Contoh handler tulis-balik (pakai `effParams`/`setIndParams` yang ada):
```javascript
// cp = effParams(name).slice(); cp[i] = newValue; setIndParams(name, cp);
```
Pastikan nilai awal kontrol diisi dari `effParams(name)[i]`.

- [ ] **Step 4: Verifikasi di browser**

Run: `PORT=8765 ./luna-trade` → login → menu ƒx:
- 'QT Fractal' muncul di grup Overlays; klik → indikator aktif; badge naik.
- Gear ⚙ → popup tampil dropdown Level, angka Cycles, checkbox Fill/Label.
- Ubah Level→Weekly saat di TF 5m → kotak berubah jadi mingguan; ubah Cycles→2 → hanya 2 siklus; toggle Fill/Label → berubah.
- Reload halaman → QT + setelan tetap (persist `br_indicators`).
- Tak ada error console.

- [ ] **Step 5: Commit + hapus scratch**

```bash
rm -f scratchpad/qt-verify.mjs
git add index.html
git commit -m "feat(qt): integrasi menu fx + editor gear kontrol select/bool

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Arsitektur custom indicator + IND_DEFS → Task 4, 6. ✓
- Util waktu NY DST-aware → Task 2. ✓
- Anchor siklus (Session/Daily/Weekly/Monthly + Senin pertama) → Task 3. ✓
- qtLevel auto + manual → Task 3, 6. ✓
- calc segmen quarter (N siklus, hi/lo agregat) → Task 4. ✓
- draw kotak + label kanan-bawah → Task 5. ✓
- Params select/number/bool + persist → Task 6. ✓
- Teks UI Inggris (level/hari/minggu/sesi) → Task 3 (label), Task 6 (kontrol). ✓
- Batasan PR-1 (tanpa AMD/warna/gap-anchor/ATR) → tidak ada task yang menambah itu. ✓

**Placeholder scan:** Tak ada TBD/TODO; tiap step berisi kode/perintah konkret. Satu titik ketidakpastian API (`xAxis.convertToPixel` timestamp vs dataIndex) di-flag eksplisit di Task 5 Step 1 dengan rencana fallback — bukan placeholder, tapi verifikasi runtime.

**Type consistency:** `calcParams` `[levelCode,N,fill,label]` konsisten Task 4 & 6. `LVL_OPT` (Task 4) ↔ options select (Task 6) urutan sama (auto/session/daily/weekly/monthly). `qtBuildSegments(dataList,lvl,N)` dipanggil identik di calc (Task 4). `extendData.segments` diproduksi Task 4, dikonsumsi Task 5.
