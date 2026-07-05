# Warna & transparansi per-objek Long/Short Position — desain

**Tanggal:** 2026-07-05
**Cakupan:** Setiap objek Long/Short Position bisa diubah warna & transparansi zona Profit/Target dan zona Stop/Loss secara terpisah, per objek, via popup. Garis Entry, pill DIR/RR, dan pill Entry netral TIDAK termasuk.

## Latar

`posFigures(dir)` (index.html) merender Long/Short Position memakai konstanta global tetap:
`POS_GREEN='#089981'`, `POS_RED='#f23645'`, `POS_GBG='rgba(8,153,129,0.12)'`, `POS_RBG='rgba(242,54,69,0.12)'`.
Objek posisi belum punya popup: `showObjPopup` & `onDoubleClick` di-skip karena `longPosition`/`shortPosition` tak ada di `DRAW_DEFAULT`.

Objek gambar lain sudah punya style per-objek via `objStyle`/`dstyle`, popup generik (`showObjPopup`), persist (`serializeDraws`/`restoreDraws` menyimpan `style`), dan `setObjStyle()` yang memicu `scheduleSaveDraws()` (jadi otomatis masuk undo/redo).

## Model style

Tambah default ke `DRAW_DEFAULT`:
```js
longPosition:  { tgtColor:'#089981', tgtAlpha:12, stopColor:'#f23645', stopAlpha:12 },
shortPosition: { tgtColor:'#089981', tgtAlpha:12, stopColor:'#f23645', stopAlpha:12 },
```
- `tgtColor`/`stopColor`: hex warna zona profit/stop (pill solid + basis fill).
- `tgtAlpha`/`stopAlpha`: transparansi fill zona dalam persen 0–100.

`dstyle()` sudah generik (merge `DRAW_DEFAULT[name]` + `objStyle[id]`), tak perlu diubah. Default = warna saat ini, jadi tampilan lama tak berubah.

## Perubahan

### 1. Rendering `posFigures`
Baca `const st=dstyle(overlay)` lalu:
- fill zona Target: `st.tgtColor + alphaHex(st.tgtAlpha)`; pill Target: `st.tgtColor`.
- fill zona Stop: `st.stopColor + alphaHex(st.stopAlpha)`; pill Stop: `st.stopColor`.
- Garis Entry tetap `#9aa4b2`; pill DIR/RR & Entry tetap `rgba(20,28,40,0.92)`.

Konstanta `POS_GREEN`/`POS_RED`/`POS_GBG`/`POS_RBG` masih dipakai di tempat lain (garis SL/TP live, dsb.) → biarkan; `posFigures` saja yang beralih ke `dstyle`.

### 2. Popup posisi (`showObjPopup`)
Tambah `longPosition`/`shortPosition` ke `DRAW_DEFAULT` (mengaktifkan double-click & klik-kanan yang sudah men-gate lewat `DRAW_DEFAULT[name]`).
Di `showObjPopup`, cabang khusus bila `o.name` posisi → render (pola editor Fibonacci):
- **Profit / Target**: `<input type="color" value=st.tgtColor>` + `<input type="range" min=0 max=100 value=st.tgtAlpha>` + label `%`.
- **Stop / Loss**: `<input type="color" value=st.stopColor>` + slider transparansi.
- Tombol **Delete** (reuse `#ppDel`).

Handler: color `oninput` → `setObjStyle(o.id,{tgtColor:..})` dst.; slider `oninput` → update label + `setObjStyle(o.id,{tgtAlpha:+val})`. Objek non-posisi tetap popup generik lama.

### 3. Persist & undo/redo
Tanpa kode tambahan: `setObjStyle` → `scheduleSaveDraws` → `serializeDraws` simpan `style`; `restoreDraws` pulihkan `objStyle[id]=d.style`. Perubahan warna otomatis persist per-instrumen & masuk riwayat undo/redo.

## Verifikasi (manual, browser)
1. Gambar Long → double-click → ubah warna Profit → zona target berubah warna.
2. Geser slider transparansi Profit → opacity fill berubah live.
3. Ubah warna & transparansi Stop → zona stop berubah.
4. Undo → style balik; Redo → style maju.
5. Reload / ganti instrumen lalu balik → style tersimpan.
6. Objek gambar lain (trendline/rect) → popup generik tetap seperti semula (tak regresi).
