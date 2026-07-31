# Lock objek gambar (lock / lock all) — desain

Tanggal: 2026-07-31 · Status: disetujui, siap diimplementasi

Item **T1.3** di `docs/drawing-tools-gap-plan.md` (Tier 1), setelah T1.1 measure (PR #166) dan
T1.2 keep drawing (PR #168).

## Masalah

Objek gambar gampang kegeser saat pan/zoom, dan satu tekan `Delete` yang tak sengaja bisa
membuang zona yang dipakai berhari-hari. Yang ada sekarang hanya **Hide all** — menyembunyikan
semuanya, bukan melindungi satu objek.

## Perilaku TradingView yang ditiru (diverifikasi)

- Lock ada **per objek**: klik-kanan objek → submenu *"Lock and Hide"*, dan lewat **Object Tree**
  (yang juga menampilkan ikon gembok per objek).
- Objek terkunci **tak bisa kegeser** dan **tak bisa terhapus tak sengaja**.
- Saat menghapus massal, TV **menanyakan** apakah yang terkunci ikut dibuang; ada setelan
  *"Always remove locked drawings"*.
- **Tak ada** tombol "lock all" di toolbar TV — pekerjaan itu dilakukan Object Tree, yang Luna
  belum punya.

Sumber: <https://www.tradingview.com/support/solutions/43000760814-how-to-set-removal-of-locked-drawings/> ·
<https://www.financialtechwiz.com/post/how-to-draw-on-tradingview/> ·
<https://www.tradingview.com/charting-library-docs/latest/ui_elements/object-tree>

## Keputusan desain

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Per objek | Toggle **Lock** di modal Style objek (dibuka lewat klik-kanan / double-click) | Jalur "klik-kanan objek" Luna sudah bermuara ke modal itu; menambah submenu sendiri hanya menduplikasi pintu |
| Massal | Tombol rail **Lock all drawings**, bersebelahan dengan Hide-all | Luna tak punya Object Tree; hide-all sudah jadi tombol rail, jadi lock-all di sana konsisten dengan cara Luna sendiri |
| Proteksi hapus | `Delete`/`Backspace`, eraser, dan Remove-all melewati objek terkunci; tombol Delete di modal dimatikan | Maksud TV ("tak bisa terhapus tak sengaja") tanpa menambah dialog + setelan baru |
| Isyarat visual | Handle titik disembunyikan saat terkunci | Afordansi "bisa digenggam" hilang sesuai kenyataannya; tak perlu menyentuh `createPointFigures` ke-24 tool |
| Persistensi | Ikut `br_draws_<INSTRUMENT>` sebagai field `lock` | Kunci adalah properti objek, sama seperti gaya; tak perlu penyimpanan baru |

## Arsitektur

Frontend saja; tak ada perubahan Go, endpoint, atau skema DB.

### Mesin: properti `lock` klinecharts

Diverifikasi langsung di bundel `klinecharts@9.8.10`:

- Dispatch pressed-move memeriksa `a.lock || onPressedMoving(...)` — **short-circuit**. Jadi untuk
  objek terkunci, hook `onPressedMoving` milik Luna (`delHooks`) **tak pernah dipanggil** dan
  gerakan bawaan klinecharts juga dilewati → objek benar-benar tak bisa digeser, baik ujungnya
  maupun badannya, termasuk jalur `performEventPressedMove` (rect/fib/posisi).
- `lock` **tidak** menggerbang klik/hover/select → modal Style tetap bisa dibuka. Itu justru
  yang kita butuhkan: modal adalah jalan untuk membuka kunci.
- `setStyles` melakukan **merge** (`A(this.styles, t)`), bukan replace → override
  `styles:{point:HIDDEN_POINT}` untuk isyarat visual tak menghapus gaya garis, dan perubahan
  gaya lewat modal tak menghidupkan kembali handle-nya.
- `chart.overrideOverlay({id, lock})` memanggil `setLock` → jalur resmi, bukan menyentuh internal.

### Berkas

| File | Perubahan |
|---|---|
| `js/draw-lock.js` | **baru** — seluruh logika kunci: `isLocked`, `setDrawLock`, `toggleDrawLock`, `setLockAllDrawings`, `lockedDrawCount`, `removeAllDrawings`, `blockedByLock` |
| `index.html` | satu `<script src="/js/draw-lock.js">` setelah `draw-persist.js` |
| `js/draw-persist.js` | `serializeDraws()` menyimpan `lock`; `buildDrawsFromArray()` memulihkannya + isyarat visual |
| `js/draw-style-modal.js` | tombol **Lock/Unlock** di footer modal; tombol Delete dimatikan saat terkunci |
| `js/draw-rail.js` | tombol `#lockAllBtn` + `syncLockAllBtn()` |
| `js/keyboard.js` | `Delete`/`Backspace` melewati objek terkunci |
| `js/draw-tools.js` | eraser (`onClick`) melewati objek terkunci |
| `js/context-menu.js` | tiga item "Remove … drawings" memakai `removeAllDrawings()` |
| `tests/smoke/lock-drawing.spec.js` | **baru** |

### `clearDrawings()` TIDAK diubah — ini yang paling mudah salah

`clearDrawings()` bukan hanya aksi pengguna. Ia dipakai:

- `applyDrawsSnapshot()` (`js/draw-undo.js:14`) — undo/redo: bersihkan lalu bangun ulang dari snapshot;
- `loadChart()` (`js/load-chart.js:80`) — ganti instrumen.

Kalau ia mulai melewati objek terkunci, **undo akan menghasilkan objek dobel** (yang terkunci tetap
ada, lalu snapshot menambahkannya lagi) dan ganti instrumen akan menyeret gambar instrumen lama.
Karena itu:

- `clearDrawings()` tetap **tanpa syarat** (jalur internal),
- aksi pengguna memakai `removeAllDrawings()` yang baru: hanya membuang yang tak terkunci, dan
  memberi toast `N locked drawing(s) kept` bila ada yang dilewati.

### Isyarat visual & pemulihan

`applyLockVisual(id, on)` meng-override `styles:{point: on?HIDDEN_POINT:OVERLAY_POINT}` — dua
konstanta yang sudah ada di `js/chart-styles.js` dan sudah dipakai jalur menggambar. Dipanggil dari
`setDrawLock()` dan dari `buildDrawsFromArray()` saat restore, supaya objek yang dimuat dalam keadaan
terkunci langsung tampil tanpa handle.

### Tombol rail

Pola `hideDrawBtn`: `button.dtool` + kelas `armed` + `title` Inggris. Statusnya **turunan**, bukan
state sendiri: `armed` = ada gambar dan semuanya terkunci. `syncLockAllBtn()` dipanggil setelah tiap
perubahan (kunci per objek, lock-all, restore, hapus). Klik = kunci semua bila masih ada yang
terbuka; kalau semua sudah terkunci, klik = buka semua.

### Undo/redo

Mengunci/membuka kunci memanggil `scheduleSaveDraws()`, jadi ia masuk snapshot dan bisa di-undo
seperti perubahan gaya. Tak ada penanganan khusus.

## Verifikasi

`tests/smoke/lock-drawing.spec.js` (murah, ikut gerbang PR) — semua lewat perilaku, bukan
memeriksa flag saja:

1. **Terkunci tak bisa digeser**: gambar trendline, kunci lewat modal, coba geser badannya →
   titik-titiknya identik (pembanding: objek tak terkunci bergeser dengan gestur yang sama).
2. **`Delete` melewati objek terkunci** → objek masih ada; setelah dibuka kuncinya, `Delete` bekerja.
3. **Eraser melewati objek terkunci** → klik eraser di atasnya tak menghapus.
4. **Remove-all menyisakan yang terkunci**: dua objek (satu terkunci) → menu trash "Remove … drawings"
   → tinggal satu, yaitu yang terkunci.
5. **Lock all / unlock all** lewat tombol rail: semua `lock` true & tombol `armed`; klik lagi → semua false.
6. **Bertahan setelah reload**: kunci → reload → `lock` masih true dan handle tetap tersembunyi.
7. **Undo tak menghasilkan dobel** (penjaga jebakan `clearDrawings`): kunci objek A, gambar objek B,
   `Ctrl+Z` → jumlah overlay kembali 1, bukan 2.

Sebelum push: `npx playwright test tests/smoke --project=hermetic`, ditambah `tests/drawing` sekali
karena perubahan menyentuh `delHooks.onClick`, jalur persist, dan modal yang dipakai semua tool.

## Di luar cakupan (dicatat)

- **Object Tree** (panel daftar objek dengan gembok & mata per objek) — Tier 2 di gap plan; itu tempat
  TV menaruh lock massal, dan bila kelak dibuat, tombol rail ini tetap berguna sebagai jalan cepat.
- **Dialog "ikut hapus yang terkunci?" + setelan "Always remove locked drawings"** ala TV — sengaja
  tak dibuat; Remove-all cukup menyisakan yang terkunci dan mengabarkannya lewat toast.
- **Hide per objek** (saudara lock di submenu TV) — Luna baru punya hide-all; PR kecil sendiri.
