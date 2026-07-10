# Trendline Sub-Bar Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trendline mendarat & bisa di-drag tepat di posisi kursor (sub-bar), bukan snap ke pusat bar.

**Architecture:** Simpan titik trendline sebagai `dataIndex` pecahan (tanpa `timestamp`) saat runtime → `convertToPixel` menerima pecahan sehingga garis & handle default klinecharts sama-sama presisi. Intercept `onPressedMoving` di template `trendline` (return `true`) agar klinecharts melewati konversi drag bawaannya yang meng-snap ke integer. Durabilitas lintas-TF/refresh via `vt` (wall-clock) memakai mesin `snapshotFuturePoints`/`reanchorFuturePoints` yang sudah menangani titik dataIndex secara generik.

**Tech Stack:** Vanilla JS + klinecharts@9.8.10 (UMD CDN). Satu file: `index.html`. Tak ada build/test runner — verifikasi lewat browser (server backend menyediakan candle OANDA).

## Global Constraints

- Semua perubahan hanya di `/Users/zihar/Projects/luna-trade/index.html`.
- Scope perilaku: **overlay `trendline` saja**. Jangan ubah anchor rect/fib/dateRange/position/garis-axis.
- `xAnchorFromPx()` TIDAK boleh diubah (dipakai semua overlay). Perubahan anchor di-scope via `name==='trendline'`.
- Teks yang tampil ke UI tetap bahasa Inggris (label/tombol/chip). Komentar kode bahasa Indonesia (mengikuti gaya file).
- `subBarCoords` tetap no-op — jangan dihidupkan.
- Titik trendline in-data disimpan sebagai `dataIndex` **pecahan**; jangan biarkan menjadi integer eksak bila bisa dihindari (agar `updatePointPosition` klinecharts tidak mengisi `timestamp` → snap). Titik tepat di pusat bar (fraksi .0) boleh dianggap wajar.

---

### Task 1: Helper konversi fractional dataIndex ↔ wall-clock

**Files:**
- Modify: `index.html` — tambah helper dekat `xAnchorFromPx`/`tsOf` (sekitar baris 1521–1534), perbaiki `tsOf` (1530–1532).

**Interfaces:**
- Produces:
  - `fracAnchorFromPx(x) → {dataIndex:number} | null` — pixel-x (container-relative) → fractional dataIndex mentah dari `chart.convertFromPixel` (presisi, tanpa snap).
  - `fidxToTs(idx:number) → number|null` — fractional dataIndex → wall-clock ms; interpolasi antar-bar untuk in-data, ekstrapolasi `DUR` untuk future.
  - `tsToFracIndex(vt:number) → number|null` — inverse: wall-clock ms → fractional dataIndex.
  - `tsOf(p)` tetap signature sama, tapi cabang dataIndex kini pakai `fidxToTs`.
- Consumes: `revealed(currentTF)`, `DUR`, `currentTF`, `chart.convertFromPixel` (semua sudah ada).

- [ ] **Step 1: Tulis helper baru** tepat setelah `xAnchorFromPx` (setelah baris 1528, sebelum komentar `tsOf` di 1529):

```js
// pixel-x (container-relative) → fractional dataIndex MENTAH dari mesin koordinat chart
// (presisi, TANPA snap). Dipakai jalur trendline supaya titik mendarat tepat di kursor.
function fracAnchorFromPx(x){
  const arr=revealed(currentTF); if(!arr.length) return null;
  let c=chart.convertFromPixel({x,y:0},{paneId:'candle_pane'}); if(Array.isArray(c)) c=c[0];
  const idx=(c&&c.dataIndex!=null)?c.dataIndex:(arr.length-1);
  return {dataIndex: idx};
}
// fractional dataIndex → wall-clock ms. In-data: interpolasi antar 2 bar tetangga (anti-gap
// weekend). Future (idx>=li): ekstrapolasi linear DUR. Kebalikan dari tsToFracIndex.
function fidxToTs(idx){
  const a=revealed(currentTF); if(!a.length||idx==null) return null;
  const li=a.length-1;
  if(idx>=li) return Math.round(a[li].timestamp + (idx-li)*DUR[currentTF]);
  if(idx<=0) return a[0].timestamp;
  const i=Math.floor(idx), f=idx-i, t0=a[i].timestamp, t1=a[Math.min(i+1,li)].timestamp;
  return Math.round(t0 + f*(t1-t0));
}
// wall-clock ms → fractional dataIndex. Future (vt>=last): ekstrapolasi DUR. In-data:
// cari bar pengapit lalu interpolasi. Kebalikan dari fidxToTs.
function tsToFracIndex(vt){
  const a=revealed(currentTF); if(!a.length||vt==null) return null;
  const li=a.length-1, lt=a[li].timestamp;
  if(vt>=lt) return li + (vt-lt)/DUR[currentTF];
  if(vt<=a[0].timestamp) return 0;
  let lo=0,hi=li; while(lo<hi){ const m=(lo+hi)>>1; if(a[m].timestamp<vt) lo=m+1; else hi=m; }
  const i=Math.max(0,lo-1), t0=a[i].timestamp, t1=a[Math.min(i+1,li)].timestamp;
  const fr=(t1>t0)?(vt-t0)/(t1-t0):0; return i+fr;
}
```

- [ ] **Step 2: Perbaiki `tsOf`** — cabang dataIndex pakai `fidxToTs` (baris 1530–1532). Ganti:

```js
function tsOf(p){ if(!p) return null; if(p.timestamp!=null) return p.timestamp;
  if(p.dataIndex!=null){ const a=revealed(currentTF); if(!a.length) return null;
    const li=a.length-1; return Math.round(a[li].timestamp + (p.dataIndex-li)*DUR[currentTF]); } return null; }
```

menjadi:

```js
function tsOf(p){ if(!p) return null; if(p.timestamp!=null) return p.timestamp;
  if(p.dataIndex!=null) return fidxToTs(p.dataIndex); return null; }
```

- [ ] **Step 3: Verifikasi di browser** — jalankan app (server backend + buka `index.html`), load sebuah instrumen, buka DevTools Console:

```js
// roundtrip harus mendekati identik (toleransi < 1 bar)
let a=revealed(currentTF), li=a.length-1;
console.log('mid-data', tsToFracIndex(fidxToTs(li-3.4)) - (li-3.4));   // ~0
console.log('future',   tsToFracIndex(fidxToTs(li+2.5)) - (li+2.5));   // ~0
```

Expected: kedua nilai ≈ 0 (|selisih| < 0.01).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(trendline): helper fractional dataIndex <-> wall-clock (fracAnchorFromPx/fidxToTs/tsToFracIndex)"
```

---

### Task 2: Jalur menggambar — titik trendline final jadi fractional dataIndex

**Files:**
- Modify: `index.html` — `onDrawEnd` di `delHooks()` (baris 3420–3447), setelah blok refine & sebelum guard anchorless.

**Interfaces:**
- Consumes: `fidxOf(p)` (baris 1536, timestamp→frac idx via pixel), hasil refine `o.points`.
- Produces: untuk `o.name==='trendline'`, `o.points` = `[{dataIndex:<pecahan>, value}, ...]`.

- [ ] **Step 1: Sisipkan konversi trendline** di `onDrawEnd`, tepat SETELAH baris `if(refine){ for(let k=0;k<o.points.length;k++) o.points[k]=toPt(pendingClicks[k]); }` (baris 3439) dan SEBELUM `o.points.forEach((pt,i)=>{ ... anchorless guard` (baris 3440):

```js
      // Trendline: pindahkan anchor ke dataIndex PECAHAN (bukan timestamp) supaya garis & handle
      // dirender presisi di titik klik (timestamp akan di-snap klinecharts ke pusat bar).
      if(o.name==='trendline'){ o.points=o.points.map(p=>{ if(!p||p.value==null) return p;
        const idx = (p.dataIndex!=null && isFinite(p.dataIndex)) ? p.dataIndex : fidxOf(p);
        return {dataIndex: idx, value: p.value}; }); }
```

- [ ] **Step 2: Verifikasi menggambar** — di app: pilih tool Trendline, klik di **paruh kanan** sebuah candle lebar (TF besar mis. H4/D), klik titik kedua. Amati: garis berujung tepat di kursor, bukan lompat ke pusat candle. Console:

```js
let o=chart.getOverlayById(drawIds[drawIds.length-1]);
console.log(o.name, o.points.map(p=>({di:p.dataIndex, ts:p.timestamp, v:p.value})));
```

Expected: `name==='trendline'`, tiap titik `di` bernilai **pecahan** (mis. `123.62`), `ts` = `undefined`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(trendline): draw anchor sebagai fractional dataIndex (presisi di titik klik)"
```

---

### Task 3: Jalur edit/drag — intercept onPressedMoving di template trendline

**Files:**
- Modify: `index.html` — `registerOverlay({name:'trendline', ...})` (baris 1711–1729): tambah `onPressedMoveStart`/`onPressedMoving`/`onPressedMoveEnd` + variabel state `tlDrag` sebelum blok registrasi.

**Interfaces:**
- Consumes: `fracAnchorFromPx`, `pxToValue`, `fidxOf`, `chart.overrideOverlay`, `scheduleSaveDraws`, `refineMagnetPoints`, `magnetOn`, `$('#chart')`.
- Produces: drag endpoint & badan garis trendline presisi; event lain (rect/fib/position) tak tersentuh (hook di template trendline saja).

- [ ] **Step 1: Verifikasi ruang koordinat `e.x/e.y`** — SEMENTARA tambahkan log di dalam template (lalu hapus). Tambah `onPressedMoveStart` sementara:

```js
  onPressedMoveStart:(e)=>{ const r=$('#chart').getBoundingClientRect();
    console.log('PMS e.x',e.x,'e.y',e.y,'pageX-rectL',e.pageX-r.left); return false; },
```

Di app: drag ujung sebuah trendline. Amati console: apakah `e.x ≈ pageX - rect.left` (→ container-relative, pakai langsung) atau `e.x ≈ pageX` (→ perlu kurangi `rect.left`). Catat hasilnya; sesuaikan `OFF` di Step 2 (`const OX = <0 atau rect.left>`, `const OY = <0 atau rect.top>`). Default asumsi: container-relative (OX=OY=0).

- [ ] **Step 2: Ganti dengan handler final.** Tepat SEBELUM `klinecharts.registerOverlay({ name:'trendline'` (baris 1711) tambah state:

```js
// state drag trendline presisi (intercept onPressedMoving; klinecharts default meng-snap ke bar)
let tlDrag=null;
```

Lalu di dalam objek template `trendline` (setelah `createPointFigures:{...}` closing, sebelum `});` baris 1729) tambah koma lalu:

```js
  ,
  // Drag PRESISI: klinecharts default mengubah kursor→titik via _coordinateToPoint yg meng-snap
  // ke indeks integer. Dengan return true di onPressedMoving, default itu dilewati dan kita tulis
  // dataIndex PECAHAN sendiri (endpoint) / translasi semua titik (badan garis).
  onPressedMoveStart:(e)=>{ const o=e&&e.overlay; if(o) tlDrag={pts:(o.points||[]).map(p=>Object.assign({},p)), x:e.x, y:e.y}; return false; },
  onPressedMoving:(e)=>{ const o=e&&e.overlay; if(!o||!o.points) return false;
    const OX=0, OY=0;                                   // sesuaikan bila Step 1 menunjukkan page-relative
    const xa=fracAnchorFromPx(e.x-OX), v=pxToValue(e.y-OY);
    if(!xa || v==null) return false;
    const pts=o.points.map(p=>Object.assign({},p));
    const key=e.figureKey||'';
    if(key.indexOf('overlay_figure_point_')===0){       // seret SATU ujung
      const i=e.figureIndex; if(pts[i]) pts[i]={dataIndex:xa.dataIndex, value:v};
    } else {                                            // seret BADAN garis → translasi semua titik
      if(!tlDrag) return false;
      const sx=fracAnchorFromPx(tlDrag.x-OX), sv=pxToValue(tlDrag.y-OY);
      if(!sx || sv==null) return false;
      const dIdx=xa.dataIndex-sx.dataIndex, dV=v-sv;
      for(let i=0;i<pts.length;i++){ const sp=tlDrag.pts[i]; if(!sp) continue;
        const bi=(sp.dataIndex!=null)?sp.dataIndex:fidxOf(sp);
        pts[i]={dataIndex: bi+dIdx, value: (sp.value!=null?sp.value:v)+dV}; }
    }
    try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(_){}
    return true;                                        // lewati snap bawaan klinecharts
  },
  onPressedMoveEnd:(e)=>{ tlDrag=null; try{ if(magnetOn&&e&&e.overlay) refineMagnetPoints(e.overlay.id); }catch(_){}
    try{scheduleSaveDraws();}catch(_){} return false; }
```

- [ ] **Step 3: Verifikasi drag endpoint** — di app: gambar trendline, lalu seret salah satu ujungnya ke posisi antar-bar. Amati: ujung mendarat tepat di kursor & handle bulat menempel di ujung garis (tidak melayang / tidak lompat ke pusat bar). Console setelah drag:

```js
let o=chart.getOverlayById(selectedId); console.log(o.points.map(p=>p.dataIndex));
```

Expected: dataIndex titik yang digeser berubah menjadi nilai **pecahan** sesuai posisi kursor.

- [ ] **Step 4: Verifikasi drag badan garis** — seret bagian tengah garis. Amati: kedua ujung bergerak bersama presisi, panjang/kemiringan tetap.

- [ ] **Step 5: Hapus log Step 1** bila masih ada, pastikan `OX/OY` sudah final.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(trendline): drag endpoint & badan garis presisi via onPressedMoving (skip snap bawaan)"
```

---

### Task 4: Persist & restore — trendline in-data ter-restore sebagai fractional dataIndex

**Files:**
- Modify: `index.html` — `buildDrawsFromArray` mapping titik (baris 3512–3514).

**Interfaces:**
- Consumes: `tsToFracIndex(vt)` (Task 1), `d.name`, `pt.vt`.
- Produces: saat restore, titik `trendline` (in-data & future) → `{dataIndex:<pecahan>, value}`; overlay lain tak berubah. `serializeDraws` sudah memakai `tsOf` (kini via `fidxToTs`) → `vt` akurat.

- [ ] **Step 1: Ubah mapping restore** (baris 3512–3514). Ganti:

```js
    const pts=d.points.map(pt=> pt.vt==null ? {value:pt.value}
      : (lt!=null && pt.vt>lt) ? {dataIndex: li+(pt.vt-lt)/dur, value:pt.value}   // future → dataIndex
      : {timestamp:pt.vt, value:pt.value});
```

menjadi:

```js
    const pts=d.points.map(pt=>{
      if(pt.vt==null) return {value:pt.value};
      if(d.name==='trendline'){ const fi=tsToFracIndex(pt.vt);   // trendline: SELALU dataIndex pecahan (presisi)
        return fi!=null ? {dataIndex:fi, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
      return (lt!=null && pt.vt>lt) ? {dataIndex: li+(pt.vt-lt)/dur, value:pt.value}   // overlay lain: future → dataIndex
        : {timestamp:pt.vt, value:pt.value};
    });
```

- [ ] **Step 2: Verifikasi refresh** — gambar trendline presisi di paruh-kanan candle, tunggu ~1 detik (auto-save), reload halaman. Amati: garis ter-restore di posisi X & harga yang sama (tidak bergeser ke pusat bar). Console:

```js
let o=chart.getOverlayById(drawIds.find(id=>chart.getOverlayById(id)?.name==='trendline'));
console.log(o.points.map(p=>({di:p.dataIndex, ts:p.timestamp})));
```

Expected: `di` pecahan, `ts` undefined.

- [ ] **Step 3: Verifikasi ganti TF** — dengan trendline tergambar, ganti TF (mis. H1→H4→H1). Amati: garis tetap di waktu & harga yang sama tiap TF (mesin `snapshotFuturePoints`/`reanchorFuturePoints` sudah menangani titik dataIndex). 

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(trendline): restore in-data sebagai fractional dataIndex (tahan refresh & ganti TF presisi)"
```

---

### Task 5: Regresi & catat batasan magnet

**Files:**
- Modify: `index.html` — komentar dekat `refineMagnetPoints` (baris 1593) bila perlu.

**Interfaces:** tak ada API baru.

- [ ] **Step 1: Regresi overlay lain** — di app, uji berurutan: gambar **rect**, **fib**, dan **garis horizontal**; drag & pindah TF. Amati: perilakunya **tidak berubah** dari sebelumnya (rect/fib masih snap-ke-bar seperti dulu; tak ada error). Uji juga drag SL/TP posisi (tradeLevel) masih normal.

Expected: tak ada regresi; hanya trendline yang kini presisi.

- [ ] **Step 2: Verifikasi mode live** — aktifkan live, biarkan ≥1 bar baru terbentuk/close dengan trendline tergambar. Amati: trendline tidak bergeser saat bar baru masuk.

- [ ] **Step 3: Catat batasan magnet** — tambah komentar di atas `refineMagnetPoints` (baris 1593):

```js
// CATATAN: titik trendline kini beranchor dataIndex (tanpa timestamp) → refine M5 di bawah
// (yang butuh p.timestamp) menjadi no-op untuk trendline. Magnet saat MENGGAMBAR tetap bekerja
// (snap nilai OHLC via pendingClicks). Penyempurnaan X presisi-M5 untuk trendline = follow-up.
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "docs(trendline): catat batasan magnet-refine pada anchor dataIndex + verifikasi regresi"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 model anchor → Task 2/3/4 (titik jadi dataIndex pecahan di draw/edit/restore). ✓
- Spec §2 jalur menggambar → Task 2. ✓
- Spec §3 jalur edit/drag → Task 3. ✓
- Spec §4 durabilitas → Task 1 (helper) + Task 4 (restore) + mesin snapshot/reanchor eksisting (Task 4 Step 3). ✓
- Spec §5 risiko: koordinat `e.x/y` → Task 3 Step 1; `updatePointPosition` → Global Constraint (index pecahan) + Task 5 Step 2; magnet → Task 5 Step 3. ✓
- Spec verifikasi DoD 1–7 → tersebar di Task 2–5 verifikasi. ✓

**Placeholder scan:** Tidak ada TBD/TODO tanpa kode. Semua step berkode menampilkan kode utuh. `OX/OY` di Task 3 punya nilai default (0) + prosedur penyesuaian eksplisit di Step 1.

**Type consistency:** `fracAnchorFromPx`→`{dataIndex}`, `fidxToTs(idx)`→ms, `tsToFracIndex(vt)`→idx, `tsOf` signature tetap. Nama konsisten antar-task (`tlDrag`, `OX/OY`, `fidxOf`).
