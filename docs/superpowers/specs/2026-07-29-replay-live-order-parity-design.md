# Spec: Menyamakan semantik order Bar Replay dengan Live

Tanggal: 2026-07-29
Berkas terdampak: `js/state.js`, `js/sizing-pnl.js`, `js/replay-intrabar.js`,
`js/positions-onchart.js`, `js/trades-panel.js`, `js/broker-paper.js`, `js/render.js`,
`js/sltp-draft.js`, `js/stats-journal.js`, `paper.go`, `validate.go`, `store.go`

## Latar belakang

PR parity 2026-07-06 (`2026-07-06-replay-live-onchart-parity-design.md`) sudah menyatukan
**tampilan** posisi on-chart: replay dan Live memakai satu `drawPaperLines`, satu pill P&L,
satu popup editor. Yang tak ikut disatukan waktu itu adalah **semantik order** di baliknya.
Akibatnya perilaku masih terasa beda saat benar-benar dipakai, terutama saat memasang SL/TP.

Beda yang teridentifikasi (14 butir):

| # | Aspek | Replay sekarang | Live |
|---|---|---|---|
| 1 | Jumlah posisi | maks 1 (`openTrade` return kalau `trade` ada) | banyak, tiap order = posisi baru |
| 2 | SL ticks = 0 + SL ON | `sl = entry` → stop-out instan | guard `slp>0`, SL tak dikirim |
| 3 | Validasi spread/sisi | tak ada | `validateSLTP` menolak dengan 400 |
| 4 | Grace pasca-entry | guard pakai timestamp **buka bar** → bocor setelah Prev→Next | grace 2 s wall-clock |
| 5 | Pembulatan SL/TP | mentah | `toFixed(priceDecimals())` |
| 6 | Draft SL/TP saat ada posisi | disembunyikan | tetap tampil |
| 7 | Ubah SL/TP posisi terbuka | diterima tanpa validasi | divalidasi server, bisa gagal |
| 8 | Harga valuasi & close | mid (`cur.close`) | bid (long) / ask (short) |
| 9 | Pemicu SL/TP | low/high mid | bid (long) / ask (short) |
| 10 | Toast order/close | tidak ada | selalu ada |
| 11 | Validasi lot | tidak ada | `Lot must be greater than 0.` |
| 12 | Saran lot saat posisi terbuka | berhenti (`refreshLotSuggestion` guard `trade`) | terus berjalan |
| 13 | `renderSizing` | menampilkan angka posisi terbuka | selalu preview tiket |
| 14 | Header tabel Positions | 9 kolom (SL & TP terpisah) | 8 kolom (`SL / TP` gabung) |

Beda lain — pending order & trailing stop hanya ada di replay, entry replay bisa di-drag —
adalah **kelebihan alat latihan yang dipertahankan**, bukan cacat parity.

## Keputusan desain (disepakati)

- Cakupan: **semantik order**; fitur khas replay (pending, trailing, drag entry) tetap.
- Multi-posisi replay dikerjakan **dalam PR yang sama** (bukan dipisah).
- Spread **disamakan penuh**: valuasi, close, dan pemicu SL/TP pakai bid/ask sintetis.
  Konsekuensi diterima: P&L replay jadi lebih pesimis; jurnal replay lama (localStorage)
  tak sebanding lagi.
- Padanan grace: **lewati sub-bar yang tutup pada atau sebelum momen entry**.
- Pesan error server yang sampai ke pengguna **di-Inggriskan**, lalu replay memakai kalimat
  yang identik. Komentar & log Go tetap Indonesian.
- `partialClose` **dihapus** — tak terjangkau dari UI mana pun sejak tombol "Close ½"
  dicabut PR parity, dan ia menghalangi refactor state.

Acuan parity adalah **Live Luna Trade**, bukan TradingView: TradingView Bar Replay tak punya
simulasi order sama sekali (panel trading-nya tetap terikat harga live), dan Paper Trading
TradingView memakai model *netting* (order kedua menambah posisi yang sama, entry dirata-rata),
sedangkan Live Luna Trade tiap order = posisi terpisah.

## Arsitektur

### 1. State: satu posisi → banyak posisi

```js
// js/state.js
let trades = [];          // posisi replay terbuka (banyak, spt SP.positions di Live)
let replaySeq = 0;        // penomoran tampilan: posisi ke-n → id internal -n
let pending = null;       // TETAP satu slot (fitur khas replay)
```

Bentuk posisi: `{id, no, dir, entry, sl, tp, risk, units, trail, instrument, time, fillFrom}`.

- `id = -(++replaySeq)` → negatif; `no = replaySeq` untuk teks pengguna (`Closed #3`).
- Sentinel `REPLAY_ID === -1` diganti `isReplayId(id) => id < 0`. Aman: id Live berasal dari
  rowid SQLite, selalu ≥ 1.
- Field mati `lineEntry` / `lineSL` / `lineTP` dihapus (tak terpakai sejak parity on-chart),
  termasuk `moveLine(trade.lineSL, …)` di trailing dan pembersihannya di `resetTrade`.
- `currentPositions()` → `spActive() ? (SP.positions||[]) : trades.map(replayPosView)`.
- `paperLines` / `posDom` sudah dikunci per-id; kini menerima beberapa id negatif sekaligus.

Call site yang ikut berubah:

| Berkas | Sekarang | Jadi |
|---|---|---|
| `sizing-pnl.js:76` `openTrade` | tolak kalau `trade` ada | selalu buka posisi baru |
| `positions-onchart.js:366` `checkTrade(c)` | 1 posisi | `checkTrades(c, close)` loop `trades.slice()` |
| `positions-onchart.js:361` `recalcRisk()` | global | `recalcRisk(p)` |
| `positions-onchart.js:114,336` simpan SL/TP | cabang `REPLAY_ID` | cari posisi by id + validasi |
| `replay-intrabar.js:91` `closeTrade` | 1 posisi | `closeTrade(id, exit, time)` + `closeAllReplay()` |
| `replay-intrabar.js:68` `checkPending` | diblokir kalau ada `trade` | isi tanpa syarat |
| `replay-intrabar.js:36` `placePending` | diblokir kalau ada `trade` | boleh bersamaan posisi |
| `trades-panel.js:29` tabel Positions | 1 baris, 9 kolom | N baris, 8 kolom (header Live) |
| `trades-panel.js:89` `resetTrade` | 1 posisi | kosongkan `trades` |
| `stats-journal.js:55,61` open P&L & margin | 1 posisi | jumlahkan semua posisi |
| `broker-paper.js:9` `hasOpen()` | `!!trade` | `trades.length>0` |
| `broker-paper.js:8` `closeMarket()` | tutup 1 / cancel pending | tutup semua + cancel pending |
| `render.js:72` `refreshLotSuggestion` | guard `lotsManual\|\|trade\|\|!riskOn` | hanya guard `trade` yang dihapus |
| `sizing-pnl.js:55` `renderSizing` | pakai posisi terbuka bila ada | selalu preview dari tiket (cabang `trade` dibuang) |
| `sltp-draft.js:38` `drawDraftLines` | guard `trade \|\| pending \|\| T==null \|\| panel tertutup` | hanya `trade` & `pending` yang dihapus |
| `positions-onchart.js:381` `onNewBar(c)` | `checkPending(c); checkTrade(c)` | teruskan tutup bar: `stepBarTs(currentTF,c.timestamp,1)` |

Catatan `onNewBar`: ia dipanggil juga dari jalur **Live** (`live-refresh.js:65`) pada tiap candle
baru yang tutup. Di Live `trades` selalu kosong (posisi replay hanya dibuat di replay) sehingga
`checkTrades`/`checkPending` no-op di sana — yang berguna cuma `checkAlerts`. Perubahan tanda
tangan aman, tapi tetap harus dijaga: jangan sampai `checkTrades` mengasumsikan `replayMode`.

### 2. Harga: spread dibayar dua kali

Satu sumber tunggal, dipakai valuasi, close, dan pemicu SL/TP:

```js
// js/sizing-pnl.js — spread sintetis replay (konsisten dgn curBidAsk: pip*1.6)
function synthHalfSpread(){ return (+$('#pipSize').value||instSpec().pip)*1.6/2; }
// harga mark/exit: long dinilai di bid, short di ask (cermin markPrice, paper.go:95)
function replayMarkPx(dir, mid){ const h=synthHalfSpread(); return dir==='long' ? mid-h : mid+h; }
```

- `replayPosView().price` = `replayMarkPx(dir, cur.close)` (bukan `cur.close`).
- `closeTrade` memakai `replayMarkPx`, bukan `cur.close`.
- Pemicu SL/TP — sub-bar low/high adalah mid, jadi bid = mid − ½s dan ask = mid + ½s:

| Arah | SL kena bila | TP kena bila |
|---|---|---|
| long | `low − ½s ≤ sl` | `high − ½s ≥ tp` |
| short | `high + ½s ≥ sl` | `low + ½s ≤ tp` |

Harga exit = level SL/TP itu sendiri (sama seperti `paper_monitor.go:74`). Prioritas SL di atas
TP dalam satu sub-bar tetap.

### 3. Pasang & ubah SL/TP

**a. Guard ticks > 0.** `openTrade` dan `placePending` hanya menghitung SL/TP bila
`slPips > 0` — cermin `broker-paper.js:52`. Menghilangkan `sl = entry` yang kena instan.

**b. Pembulatan** ke `priceDecimals()` seperti Live.

**c. Validasi spread/sisi**, cermin `validateSLTP` (`paper.go:108`), dipakai **tiga** jalur
replay: `openTrade`, `placePending`, dan simpan SL/TP posisi terbuka (`savePosLevel` +
`commitPosSLTP`):

```js
// short dinilai di ask, long di bid — urutan & kalimat identik paper.go
function validateSLTPReplay(dir, sl, tp){
  const ba=curBidAsk(); if(!ba) return null;
  if(dir==='short'){
    if(sl!=null && sl<=ba.ask) return 'Stop Loss is inside the spread — place it above the Ask price.';
    if(tp!=null && tp>=ba.ask) return 'Take Profit is inside the spread — place it below the Ask price.';
  } else {
    if(sl!=null && sl>=ba.bid) return 'Stop Loss is inside the spread — place it below the Bid price.';
    if(tp!=null && tp<=ba.bid) return 'Take Profit is inside the spread — place it above the Bid price.';
  }
  return null;
}
```

Gagal → `toast(msg,'error')`, order/perubahan dibatalkan (cermin 400 dari server).

**d. Grace.** `evalFills` mengirim waktu **tutup** sub-bar ke `checkPending` / `checkTrades`,
dan tiap posisi menyimpan `fillFrom`:

- `openTrade` → `fillFrom = T` (cursor replay saat tombol ditekan).
- `checkPending` mengisi posisi → `fillFrom` = tutup sub-bar pengisi, sehingga SL/TP posisi itu
  baru dievaluasi mulai sub-bar berikutnya.
- Guard: `if (subBarClose <= p.fillFrom) continue;`

Ini menutup kebocoran nyata: guard sekarang (`c.timestamp < trade.time`) memakai timestamp
**buka bar**, sehingga setelah Prev lalu Next, sub-bar di bar entry yang terjadi *sebelum*
tombol Buy ditekan ikut mengeksekusi SL. Sekaligus `trade.time` yang dipakai jurnal jadi momen
entry sebenarnya (`T`), bukan buka bar.

**e. Validasi lot.** `if(!(units>0))` → `setStatus('Lot must be greater than 0.',true)`,
kalimat identik `broker-paper.js:46`.

**f. Toast**, format identik Live:

- Buka: `SELL 0.10 XAU/USD @ 4117.74` (success)
- Tutup: `Closed #3  +$12.40` (success bila ≥ 0, info bila < 0)
- Ubah SL/TP: `SL updated` (sudah ada, dijaga konsisten)

### 4. Panel & tabel

- Tabel Positions replay: N baris, header disamakan dengan Live — 8 kolom
  `Instrument · Side · Size · Entry / Market · SL / TP · Margin · Profit & Loss · Actions`.
  Tombol per baris `data-act="close" data-id="<id>"`.
- Tab Closed replay tetap punya kolom `R` (Live menampilkan `—` karena tak menyimpannya).
- `#tpNPos` = `trades.length`; `#tpNPend` = `pending?1:0`.
- Close All replay: tutup semua posisi lalu batalkan pending (cermin `spCloseAll`).
- `commitPosSLTP` & `savePosLevel`: cabang `id===REPLAY_ID` → `isReplayId(id)` + cari posisi,
  plus validasi sebelum simpan.
- `renderAcct`: open P&L & margin dijumlahkan dari semua posisi, memakai `replayMarkPx`.
- Dua teks Indonesia di berkas yang disentuh ikut di-Inggriskan:
  `'Belum ada trade selesai (mode $).'` (`stats-journal.js:36`) dan
  `'Belum ada trade selesai.'` (`broker-paper.js:141`).

### 5. Pesan server jadi Inggris

Hanya empat titik frontend yang menampilkan teks server ke pengguna, semuanya endpoint paper:

| Berkas | Baris | Sumber |
|---|---|---|
| `js/broker-paper.js` | 61 | `toast(d.error)` dari `POST /api/order` |
| `js/broker-paper.js` | 73 | `setStatus(d.error)` dari `POST /api/close` |
| `js/positions-onchart.js` | 119, 341 | `toast(d.error)` dari `POST /api/position/sltp` |

Jadi yang di-Inggriskan = pesan yang bisa keluar dari `handlePaperOrder`, `handlePaperClose`,
`handlePaperModify`, `validateOrder`, dan dua error `store.go` di jalur itu
(`store.go:427`, `store.go:481`). Contoh pemetaan:

| Sekarang | Jadi |
|---|---|
| `paper saat ini hanya mendukung market order` | `Paper accounts support market orders only.` |
| `posisi tidak ditemukan atau sudah ditutup` | `Position not found or already closed.` |
| `harga belum tersedia — tunggu stream harga aktif` | `Price feed isn't ready yet — wait for the price stream.` |
| `units harus > 0` | `Units must be greater than 0.` |
| `Stop Loss di dalam spread — taruh di atas harga Ask` | `Stop Loss is inside the spread — place it above the Ask price.` |
| `order dengan clientTag ini sudah diproses — cek posisi` | `This order was already processed — check your positions.` |

Komentar Go, `log.Printf`, dan pesan endpoint yang tak pernah sampai UI tetap Indonesian.

**Di luar cakupan, dicatat:** fallback login `'Gagal — coba lagi'` (`js/auth-overlay.js:48`) dan
pesan endpoint auth juga melanggar aturan UI-English, tapi bukan jalur order.

## Yang TIDAK berubah

- Seluruh perilaku & endpoint Live (`/api/order`, `/api/close`, `/api/position/sltp`) — hanya
  *teks pesan* yang berubah, bukan status code, bentuk respons, atau logika.
- Pending order & trailing stop replay tetap ada (tidak ditambahkan ke Live).
- Entry replay tetap bisa di-drag; entry Live tetap terkunci.
- Balance & jurnal replay tetap client-side (`localStorage`); Live tetap server-side.
- Kolom `R` di tab Closed replay.
- `evalFills`: strategi sub-bar halus, anti-lookahead, dan frontier hanya-maju tetap; yang
  ditambah hanya penerusan waktu tutup sub-bar.

## Rencana verifikasi

Tak ada test Go yang meng-assert teks pesan (sudah diperiksa), jadi `go test ./...` harus tetap
hijau tanpa penyesuaian.

Test baru, hermetik (stub `/api` + fixture candle, tanpa `.env`):

- `tests/smoke/replay-order.spec.js` — murah, ikut gerbang PR:
  1. buka dua posisi replay berturut-turut (dulu ditolak) → `#tpNPos` = 2, dua baris tabel;
  2. tiap posisi punya garis SL/TP sendiri di chart;
  3. close per baris menutup posisi yang benar.
- `tests/trading/replay-live-parity.spec.js` — matriks lebih dalam untuk suite penuh di push `main`:
  1. SL ON dengan ticks 0 → posisi terbuka **tanpa** SL (bukan SL di entry);
  2. SL di dalam spread saat buka → toast error, posisi tak terbuka;
  3. ubah SL posisi terbuka ke dalam spread → toast error, nilai lama bertahan;
  4. Prev lalu Next sesudah entry → posisi **tidak** stop-out oleh harga pra-entry;
  5. P&L tepat setelah buka bernilai negatif sebesar spread (bukti spread dua kali);
  6. toast buka & tutup muncul dengan format Live.

Sebelum push: `npx playwright test tests/smoke --project=hermetic` + `go test ./...`.
Suite penuh diserahkan ke CI saat push `main` (CLAUDE.md — CI dua kedalaman).

Verifikasi manual di browser (akun test, `PORT=8765 ./luna-trade`): masuk Bar Replay, buka
beberapa posisi dengan SL/TP, geser SL/TP, Prev/Next, Play, lalu keluar replay dan pastikan
mode Live tak berubah perilaku.
