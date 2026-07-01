# Fix: posisi Sell (paper) stop-out instan pada instrumen spread lebar

> ## ✅ STATUS 2026-07-01 — SELESAI & di-commit (`64b82de`, + guard draft `b961aff`)
> - ✅ **Clamp spread di sumber**: `hub.go` `maxSpread()` + `clampSpread()`, dipanggil di `broadcast` → entry/monitor SL/TP/FE konsisten.
> - ✅ **Validasi SL/TP dalam spread** saat buka: `handlePaperOrder` (paper.go) menolak SL/TP yang sudah terlanggar (pesan jelas "taruh di atas/bawah Ask/Bid").
> - ✅ **Grace period** di `paper_monitor.checkPaperSLTP`: skip auto-close bila posisi < ~2 dtk.
> - ✅ **`clearDraftLines()` + `toast()`** di `ServerPaperBroker.market`; `drawDraftLines` juga skip saat panel order ditutup.
>
> Detail rencana asli di bawah (untuk referensi).

> **STATUS: SELESAI & TERVERIFIKASI (2026-07-01).** Implementasi: `hub.go` (clampSpread di
> broadcast), `paper_monitor.go` (grace 2s), `paper.go` (validasi SL/TP tolak di dalam
> spread), `index.html` (clearDraftLines + toast + suppress preview saat ada posisi paper).
> Verifikasi CDP: XAU sell → posisi bertahan (journal exit NULL, spread ter-clamp $0.50,
> P&L −$4.90 normal, bukan −$197); SL/TP di dalam spread → HTTP 400 pesan jelas; draft
> preview hilang saat panel tutup / ada posisi. Server sudah di-rebuild & restart.

## Context
User pasang SL & TP lalu klik Sell (XAU/Gold, mode paper — default `replayMode=false`),
posisi "tak terbuka", hanya tersisa garis SL/TP di chart. Investigasi (data `luna.db`)
membuktikan posisi **benar-benar terbuka lalu langsung ditutup di SL pada detik yang
sama**:

```
journal #5  XAU_USD short  entry 4001.135  SL 4020.835  exit 4020.835
            open_time == exit_time == 2026-06-30T23:33:42Z   pnl -197
```

**Akar masalah:** untuk short, `paper_monitor.checkPaperSLTP` (paper_monitor.go:77)
menutup saat `Ask >= SL`, sedangkan FE menaruh SL relatif ke **bid** (entry). OANDA
closeout spread XAU ~$20 (BTC ~$400) → `Ask = bid + spread` sudah melewati SL saat
buka → **stop-out instan**, dan tak ada grace (SL/TP bisa memicu di tick pembukaan).
Fix A3 sebelumnya hanya meng-clamp spread di TAMPILAN Markets, bukan di harga trading.

Garis SL/TP yang tersisa = **garis draft FE** (`drawDraftLines`) yang di mode paper
tak pernah di-clear (clearDraftLines hanya dipanggil `openTrade`, jalur replay).

> **UPDATE 2026-07-01 — sub-issue "garis SL/TP nyangkut" SUDAH DIPERBAIKI (FE-only, terverifikasi).**
> Garis SL/TP yang "muncul terus lintas reload" ternyata BUKAN sisa trade gagal & BUKAN
> ter-persist (`tradeLevel` tak ada di `PERSIST_DRAW`). Itu **garis preview draft** dari
> tiket order default (Sell, SL/TP `checked`, `slPips=100`) yang `drawDraftLines()` gambar
> ulang tiap load — bahkan saat panel order tertutup. Terlihat di XAU (dekat harga), tak
> terlihat di EUR_USD (100 pip jatuh di luar layar). **Fix:** `drawDraftLines()` kini
> di-guard `$('#orderpanel').style.display==='none'` → preview HANYA saat panel order
> terbuka; `toggleOrder()` memanggil `drawDraftLines()` agar langsung hilang/muncul.
> Verifikasi CDP (XAU): panel tutup → chart bersih; buka → preview muncul; tutup → hilang.
> **Ini belum di-commit.** Sisa plan di bawah (stop-out instan server-side) TETAP ditunda.

**Scope (dipilih user):** fix inti — posisi buka & bertahan; spread trading paper
dibuat realistis (clamp seperti A3) + validasi SL/TP + monitor tak menutup di tick
pembukaan + garis draft di-clear + feedback jelas. **TIDAK** termasuk edit SL/TP
on-chart untuk posisi paper (fitur lebih besar, ditunda).

## Perubahan

### Server (Go)
1. **`hub.go` — clamp spread di sumber.** Tambah helper `clampSpread(t Tick) Tick`:
   jika `t.Ask-t.Bid` > `maxSpread(inst)`, set `mid=(bid+ask)/2`, `bid=mid-max/2`,
   `ask=mid+max/2` (skip bila bid/ask ≤0 atau DXY bid==ask). `maxSpread` per-instrumen
   mengikuti FE `maxSpreadPips` × pip: XAU ~0.50, XAG ~0.40, BTC ~80, JPY ~0.03,
   default FX ~0.0030. Panggil di **`Hub.broadcast` baris ~116, baris pertama**
   (`t = clampSpread(t)`) sebelum `h.last[...]=t` → otomatis memperbaiki `entryPrice`
   (pakai `Hub.Last`), monitor, DAN harga FE (SSE) sekaligus. Ini menjadikan clamp FE
   di `renderWatch` (A3) redundan tapi tetap aman.
2. **`paper_monitor.go` — grace period.** Di `checkPaperSLTP`, lewati auto-close bila
   posisi baru dibuka < ~2 dtk lalu (parse `p.OpenTime`, sudah ada di cache
   `AllOpenPaperSLTP`/`PaperOpenSLTP`). Cegah stop-out di tick pembukaan pada sisa
   spread apa pun.
3. **`paper.go` — validasi SL/TP saat buka** (`handlePaperOrder`, setelah `entryPrice`).
   Ambil bid/ask terkini via Hub; tolak (400) bila SL/TP sudah terlanggar sisi exit +
   buffer kecil (short: SL harus > ask, TP harus < ask; long: kebalikannya). Error
   jelas: "Stop Loss/Take Profit di dalam spread — perlebar jaraknya." Safety net +
   feedback, bukan buka posisi yang pasti mati.

### FE (`index.html`)
4. **`ServerPaperBroker.market`** (~baris 2130): pada **sukses** → `clearDraftLines()`
   (hapus garis draft yang menggantung) selain `spSync()`. Pada **error** → tampilkan
   `toast(pesan)` yang terlihat (bukan hanya `setStatus`), agar user tahu kenapa gagal.
   Guard `const btn=$('#execBtn'); if(btn) btn.disabled=...` (aman saat klik tombol
   simple `#dealSell`, execBtn mungkin tak fokus).

## Critical files
- `hub.go` — `clampSpread` baru + 1 baris di `broadcast` (baris ~115-117). Butuh notion
  pip/desimal per instrumen di Go (cek apakah sudah ada mis. di `oanda.go`/`config.go`;
  bila belum, helper kecil `maxSpread(inst)` berbasis substring instrumen).
- `paper_monitor.go` — grace di `checkPaperSLTP` (baris 56-95); pakai `p.OpenTime`.
- `paper.go` — validasi di `handlePaperOrder` (baris ~180-207); pakai Hub bid/ask.
- `index.html` — `ServerPaperBroker.market` (baris 2130-2151): reuse `clearDraftLines()`
  (baris 1931) & `toast()` (sudah ada).

## Verifikasi (end-to-end, butuh rebuild+restart server)
1. Rebuild & restart: hentikan proses lama, `PORT=8765 go run .` (atau build ulang).
   Catatan: proses yang jalan sekarang binary LAMA — wajib restart agar fix Go aktif.
2. Via CDP (cookie `luna_session`, helper `scratchpad/`): buka **XAU_USD**, pasang SL &
   TP wajar, klik **SELL** → pastikan:
   - posisi **muncul & bertahan** di tabel Positions (setelah `spSync` ~1.5s),
   - `luna.db` `journal`: baris baru `exit IS NULL` (tidak open==exit),
   - garis draft SL/TP **hilang** setelah eksekusi.
3. Uji SL sengaja terlalu rapat → muncul **toast error** jelas, tak ada posisi mati.
4. Uji **EUR_USD** (spread kecil) tetap normal — tak ada regresi.
5. Cek Markets spread kini wajar dari server (XAU ~50, BTC ~80) tanpa perlu clamp FE.
6. Tak ada error konsol (CDP `Runtime.exceptionThrown`).

## Catatan
- Posisi lama yang keliru ter-stop (pnl -197 dst) sudah mengurangi saldo paper; bila
  user mau, saldo bisa di-reset terpisah (di luar scope fix ini).
- `replayMode` (Bar Replay) pakai jalur `openTrade`/`checkTrade` lokal — tak terdampak
  bug ini; fix fokus di jalur paper/server.
