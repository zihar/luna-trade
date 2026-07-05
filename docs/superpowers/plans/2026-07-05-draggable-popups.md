# Popup Config Draggable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat kelima popup konfigurasi melayang bisa digeser (drag) lewat pegangan di bagian atas, dengan mengekstrak pola drag yang sudah ada menjadi satu helper reusable.

**Architecture:** `posEditEl` sudah punya drag berbasis pointer-events (`pointerdown`/`move`/`up` + `setPointerCapture`) via IIFE inline. Ekstrak pola itu menjadi `makeDraggable(el, handleSel)` yang memasang listener **pada elemen popup** (delegasi + `el.setPointerCapture`) sehingga tahan rebuild `innerHTML`. Popup tanpa header mendapat bilah grip `.pp-grip` yang di-prepend ke tiap template `innerHTML`; `posEditEl` memakai header `.pe-head` yang sudah ada.

**Tech Stack:** Vanilla JS + klinecharts, satu file `index.html`. Server: Go (`go run .` → http://localhost:8765). Verifikasi: browser (Playwright MCP) di level cabang — repo tidak punya harness unit-test JS.

## Global Constraints

- Semua teks yang tampil ke UI berbahasa Inggris. (Fitur ini tak menambah teks UI; grip hanya indikator titik.)
- Tidak persisten: fungsi show tiap popup tetap menimpa `left/top` (buka di titik kursor). Drag hanya berlaku selama popup terbuka.
- Klik kontrol (tombol/slider/warna/chip/checkbox/input) tidak boleh memicu drag; tombol ✕ pada `posEditEl` tetap menutup panel.
- Popup tidak menutup saat mulai drag (grip/handle ada di dalam popup → lolos cek `contains` pada handler klik-luar).
- Semua perubahan di file `index.html`.

---

### Task 1: Helper `makeDraggable` + CSS grip + refactor `posEditEl`

**Files:**
- Modify: `index.html:531` (tambah CSS `.pp-grip` setelah `.objpop.show`)
- Modify: `index.html` (tambah fungsi `makeDraggable` tepat sebelum `function buildPosEditPanel(){`, ~baris 2525)
- Modify: `index.html:2559-2575` (ganti IIFE drag inline dengan panggilan `makeDraggable`)

**Interfaces:**
- Produces: `function makeDraggable(el, handleSel)` — memasang perilaku drag pointer-based pada `el`; drag dimulai hanya saat `pointerdown` mengenai elemen yang cocok `handleSel` dan bukan kontrol interaktif. Dipakai Task 2. CSS class `.pp-grip` (bilah pegangan) & `.dragging` (state).

- [ ] **Step 1: Tambah CSS grip**

Sisipkan tepat setelah `index.html:531` (`.objpop.show{ display:block; }`):

```css
  /* pegangan drag untuk popup config tanpa header (objpop/fibpop/chartSet/pos-confirm) */
  .pp-grip{ display:flex; align-items:center; justify-content:center; height:14px; margin:-2px 0 8px;
            border-bottom:1px solid var(--border); cursor:grab; user-select:none; touch-action:none; }
  .pp-grip::before{ content:'\2059\2059\2059'; color:var(--muted); font-size:11px; letter-spacing:3px; line-height:1; }
  .objpop.dragging, .fibpop.dragging{ cursor:grabbing; }
  .pp-grip:active{ cursor:grabbing; }
```

- [ ] **Step 2: Tambah fungsi `makeDraggable`**

Sisipkan tepat sebelum `function buildPosEditPanel(){` (`index.html`, ~2525):

```js
// drag popup config: satu listener di elemen popup (delegasi) → tahan rebuild innerHTML.
// Drag hanya dari handleSel; kontrol interaktif dikecualikan. Non-persisten (show menimpa left/top).
function makeDraggable(el, handleSel){
  let drag=false, sx=0, sy=0, ox=0, oy=0;
  el.addEventListener('pointerdown', e=>{
    if(!e.target.closest(handleSel)) return;
    if(e.target.closest('button,input,select,textarea,label,a')) return;   // klik kontrol ≠ drag
    const r=el.getBoundingClientRect();
    drag=true; sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
    el.style.left=ox+'px'; el.style.top=oy+'px';
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    el.classList.add('dragging'); e.preventDefault();
  });
  el.addEventListener('pointermove', e=>{ if(!drag) return;
    let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    nx=Math.max(0, Math.min(window.innerWidth - el.offsetWidth, nx));
    ny=Math.max(0, Math.min(window.innerHeight - 36, ny));   // sisakan ≥36px agar handle popup tinggi tetap terjangkau
    el.style.left=nx+'px'; el.style.top=ny+'px';
  });
  const stop=e=>{ if(!drag) return; drag=false; el.classList.remove('dragging');
    try{ el.releasePointerCapture(e.pointerId); }catch(_){} };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
```

- [ ] **Step 3: Ganti IIFE drag inline `posEditEl`**

Ganti seluruh blok `index.html:2559-2575` (IIFE `(function(){ const head=$$('.pe-head'); ... })();`) dengan satu baris:

```js
  makeDraggable(posEditEl, '.pe-head');
```

(Header `.pe-head` sudah bergaya `cursor:move; touch-action:none;` dan `.pe-head button{cursor:pointer}` di `index.html:535-536` — tak perlu ubah CSS itu.)

- [ ] **Step 4: Verifikasi statis**

- Re-Read region CSS baru, fungsi `makeDraggable`, dan lokasi bekas IIFE — pastikan IIFE lama benar-benar terhapus (tak ada sisa `head.addEventListener('pointerdown'...`) dan diganti panggilan `makeDraggable(posEditEl,'.pe-head')`.
- Konfirmasi `makeDraggable` adalah deklarasi fungsi top-level (ter-hoist) sehingga panggilan di Task 2 (yang posisinya lebih awal & lebih akhir di file) tetap valid.
- Cek kurung/kurawal seimbang.
- Jalankan `grep -n "\$\$('.pe-head')" index.html` → Expected: tidak ada hasil (IIFE lama sudah hilang).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(ui): helper makeDraggable + refactor drag panel Edit Position"
```

---

### Task 2: Terapkan grip drag ke 4 popup config lain

**Files:**
- Modify: `index.html:2383` (posConfirmEl innerHTML) + lokasi pembuatan `posConfirmEl` (~2382)
- Modify: `index.html:3947` (objPop innerHTML — showObjPopup) & `index.html:3968` (objPop innerHTML — showPosPopup) + lokasi pembuatan `objPop` (~3933)
- Modify: `index.html:3992` (fibPop innerHTML) + lokasi pembuatan `fibPop` (~3989)
- Modify: `index.html:4042` (chartSet innerHTML) + lokasi pembuatan `chartSet` (~4036)
- Modify: `index.html` (tambah konstanta `GRIP` sekali, dekat definisi `makeDraggable`)

**Interfaces:**
- Consumes: `makeDraggable(el, handleSel)` dan class `.pp-grip` dari Task 1.

- [ ] **Step 1: Tambah konstanta `GRIP`**

Sisipkan tepat setelah fungsi `makeDraggable` (dari Task 1, ~2525):

```js
const GRIP='<div class="pp-grip"></div>';   // bilah pegangan drag untuk popup tanpa header
```

- [ ] **Step 2: objPop — prepend GRIP di dua cabang innerHTML + pasang drag**

Di `index.html:3947`, ubah **hanya** awal assignment (RHS sudah berupa rantai `(A)+B+C+…`, jadi cukup menambah `GRIP+` di depan — tanpa kurung tambahan, tanpa mengubah akhir rakitan). Dari:

```js
  objPop.innerHTML=(isFib?'':`<div class="pp-lbl">Color</div><div class="pp-row">${cols}</div>`)
```

menjadi:

```js
  objPop.innerHTML=GRIP+(isFib?'':`<div class="pp-lbl">Color</div><div class="pp-row">${cols}</div>`)
```

Baris-baris `+...` di bawahnya (Tebal, Gaya garis, posisi teks, pp-act) TIDAK diubah.

Di `index.html:3968` (cabang `showPosPopup`), ubah:

```js
  objPop.innerHTML=
     `<div class="pp-lbl">Profit / Target</div>`
```

menjadi:

```js
  objPop.innerHTML=GRIP+
     `<div class="pp-lbl">Profit / Target</div>`
```

(Sisa rantai `+...` di bawahnya tetap; `GRIP+` di depan cukup karena seluruhnya satu ekspresi penjumlahan string.)

Di lokasi pembuatan `objPop` (`index.html:3933`, baris `const objPop=document.createElement('div'); objPop.className='objpop'; document.body.appendChild(objPop);`), tambahkan setelahnya:

```js
makeDraggable(objPop, '.pp-grip');
```

- [ ] **Step 3: fibPop — prepend GRIP + pasang drag**

Di `index.html:3992`, ubah:

```js
  fibPop.innerHTML=`<div class="pp-lbl">Fibonacci Levels</div>${rows}`
```

menjadi:

```js
  fibPop.innerHTML=GRIP+`<div class="pp-lbl">Fibonacci Levels</div>${rows}`
```

Di lokasi pembuatan `fibPop` (`index.html:3989`, `const fibPop=document.createElement('div'); fibPop.className='fibpop'; document.body.appendChild(fibPop);`), tambahkan setelahnya:

```js
makeDraggable(fibPop, '.pp-grip');
```

- [ ] **Step 4: chartSet — prepend GRIP + pasang drag**

Di `index.html:4042`, ubah:

```js
  chartSet.innerHTML=`<div class="pp-lbl" style="font-weight:600;color:var(--txt)">⚙ Setting chart</div>`
```

menjadi:

```js
  chartSet.innerHTML=GRIP+`<div class="pp-lbl" style="font-weight:600;color:var(--txt)">⚙ Setting chart</div>`
```

Di lokasi pembuatan `chartSet` (`index.html:4036`, `const chartSet=document.createElement('div'); chartSet.className='objpop'; document.body.appendChild(chartSet);`), tambahkan setelahnya:

```js
makeDraggable(chartSet, '.pp-grip');
```

- [ ] **Step 5: posConfirmEl — prepend GRIP + pasang drag**

Di `index.html:2383`, ubah:

```js
  posConfirmEl.innerHTML=`<div class="pc-msg">${msg}</div><div class="pc-act"><button class="pc-no">Batal</button><button class="pc-yes">${yesLabel}</button></div>`;
```

menjadi:

```js
  posConfirmEl.innerHTML=GRIP+`<div class="pc-msg">${msg}</div><div class="pc-act"><button class="pc-no">Batal</button><button class="pc-yes">${yesLabel}</button></div>`;
```

Di lokasi pembuatan `posConfirmEl` (`index.html:2382`, baris `if(!posConfirmEl){ posConfirmEl=document.createElement('div'); posConfirmEl.className='objpop pos-confirm'; document.body.appendChild(posConfirmEl); }`), tambahkan pemanggilan `makeDraggable` **di dalam** blok `if` itu, setelah `appendChild`, agar hanya dipasang sekali:

```js
  if(!posConfirmEl){ posConfirmEl=document.createElement('div'); posConfirmEl.className='objpop pos-confirm'; document.body.appendChild(posConfirmEl); makeDraggable(posConfirmEl,'.pp-grip'); }
```

- [ ] **Step 6: Verifikasi statis**

- Re-Read tiap lokasi yang diubah; pastikan setiap `innerHTML` popup diawali `GRIP+` (objPop dua cabang, fibPop, chartSet, posConfirmEl) dan tiap elemen dipasang `makeDraggable(...,'.pp-grip')` **sekali** di titik pembuatan.
- Untuk `objPop` cabang `showObjPopup` (3947): pastikan hanya `GRIP+` yang ditambahkan di depan `(isFib?...` dan akhir rakitan (baris pp-act) TIDAK berubah — keseimbangan kurung persis sama seperti sebelum edit.
- Telusuri keseimbangan backtick/kurung tiap baris yang diubah.
- `grep -n "GRIP+" index.html` → Expected: 5 hasil (objPop×2, fibPop, chartSet, posConfirmEl).
- `grep -n "makeDraggable(" index.html` → Expected: 6 hasil (definisi + posEditEl dari Task 1 + 4 popup di task ini... yakni: 1 pemanggilan posEditEl, 4 pemanggilan di sini; definisi fungsi tidak dihitung sebagai pemanggilan `makeDraggable(` bila ditulis `function makeDraggable(el, handleSel)`). Konfirmasi ada tepat 5 baris berpola `makeDraggable(<el>, '<sel>')`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(ui): semua popup config bisa di-drag lewat grip header"
```

---

## Verifikasi runtime (level cabang, dilakukan pengontrol setelah semua task)

Server: `go run .` → http://localhost:8765 (sudah login di browser). Via Playwright MCP:

- Untuk tiap popup (objPop style, objPop Long/Short Position, fibPop, chartSet, posConfirmEl, posEditEl): buka popup, drag lewat grip/header, lepas → popup pindah & berhenti di posisi lepas; di-drag ke pojok tetap tak keluar viewport (min. sebagian handle terlihat).
- Klik kontrol di dalam popup (warna, chip, slider, checkbox, tombol) tetap berfungsi & tidak memicu drag.
- Tombol ✕ pada `posEditEl` menutup panel, bukan drag.
- Popup tidak menutup saat mulai drag.
- Tutup lalu buka lagi → muncul di titik kursor/objek (tidak lengket).
- Setelah rebuild innerHTML (tambah/hapus level di fibPop; ganti antar objek di objPop) popup masih bisa di-drag.
- Cek console: nol error.
