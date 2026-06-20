# Bar Replay — Manual Forex Backtester (OANDA)

Tool web standalone untuk *manual backtest* gaya TradingView Bar Replay: geser candle
satu per satu di **multi-timeframe**, pasang entry manual (drag garis Entry/SL/TP),
dan lihat hasil R + journal. Data dari **OANDA v20**; tidak terhubung ke engine lain.

## Jalankan

```bash
cd ~/Projects/bar-replay
export OANDA_TOKEN=<personal-access-token-v20>
export OANDA_ENV=practice            # atau: live
go run .
```

Buka **http://localhost:8765**.

> Token OANDA hanya dibaca server (env), tak pernah dikirim ke browser.
> Proxy Go serve halaman + relay `GET /api/candles` ke OANDA (atasi CORS + sembunyikan token).

## Cara pakai

1. Pilih **instrument** (mis. `EUR_USD`, `XAU_USD`) dan **tanggal mulai** backtest.
2. **Load** → tiap panel TF terisi 5000 candle yang berakhir di tanggal itu
   (coverage natural beda: M1 ≈ 3,5 hari, H1 ≈ 7 bln, D ≈ 19 thn ke belakang).
3. **Next/Play** untuk maju. Panel TF besar hanya menampilkan candle yang **sudah close**
   (anti-lookahead). Saat mentok ujung, data forward ditarik otomatis (auto-extend).
4. **BUY/SELL** → 3 garis Entry/SL/TP muncul di **panel aktif** (border emas) dan bisa di-**drag**.
   SL/TP otomatis dicek saat replay maju; hasil R masuk **Journal** + **Statistik** (win rate, total R, PF).
5. **Drawing**: trendline, rect/zona, fib, horizontal ray — digambar di panel aktif.

### Shortcut
`←` `→` step · `Space` play/pause · `B` buy · `S` sell · klik panel = jadikan aktif.

## Catatan

- Semua waktu ditampilkan **NY time**; daily candle align tutup 18:00 NY.
- Journal & gambar tersimpan di `localStorage` browser.
- **Clock TF** = TF terkecil yang sedang di-load (menentukan langkah replay).
