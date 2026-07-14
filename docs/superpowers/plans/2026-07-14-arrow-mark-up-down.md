# Arrow Mark Up & Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah dua tool gambar sekali-klik "Arrow Mark Up" & "Arrow Mark Down" — marker panah kecil berukuran tetap menunjuk atas (hijau) / bawah (merah).

**Architecture:** Dua overlay custom klinecharts single-point (`totalStep:2`) yang menggambar silhouette panah berukuran pixel-tetap di titik klik, warna default dari map `DRAW_STYLE`, dimunculkan di rail via `DRAW_GROUPS`, dan didaftarkan di `PERSIST_DRAW` agar tersimpan/undo-redo. Semua di `index.html`.

**Tech Stack:** Vanilla JS + klinecharts 9.8.10 (UMD), single-file `index.html`.

## Global Constraints

- Semua teks UI (title/tooltip) **bahasa Inggris**; komentar & pesan commit boleh Indonesian.
- Frontend tanpa unit test → verifikasi manual di browser (`PORT=8765 ./luna-trade`).
- `name` tiap tool di `DRAW_GROUPS` **harus** sama persis dengan `name` overlay hasil `registerOverlay`, dan **harus** ada di `PERSIST_DRAW` agar tersimpan & masuk undo/redo.
- Ikuti pola overlay custom yang ada: pakai helper `subBarCoords(overlay,coordinates)` (titik presisi) & `dstyle(overlay)` (resolusi style).
- Warna default: up = `#089981`, down = `#f23645`.
- Ukuran panah konstan dalam pixel (tidak ikut zoom).

---

### Task 1: Arrow Mark Up (end-to-end)

**Files:**
- Modify: `index.html` — overlay (~setelah baris 2275), `DRAW_STYLE` (~baris 2138), `DRAW_GROUPS` grup shapes (~setelah baris 4806), `PERSIST_DRAW` (baris 4478).

**Interfaces:**
- Consumes: helper `subBarCoords(overlay,coordinates)` → array titik `{x,y}`; `dstyle(overlay)` → `{color,size,style,…}`.
- Produces: overlay terdaftar `name:'arrowMarkUp'` (single-point); tool rail `{name:'arrowMarkUp',…}`; entri style `DRAW_STYLE.arrowMarkUp`; entri `PERSIST_DRAW.arrowMarkUp`.

- [ ] **Step 1: Daftarkan overlay `arrowMarkUp`**

Sisipkan setelah blок overlay `callout` (setelah baris 2295, sebelum komentar "state drag trendline"):

```js
// ===================== custom overlay: arrow mark up / down (marker 1-klik, ukuran tetap) =====================
// Silhouette panah berukuran pixel-tetap di titik klik (anchor = ujung/tip panah).
function arrowMarkFigures(dir){ // dir: -1 = up (tip di atas), +1 = down (tip di bawah)
  return ({overlay,coordinates})=>{
    if(!coordinates.length) return [];
    const p=subBarCoords(overlay,coordinates)[0]; const st=dstyle(overlay);
    const H=22, hh=10, hw=7, sw=3;          // tinggi total, tinggi kepala, ½ lebar kepala, ½ lebar batang
    const x=p.x, y=p.y, d=dir;               // tip di (x,y); tumbuh ke arah -d
    const pts=[
      {x:x,      y:y},                        // tip
      {x:x+hw,   y:y+d*hh},                   // bahu kanan
      {x:x+sw,   y:y+d*hh},                   // dalam kanan
      {x:x+sw,   y:y+d*H},                    // bawah kanan
      {x:x-sw,   y:y+d*H},                    // bawah kiri
      {x:x-sw,   y:y+d*hh},                   // dalam kiri
      {x:x-hw,   y:y+d*hh},                   // bahu kiri
    ];
    return [{type:'polygon', attrs:{coordinates:pts}, styles:{style:'fill', color:st.color}}];
  };
}
klinecharts.registerOverlay({ name:'arrowMarkUp',   totalStep:2, needDefaultPointFigure:true, createPointFigures:arrowMarkFigures(-1) });
klinecharts.registerOverlay({ name:'arrowMarkDown', totalStep:2, needDefaultPointFigure:true, createPointFigures:arrowMarkFigures(+1) });
```

(Task 1 mendaftarkan keduanya sekaligus lewat helper; Task 2 hanya menambah rail/style/persist untuk Down.)

- [ ] **Step 2: Tambah warna default `arrowMarkUp` & `arrowMarkDown` ke `DRAW_STYLE`**

Setelah baris `arrow:{color:'#4a71ff',size:2,style:'solid'},` (baris 2138):

```js
  arrowMarkUp:{color:'#089981',size:2,style:'solid'},
  arrowMarkDown:{color:'#f23645',size:2,style:'solid'},
```

- [ ] **Step 3: Tambah tool `arrowMarkUp` ke rail (`DRAW_GROUPS` grup shapes)**

Setelah entri `arrow` (baris 4806), di dalam array `tools` grup `shapes`:

```js
    {name:'arrowMarkUp', title:'Arrow Mark Up', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l6 8h-4v10h-4V11H6z"/></svg>'},
```

- [ ] **Step 4: Daftarkan `arrowMarkUp` di `PERSIST_DRAW`**

Ubah baris 4478 (tambahkan `arrowMarkUp:1`):

```js
  circle:1,ellipse:1,arrow:1,arrowMarkUp:1,callout:1,simpleAnnotation:1,simpleTag:1};
```

- [ ] **Step 5: Verifikasi manual di browser**

Jalankan `PORT=8765 ./luna-trade`, buka chart (login OANDA agar candle termuat). Lalu:
- Buka rail Shapes → pilih "Arrow Mark Up".
- Klik satu titik di chart → muncul panah **hijau menunjuk ke atas**, tip di titik klik.
- Zoom in/out → ukuran panah **tetap**, posisi menempel di harga+waktu.
- Geser marker → ikut pindah; hapus (eraser/Delete) → hilang; undo/redo → benar.
- Reload halaman → marker **ter-restore**.
- DevTools Console → **tak ada error JS**.

Expected: semua poin di atas terpenuhi.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(draw): tool Arrow Mark Up (marker 1-klik hijau ke atas)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Arrow Mark Down (rail + persist)

Overlay `arrowMarkDown` sudah didaftarkan di Task 1 Step 1. Task ini hanya menambah entri rail & persist agar tool-nya bisa dipakai.

**Files:**
- Modify: `index.html` — `DRAW_GROUPS` grup shapes (setelah entri `arrowMarkUp`), `PERSIST_DRAW` (baris 4478).

**Interfaces:**
- Consumes: overlay `arrowMarkDown` (terdaftar di Task 1), style `DRAW_STYLE.arrowMarkDown` (ditambah di Task 1).
- Produces: tool rail `{name:'arrowMarkDown',…}`; entri `PERSIST_DRAW.arrowMarkDown`.

- [ ] **Step 1: Tambah tool `arrowMarkDown` ke rail (`DRAW_GROUPS` grup shapes)**

Tepat setelah entri `arrowMarkUp` yang ditambah di Task 1:

```js
    {name:'arrowMarkDown', title:'Arrow Mark Down', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21l6-8h-4V3h-4v10H6z"/></svg>'},
```

- [ ] **Step 2: Daftarkan `arrowMarkDown` di `PERSIST_DRAW`**

Update baris 4478 sehingga memuat `arrowMarkDown:1` (hasil akhir setelah Task 1 & Task 2):

```js
  circle:1,ellipse:1,arrow:1,arrowMarkUp:1,arrowMarkDown:1,callout:1,simpleAnnotation:1,simpleTag:1};
```

- [ ] **Step 3: Verifikasi manual di browser**

Jalankan `PORT=8765 ./luna-trade`, buka chart. Lalu:
- Buka rail Shapes → pilih "Arrow Mark Down".
- Klik satu titik → muncul panah **merah menunjuk ke bawah**, tip di titik klik.
- Zoom in/out → ukuran tetap; geser/hapus/undo-redo benar; reload → ter-restore.
- Console → tak ada error JS.

Expected: semua poin terpenuhi.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(draw): tool Arrow Mark Down (marker 1-klik merah ke bawah)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Overlay single-point up/down → Task 1 Step 1. ✓
- Warna default hijau/merah → Task 1 Step 2. ✓
- Ukuran pixel-tetap → konstanta H/hh/hw/sw di Task 1 Step 1 (tak pakai jarak/zoom). ✓
- Tool di rail grup shapes, teks Inggris, tanpa shortcut → Task 1 Step 3 & Task 2 Step 1. ✓
- Persistensi/undo-redo (PERSIST_DRAW) → Task 1 Step 4 & Task 2 Step 2. ✓
- Verifikasi manual (klik, zoom, geser, hapus, reload, console) → Task 1 Step 5 & Task 2 Step 3. ✓
- Di luar cakupan (tanpa teks/label, tanpa tag axis, tanpa INSTANT_DROP) → tidak ada task terkait, sesuai. ✓

**Placeholder scan:** tak ada TBD/TODO; semua kode & perintah konkret. ✓

**Type consistency:** nama overlay `arrowMarkUp`/`arrowMarkDown` konsisten di overlay, DRAW_STYLE, DRAW_GROUPS, dan PERSIST_DRAW. Helper `arrowMarkFigures(dir)` dipakai dua kali dengan arg `-1`/`+1`. ✓
