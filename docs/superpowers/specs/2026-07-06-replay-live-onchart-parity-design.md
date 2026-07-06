# Spec: Menyatukan trade Bar Replay dengan sistem posisi on-chart Live

Tanggal: 2026-07-06
File terdampak: `index.html` (semua perubahan client-side; tidak ada perubahan server)

## Latar belakang & masalah

Aplikasi punya **dua sistem interaksi posisi di atas chart** yang berkembang terpisah:

- **Live/server** (`SP.positions`) — kaya: garis entry + pill P&L live + tombol × close
  (`confirmClosePos` → `/api/close`), chip +SL/+TP & ×hapus, drag SL/TP dengan mini-confirm,
  dan popup editor (`openPositionEditor` / `renderPosEdit`, simpan via `/api/position/sltp`).
  Kunci: `drawPaperLines`, `posLevel`, `renderPosDom`, `openPositionEditor` (~index.html:2312–2650).
- **Replay/client** (`trade`) — minim: `drawTradeLines`/`tradeLevel` (index.html:2295–2310)
  menggambar garis entry/SL/TP yang bisa di-drag (drag SL/TP/entry langsung ubah `trade`),
  TANPA pill P&L, TANPA tombol close on-chart, TANPA chip +SL/+TP, TANPA popup editor.
  Close hanya lewat tombol tabel / Close All / order box.

Akibatnya perilaku di Bar Replay terasa berbeda & membingungkan dibanding Live: tak bisa
menutup posisi langsung dari garis entry, dan pengelolaan SL/TP tak sekaya Live.

Selain itu ada bug lama: posisi Live yang dibuka sebelum masuk replay jadi tak terkelola
selama replay. Keputusan: **selama replay, posisi Live disembunyikan** ("dulu saja" agar
tidak membingungkan) — dikelola dengan keluar dari replay.

## Tujuan

Trade Bar Replay berperilaku **sama seperti posisi Live** di chart, dengan **satu basis
kode on-chart** (pakai ulang sistem Live), dan kopling ke server terisolasi di sedikit
titik cabang. Perilaku Live yang sudah ada **tidak boleh berubah**.

## Keputusan desain (disepakati)

- Pendekatan: **pakai ulang UI Live** untuk trade replay (bukan menduplikasi sistem replay).
- Selama replay, posisi Live **disembunyikan** (chart & tabel).
- Entry replay **tetap bisa di-drag** (khas replay); entry Live tetap non-draggable.
- **Tanpa partial close** untuk replay (hapus tombol "Close ½"); tak ada partial on-chart.

## Arsitektur

### 1. Satu sistem on-chart, dua sumber data

- Tambah `currentPositions()`:
  - Live (`spActive()`): kembalikan `SP.positions`.
  - Replay: kembalikan `trade ? [replayPos()] : []`.
- `replayPos()` memetakan `trade` → objek berbentuk-posisi:
  - `id: REPLAY_ID` (sentinel `-1`), `src:'replay'`, `instrument: trade.instrument`,
    `dir`, `units`, `entry`, `sl`, `tp`,
    `price: currentCandle()?.close ?? trade.entry`,
    `unrealizedPl: pnlUsd(trade.dir, trade.entry, price, trade.units)`,
    `margin: units*entry*quoteToUsd(entry)/100`.
  - Posisi server tetap `src:'live'` (id ≥ 0) — tak perlu field `src` eksplisit; cabang
    ditentukan `id===REPLAY_ID`.
- `posById(id)` dan `drawPaperLines()` iterasi `currentPositions()` (bukan `SP.positions`).
- `drawPaperLines()` **hapus early-return `!spActive()`** agar menggambar di kedua mode.
  Di Live tak ada perubahan perilaku (`currentPositions()===SP.positions`).

### 2. Routing aksi berdasarkan sumber (satu-satunya kopling server)

Cabang `id===REPLAY_ID` di tiga tempat:

- **Close** — `confirmClosePos(id, anchor)`: replay → `closeTrade(currentCandle().close,
  currentCandle().timestamp)`; live → `spClose(id)` (tak berubah).
- **Simpan SL/TP** — `savePosLevel(id,kind,v)` dan `commitPosSLTP()`: replay → set
  `trade[kind]=v` (+ `recalcRisk()`), `drawPaperLines()`, tanpa fetch & tanpa `spSync`;
  live → `/api/position/sltp` (tak berubah).
- **Buka editor** — `openPositionEditor(id)`: bangun `editPos` dari `currentPositions().find`
  (jalan untuk keduanya). Untuk replay, `editPos.id=REPLAY_ID` dan Confirm memanggil
  `commitPosSLTP` yang sudah bercabang.

### 3. Ganti sistem gambar replay lama

- Trade replay digambar oleh `drawPaperLines()` terpadu (pill P&L + × close + drag SL/TP +
  chip +SL/+TP + popup editor).
- Pemanggil `drawTradeLines()` (index.html:1909, 2215, 2705) → ganti `drawPaperLines()`.
  `drawTradeLines`/`tradeLevel`/`tradeLineInfo` dipensiunkan (boleh dihapus atau jadikan
  `drawTradeLines = drawPaperLines`).
- Pastikan render/step memanggil `drawPaperLines()` agar pill P&L & editor ikut ter-update
  saat bar maju (baris 1909 adalah hook repaint replay).

### 4. Entry draggable khusus replay

- `posLevel(p,'entry',draggable)`: saat menggambar entry, `draggable = (p.id===REPLAY_ID)`.
  Entry Live tetap `false`.
- Handler drag entry untuk replay: `onPressedMoving` set `trade.entry=v` (dan `recalcRisk()`
  bila perlu), refresh pill via `renderPosDom`/`updateOpenTradeBox`, **tanpa mini-confirm**
  (meniru perilaku `tradeLevel` entry lama). SL/TP replay tetap memakai alur drag Live
  (preview + konfirmasi), tapi disimpan client-side (lihat §2).

### 5. Revert fix tabel sementara (5 edit sebelumnya)

- `renderTrades()` cabang replay: kembali hanya merender `trade` (posisi server disembunyikan),
  dan **hapus tombol "Close ½"** (sisakan "Close" saja).
- `#tpNPos` replay: kembali `trade?1:0`.
- `applyPaperMode()`: pulihkan `spStopPolling()` di replay (tak perlu data server saat replay).
- `spSync()`: pulihkan guard `if(!spActive()) return;`.
- `#closeAllBtn`: pulihkan versi lama (tanpa cabang `SP.positions` di replay).

### 6. Edge case

- Simpan `trade.instrument = inst` saat `openTrade` agar pill muncul di chart yang benar;
  ganti instrumen menyembunyikan trade (mengikuti filter `p.instrument===inst` di Live).
- `checkTrade(c)` (auto SL/TP saat bar maju) tetap; setelah auto-close `trade=null`,
  `drawPaperLines()` membersihkan pill/garis.
- Editor popup terbuka lalu trade auto-close: `drawPaperLines` sudah menutup editor bila
  posisinya hilang (`closePositionEditor` saat id tak ada di daftar) — pastikan berlaku
  untuk REPLAY_ID juga.
- Reset replay (`#resetBtn`) / `exitReplay`: bersihkan garis & editor via `drawPaperLines`.

## Yang TIDAK berubah

- Semua alur & endpoint Live (`/api/close`, `/api/position/sltp`, `/api/order`), server-side.
- Logika entry replay (`openTrade`, `curBidAsk`, sizing) selain penambahan `trade.instrument`.
- Auto SL/TP replay (`checkTrade`) dan journal/stats.

## Rencana verifikasi (end-to-end)

Jalankan server lokal (`go run .` dengan `.env`), buka UI, login. Uji via browser (Playwright
atau manual):

1. **Replay close on-chart**: masuk Bar Replay, buka trade → muncul pill P&L + tombol × di
   garis entry. Klik × → mini-confirm → `closeTrade` client (tak ada `/api/close`); pill hilang,
   journal bertambah.
2. **Replay SL/TP**: drag garis SL/TP → mini-confirm → `trade.sl/tp` berubah (tanpa fetch);
   chip +SL/+TP menambah level; popup editor buka/simpan.
3. **Entry draggable replay**: drag garis entry → `trade.entry` berubah live (tanpa konfirmasi).
4. **Posisi Live tersembunyi di replay**: buka posisi Live, masuk replay → posisi Live tak
   tampil di chart & tabel; keluar replay → muncul lagi & bisa ditutup normal.
5. **Regresi Live**: di mode Live, buka posisi server → pill/close/drag SL/TP/editor tetap
   memakai `/api/close` & `/api/position/sltp` seperti sebelumnya (tak ada perubahan perilaku).
6. Cek konsol tak ada error; cek Network memastikan replay tak memanggil endpoint server.
