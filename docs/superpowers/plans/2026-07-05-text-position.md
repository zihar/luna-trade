# Posisi Teks Per-Objek Gambar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah konfigurasi posisi teks (horizontal Left/Center/Right + vertikal Top/Middle/Bottom) per-objek untuk objek gambar `rect`, `trendline`, dan `text`.

**Architecture:** Simpan dua field baru (`textAlign`, `textValign`) di bag style per-objek `objStyle[id]` dengan default per-tipe di `DRAW_DEFAULT`. Fungsi render `createPointFigures` tiap overlay membaca nilai efektif via `dstyle(overlay)` dan mengatur anchor + `align`/`baseline` figur teks. UI kontrol berupa chip di popup objek (`showObjPopup`). Re-render & persistensi sudah otomatis lewat `setObjStyle`.

**Tech Stack:** Vanilla JS + klinecharts, di dalam satu file `index.html`. Server: Go (`go run .` → http://localhost:8765). Verifikasi: browser (Playwright MCP) — repo tidak punya harness unit-test JS.

## Global Constraints

- Semua teks yang tampil ke UI berbahasa Inggris (label & chip). Komentar kode boleh Indonesia.
- Default harus menjaga tampilan yang ada sekarang: `rect`=center/middle, `trendline`=center/top, `text`=left/top.
- Tidak mengubah skema `extendData` (tetap string teks polos).
- Non-goals: rotasi teks, offset piksel kustom, posisi teks untuk objek lain.
- Semua perubahan di file `index.html`.

---

### Task 1: Default posisi teks + render `rect`

**Files:**
- Modify: `index.html:1266-1277` (DRAW_DEFAULT)
- Modify: `index.html:1346-1349` (render teks rect)

**Interfaces:**
- Consumes: `dstyle(overlay)` (sudah ada) — mengembalikan merge `DRAW_DEFAULT[name]` + `objStyle[id]`.
- Produces: field style `textAlign ∈ {left,center,right}` & `textValign ∈ {top,middle,bottom}` yang dibaca semua task render berikutnya dan diset oleh Task 4.

- [ ] **Step 1: Tambah default ke DRAW_DEFAULT**

Ubah tiga baris di `index.html:1267-1271` menjadi (hanya `trendline`, `rect`, `text` yang dapat field baru):

```js
  trendline:{color:'#4a71ff',size:1,style:'solid',textAlign:'center',textValign:'top'},
  rect:{color:'#4a71ff',size:1,style:'solid',textAlign:'center',textValign:'middle'},
  fib3:{color:'#4a71ff',size:1,style:'solid'},
  dateRange:{color:'#4a71ff',size:2,style:'solid'},
  text:{color:'',size:13,style:'solid',textAlign:'left',textValign:'top'},
```

- [ ] **Step 2: Ganti blok render teks rect**

Ganti `index.html:1346-1349` (blok `const t=overlay&&overlay.extendData; ... }})); }`) menjadi:

```js
    const t=overlay&&overlay.extendData;                       // teks opsional → posisi via textAlign/textValign
    if(t){ const ha=st.textAlign||'center', va=st.textValign||'middle', pad=4, lines=String(t).split('\n'), lh=15;
      const cx = ha==='left' ? x+pad : ha==='right' ? x+w-pad : x+w/2;
      const cyTop = va==='top' ? y+pad : va==='bottom' ? y+h-pad-(lines.length-1)*lh : (y+h/2)-(lines.length-1)*lh/2;
      lines.forEach((ln,i)=>figs.push({type:'text',attrs:{x:cx,y:cyTop+i*lh,text:ln,align:ha,baseline:va},
        styles:{color:drawTextColor,size:12,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}})); }
```

(Catatan: `st` sudah didefinisikan `const st=dstyle(overlay)` di `index.html:1342`.)

- [ ] **Step 3: Verifikasi di browser**

Jalankan server bila belum: `go run .` lalu buka http://localhost:8765 dan login seperti biasa.

Gunakan Playwright MCP: navigate ke http://localhost:8765, buat objek Rectangle di chart (klik tool rect, tarik kotak), tambah teks lewat "+ Add text" (ketik `RECT`). Lalu di console set posisi & screenshot:

```js
// ambil overlay rect terakhir
const id = drawIds[drawIds.length-1];
setObjStyle(id,{textAlign:'left',textValign:'top'});
```

Expected: teks `RECT` pindah ke pojok kiri-atas kotak. Ulangi dengan `{textAlign:'right',textValign:'bottom'}` → pindah ke pojok kanan-bawah. `{textAlign:'center',textValign:'middle'}` → kembali ke tengah (tampilan lama). Ambil screenshot tiap kali untuk konfirmasi.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(chart): posisi teks per-objek — default + render rect"
```

---

### Task 2: Render `trendline`

**Files:**
- Modify: `index.html:1363-1365` (render teks trendline)

**Interfaces:**
- Consumes: `st.textAlign`, `st.textValign` dari `dstyle(overlay)` (Task 1). Titik garis `a=C[0]`, `b=C[1]` (sudah ada di scope).

- [ ] **Step 1: Ganti blok render teks trendline**

Ganti `index.html:1363-1365` (blok `const t=overlay&&overlay.extendData; if(t){ const mx=... }`) menjadi:

```js
    const t=overlay&&overlay.extendData;
    if(t){ const ha=st.textAlign||'center', va=st.textValign||'top', off=4;
      const px = ha==='left' ? a.x : ha==='right' ? b.x : (a.x+b.x)/2;
      const py = ha==='left' ? a.y : ha==='right' ? b.y : (a.y+b.y)/2;
      const ty = va==='top' ? py-off : va==='bottom' ? py+off : py;
      const bl = va==='top' ? 'bottom' : va==='bottom' ? 'top' : 'middle';
      figs.push({type:'text',attrs:{x:px,y:ty,text:String(t),align:ha,baseline:bl},
        styles:{color:drawTextColor,size:10,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}}); }
```

- [ ] **Step 2: Verifikasi di browser**

Playwright MCP: buat objek Trendline (tarik garis miring), "+ Add text" → ketik `TL`. Di console:

```js
const id = drawIds[drawIds.length-1];
setObjStyle(id,{textAlign:'left',textValign:'bottom'});
```

Expected: teks `TL` pindah ke titik **awal** garis, di **bawah** garis. Ulangi `{textAlign:'right',textValign:'top'}` → titik **akhir** garis, **atas** garis. `{textAlign:'center',textValign:'top'}` → titik tengah di atas garis (tampilan lama). Screenshot tiap kali.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(chart): posisi teks per-objek — render trendline"
```

---

### Task 3: Render `text`

**Files:**
- Modify: `index.html:1560-1564` (render overlay text)

**Interfaces:**
- Consumes: `st.textAlign`, `st.textValign` dari `dstyle(overlay)` (Task 1). `x`, `y0`, `lh`, `lines`, `st` sudah di scope.

- [ ] **Step 1: Ganti blok render overlay text**

Ganti `index.html:1560-1564` (dari `const lines=String(t).split('\n');` sampai penutup `.map(...)`) menjadi:

```js
    const lines=String(t).split('\n');
    const ha=st.textAlign||'left', va=st.textValign||'top';
    const yTop = va==='top' ? y0 : va==='bottom' ? y0-(lines.length-1)*lh : y0-(lines.length-1)*lh/2;
    return lines.map((ln,i)=>({ type:'text',
      attrs:{x, y:yTop+i*lh, text:ln, align:ha, baseline:va},
      styles:{color:(st.color||drawTextColor), size:(st.size||13), backgroundColor:'transparent', borderColor:'transparent',
              paddingLeft:0, paddingRight:0, paddingTop:0, paddingBottom:0} }));
```

- [ ] **Step 2: Verifikasi di browser**

Playwright MCP: buat objek Text (klik tool text, klik chart), ketik dua baris `Hello\nWorld`. Di console:

```js
const id = drawIds[drawIds.length-1];
setObjStyle(id,{textAlign:'right',textValign:'bottom'});
```

Expected: dua baris rata kanan, anchor jadi tepi bawah blok. `{textAlign:'center',textValign:'middle'}` → rata tengah, anchor di tengah blok. `{textAlign:'left',textValign:'top'}` → tampilan lama. Screenshot tiap kali.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(chart): posisi teks per-objek — render text"
```

---

### Task 4: Kontrol UI di popup objek

**Files:**
- Modify: `index.html:3934-3943` (innerHTML + handler `showObjPopup`)
- Modify: `index.html:3939` (clamp tinggi popup)

**Interfaces:**
- Consumes: `st=dstyle(o)` (sudah ada di `showObjPopup`), `hasText` (sudah ada, baris 3929), `DRAW_DEFAULT`, `setObjStyle`, `markOn` (sudah ada).

- [ ] **Step 1: Bangun string chip & sisipkan ke innerHTML**

Di `showObjPopup` tepat setelah baris `const ss=...` (`index.html:3932`), tambahkan:

```js
  const talign=st.textAlign||(DRAW_DEFAULT[o.name]&&DRAW_DEFAULT[o.name].textAlign)||'center';
  const tvalign=st.textValign||(DRAW_DEFAULT[o.name]&&DRAW_DEFAULT[o.name].textValign)||'middle';
  const has=[['left','Left'],['center','Center'],['right','Right']].map(p=>`<button class="pp-chip ${talign===p[0]?'on':''}" data-ha="${p[0]}">${p[1]}</button>`).join('');
  const vas=[['top','Top'],['middle','Middle'],['bottom','Bottom']].map(p=>`<button class="pp-chip ${tvalign===p[0]?'on':''}" data-va="${p[0]}">${p[1]}</button>`).join('');
```

Lalu di rakitan `objPop.innerHTML=(...)`, sisipkan baris berikut tepat sebelum baris `+`<div class="pp-act">...` (`index.html:3937`):

```js
    +(hasText?`<div class="pp-lbl">Horizontal</div><div class="pp-row">${has}</div><div class="pp-lbl">Vertical</div><div class="pp-row">${vas}</div>`:'')
```

- [ ] **Step 2: Naikkan clamp tinggi popup saat hasText**

Ganti `index.html:3939`:

```js
  objPop.style.top =Math.min(cy,window.innerHeight-220)+'px';
```

menjadi:

```js
  objPop.style.top =Math.min(cy,window.innerHeight-(hasText?300:220))+'px';
```

- [ ] **Step 3: Pasang handler klik chip**

Tepat setelah handler `data-st` (`index.html:3943`, baris `objPop.querySelectorAll('[data-st]')...`), tambahkan:

```js
  objPop.querySelectorAll('[data-ha]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textAlign:b.dataset.ha}); markOn('[data-ha]',b); });
  objPop.querySelectorAll('[data-va]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textValign:b.dataset.va}); markOn('[data-va]',b); });
```

- [ ] **Step 4: Verifikasi UI end-to-end di browser**

Playwright MCP: untuk masing-masing objek (rect, trendline, text) yang punya teks, klik-kanan objek → popup muncul. Konfirmasi:
- Muncul dua baris "Horizontal" (Left/Center/Right) dan "Vertical" (Top/Middle/Bottom).
- Chip aktif menandai posisi efektif saat ini.
- Klik chip → teks langsung pindah sesuai (lihat Task 1–3 untuk semantik). Screenshot bukti tiap objek.
- Untuk objek tanpa teks (mis. fib3, garis horizontal) popup TIDAK menampilkan dua baris tersebut.

- [ ] **Step 5: Verifikasi persistensi**

Setelah mengeset posisi di beberapa objek, reload halaman (Playwright `browser_navigate` ke URL yang sama). Expected: posisi teks tiap objek terpulihkan persis (tersimpan lewat `scheduleSaveDraws` di `setObjStyle`). Screenshot sebelum/sesudah reload.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(chart): kontrol UI posisi teks (Horizontal/Vertical) di popup objek"
```

---

## Catatan verifikasi umum

- Objek lama yang dibuat sebelum fitur (tanpa `textAlign`/`textValign` di objStyle tersimpan) otomatis memakai default `DRAW_DEFAULT` → tampil sama seperti sebelumnya. Konfirmasi dengan memuat objek gambar yang sudah ada di `luna.db`/localStorage bila ada.
- Semua label UI harus bahasa Inggris: "Horizontal", "Vertical", "Left", "Center", "Right", "Top", "Middle", "Bottom".
