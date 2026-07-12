# Edit parameter indikator (design)

**Tanggal:** 2026-07-12
**Scope:** `index.html` saja · satu PR kecil (konvensi CLAUDE.md: satu fitur = satu PR)
**Asal:** backlog P1 "UX gap vs TradingView" — indikator kini hanya on/off, TV bisa
edit periode/parameter tiap indikator.

## Masalah

Sistem indikator (`index.html`, blok ~6000-6049) memakai indikator built-in klinecharts
lewat `chart.createIndicator(name, ...)` **tanpa pernah melewatkan `calcParams`** → semua
periode = default library, tak bisa diubah user. `IND_DEFS` hanya `{name, label, overlay}`.
Menu ƒx (`renderIndMenu`) cuma toggle on/off. Persistensi `br_indicators` = `string[]`
(hanya nama). Tujuan: user bisa mengedit parameter tiap indikator ala TradingView, tersimpan
lintas reload.

Keputusan brainstorm:
- **Cakupan: parameter/periode saja** (calcParams). Warna/ketebalan garis TIDAK termasuk (default library).
- **Akses: gear ⚙ per baris** di menu ƒx → popup editor. Klik teks tetap toggle on/off; ⚙
  membuka editor (jika indikator masih off → nyalakan dulu lalu buka).
- **Pendekatan A: editor digerakkan skema** (bukan generik/ hardcoded).

## Model data — skema parameter di `IND_DEFS`

Tiap indikator dapat field `params` dengan dua bentuk (`kind`):

- **`list`** (variadic — MA/EMA/VOL/RSI): daftar periode; tiap angka = satu garis. Bisa
  **+ Add / hapus** garis (minimal 1). Satu label + min/max/step seragam.
  ```js
  {name:'MA', label:'MA — Moving Average', overlay:true,
   params:{kind:'list', label:'Period', def:[5,10,30,60], min:1, max:400, step:1}}
  ```
- **`fixed`** (BOLL/MACD): field bernama tetap, tak bisa tambah/hapus.
  ```js
  {name:'BOLL', label:'BOLL — Bollinger Bands', overlay:true,
   params:{kind:'fixed', fields:[
     {label:'Period', def:20, min:1, max:400, step:1},
     {label:'StdDev', def:2,  min:0.1, max:10, step:0.1}]}}
  {name:'MACD', label:'MACD', overlay:false,
   params:{kind:'fixed', fields:[
     {label:'Short', def:12, min:1, max:400, step:1},
     {label:'Long',  def:26, min:1, max:400, step:1},
     {label:'Signal',def:9,  min:1, max:400, step:1}]}}
  ```

Pemetaan awal (default diverifikasi runtime, lihat "Default"):
- **list:** MA `[5,10,30,60]`, EMA `[6,12,20]`, VOL `[5,10,20]`, RSI `[6,12,24]`
- **fixed:** BOLL `[20,2]`, MACD `[12,26,9]`

`indParams` (state runtime, name → calcParams array) menyimpan nilai efektif tiap indikator
(default skema bila user belum mengubah). Dipakai `addInd` & editor.

## UI editor (popup)

Popup mengambang `.ind-editor` — **reuse** `makeDraggable(el, '.pp-grip')` + `GRIP` +
CSS `.pp-lbl/.pp-row/.pp-act` (nyaris tanpa CSS baru; ikuti pola `showFibPop`/`showChartSet`).

- **Header:** label indikator.
- **`fixed`** → deret `label + <input type=number min max step>` per field.
- **`list`** → satu baris `<input type=number>` per periode + tombol **×** hapus tiap baris
  + **+ Add** (tambah periode baru = nilai terakhir atau default). Minimal 1 baris.
- **Footer:** **Reset to default** → kembalikan calcParams ke `def` skema + re-render editor.
- **Live:** perubahan `oninput`/`onchange` langsung diterapkan (debounce ~150ms untuk
  ketikan cepat). Tak ada tombol Save. Tutup via klik luar / ✕ (pola popup lain: listener
  `mousedown` dokumen + Escape).
- Dibuka via ⚙: kalau `!activeInd[name]` → `addInd(name)` (nyalakan) lalu buka editor.

## Terapkan parameter (live, tanpa recreate)

```js
function setIndParams(name, calcParams){
  indParams[name]=calcParams;
  try{ chart.overrideIndicator({name, calcParams}, activeInd[name]); }catch(e){}
  persistInd();
}
```
- `activeInd[name]` sudah simpan paneId → sub-pane & posisi stabil (tak remove/recreate).
- `addInd(name)` diubah: teruskan `calcParams` tersimpan saat create supaya restore memakai
  parameter user. Bentuk value klinecharts: `createIndicator({name, calcParams}, isStack, paneOptions)`.

## Persistensi + migrasi

`br_indicators` berubah `string[]` → `[{name, calcParams}]`:
```js
// simpan
JSON.stringify(Object.keys(activeInd).map(n=>({name:n, calcParams:indParams[n]||null})))
// muat + migrasi: elemen string (skema lama) → {name:el, calcParams:null}
arr.map(el => typeof el==='string' ? {name:el, calcParams:null} : el)
```
`calcParams:null` = pakai default skema/library. Simpan tiap toggle & tiap ubah parameter.

## Validasi & edge case

- Angka di-clamp ke `min/max` skema; kosong/non-angka → abaikan (pertahankan nilai lama, jangan
  tulis NaN ke klinecharts).
- `list` minimal 1 periode (tombol × baris terakhir dinonaktifkan bila hanya 1).
- Badge ƒx & struktur menu tetap; hanya tambah ⚙ per baris + editor.
- Editor per satu indikator pada satu waktu (buka editor lain → tutup yang sebelumnya, pola
  `textEditorEl`/popup tunggal).

## Default (verifikasi runtime)

Angka default di atas dari pengetahuan klinecharts 9.8.x. Saat implementasi, **konfirmasi via
`chart.getIndicators()`/inspeksi objek indikator** dan selaraskan `def` skema agar 1:1 dengan
library (hindari drift bila versi berbeda). Ini bukan asumsi yang dibiarkan.

## Yang TIDAK dilakukan (YAGNI)

- Tidak mengedit warna/ketebalan garis (styles) — cakupan terpisah.
- Tidak menambah indikator baru (SMA/KDJ/CCI/dll) — cakupan terpisah.
- Tidak menyentuh chart sekunder (`secondaries`) — tak punya indikator teknikal.
- Tidak menambah tombol Save/Cancel — edit live seperti popup properti objek lain.

## Verifikasi (manual, browser — butuh chart ter-load, akun test [[test-account]])

1. `PORT=8765 ./luna-trade`, login akun test → chart candle muncul.
2. ƒx → ⚙ pada MA → ubah salah satu periode → garis MA di chart berubah **live**;
   **+ Add** garis baru muncul; hapus (×) garis; baris terakhir tak bisa dihapus.
3. BOLL → editor menampilkan field bernama **Period / StdDev**; MACD → **Short/Long/Signal**;
   ubah → band/histogram berubah.
4. **Reset to default** → kembali ke default; **Reload** → parameter user tersimpan pulih.
5. Kompat lama: set `localStorage.br_indicators=["MA","RSI"]` (skema lama) → reload → keduanya
   termuat dengan default (tak error).
6. Console tanpa error JS; `node --check` sintaks OK.
