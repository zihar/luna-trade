# Undo / Redo objek gambar — desain

**Tanggal:** 2026-07-05
**Cakupan:** Undo/redo untuk objek gambar chart saja (tambah, hapus, geser/edit titik, ubah style). Bar Replay & posisi paper TIDAK termasuk.

## Latar

`index.html` (single-file) sudah punya mesin persist gambar per-instrumen:
- `serializeDraws()` → array `{name, points, extendData, style}` (state penuh gambar).
- `restoreDraws()` → baca localStorage, bangun ulang overlay via `chart.createOverlay`.
- `saveDraws()` / `scheduleSaveDraws()` (debounce 350ms) dipanggil dari `onDrawEnd`, `onRemoved`, edit style, dsb.
- `suppressDrawSave` menahan save + efek samping saat pembangunan programatik.

Mesin ini jadi fondasi undo/redo berbasis snapshot.

## Pendekatan: snapshot-based

Setiap perubahan gambar meng-commit satu snapshot state. Undo/redo = restore snapshot dari/ke stack. Dipilih karena reuse kode restore, seragam untuk semua jenis aksi, dan debounce membuat satu drag = satu langkah undo. (Alternatif command-based ditolak: boros kode & banyak edge case per tipe overlay.)

## Perubahan

### 1. State (dekat `drawIds` / blok persist)
```js
let drawUndo=[], drawRedo=[], drawSnap=null;
const DRAW_HISTORY_MAX=60;
```
`drawSnap` = JSON string snapshot terakhir yang di-commit.

### 2. Refactor `restoreDraws()`
Ekstrak badan pembangunan overlay jadi `buildDrawsFromArray(arr)`; `restoreDraws()` membaca localStorage lalu memanggilnya.

### 3. Rekam history di `saveDraws()`
Setelah menghitung `serializeDraws()`:
- tulis localStorage seperti biasa;
- jika `json !== drawSnap`: `drawUndo.push(drawSnap)` (bila `drawSnap!=null`), cap panjang ke `DRAW_HISTORY_MAX` (buang tertua), `drawSnap=json`, `drawRedo=[]`, `syncUndoRedoBtns()`.

`saveDraws()` sudah early-return saat `suppressDrawSave`, jadi apply snapshot tidak menambah history.

### 4. `applyDrawsSnapshot(arr)`
`suppressDrawSave=true` → `clearDrawings()` → `buildDrawsFromArray(arr)` → pulihkan flag → `clearTimeout(drawSaveTimer)` → tulis `arr` ke localStorage.

### 5. `undoDraw()` / `redoDraw()`
- Undo: jika `drawUndo` kosong → keluar; `drawRedo.push(drawSnap)`; `drawSnap=drawUndo.pop()`; `applyDrawsSnapshot(JSON.parse(drawSnap))`; `syncUndoRedoBtns()`.
- Redo: simetris (tukar stack).

### 6. UI — tombol di `.tfbar` samping `#replayPick` (baris 826)
`<button id="undoBtn">↩</button><button id="redoBtn">↪</button>` dengan `title` berisi hint shortcut. `syncUndoRedoBtns()` set `disabled` sesuai panjang stack.

### 7. Keyboard (handler keydown baris 3794)
- `Ctrl/Cmd+Z` (tanpa Shift) → `undoDraw()`.
- `Ctrl/Cmd+Shift+Z` atau `Ctrl+Y` → `redoDraw()`.
Handler sudah skip saat fokus di INPUT/SELECT/TEXTAREA.

### 8. Reset per-instrumen
Di jalur `loadInit(true)` setelah `restoreDraws()`: `drawUndo=[]; drawRedo=[]; drawSnap=JSON.stringify(serializeDraws())`; `syncUndoRedoBtns()`. History gambar bersifat per-instrumen.

## Verifikasi (manual, browser)
1. Gambar objek → undo hilang → redo muncul lagi.
2. Geser titik → undo balik ke posisi lama.
3. Hapus (Delete / trash "hapus semua") → undo memunculkan lagi.
4. Aksi baru setelah undo → redo stack kosong.
5. Ganti instrumen → tombol undo/redo disabled (history reset), gambar instrumen tak tercampur.
6. Shortcut Ctrl/Cmd+Z / Ctrl+Y bekerja; tak mengganggu undo teks di input.
