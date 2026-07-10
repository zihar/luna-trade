# Bar Replay — Smooth Forming Bar (ala TradingView)

## Context

Bar Replay saat ini menampilkan bar secara diskrit: saat Play, bar berikutnya muncul
utuh sekaligus (lompat), dan saat ganti TF di tengah replay, bar terakhir = bar tutup
penuh terakhir (tidak ada bar berjalan). Pengguna menginginkan pengalaman seperti
TradingView: **bar terakhir "terbentuk" bertahap** (tumbuh dari data TF lebih halus)
saat Play, **dan** saat ganti TF bar terakhir = bar TF baru yang memuat momen replay
(digambar partial), bukan mundur ke bar tutup terakhir.

Fitur ini melanjutkan logika replay yang sudah benar (PR #41: pick *exclusive* +
label Daily trading-day). Pendekatan "partial forming-bar" pernah dirintis di PR #38
(ditutup) — mesinnya di-hidupkan kembali dan diperluas ke playback.

Semua kode di `index.html` (monolitik). State/fungsi replay: `T` (cursor ms),
`revealed(tf)` (bar tutup ≤ T, anti-lookahead), `render(full)`, `step(d)`,
`play()`/`pause()`, `switchTF(tf)`, handler pick di listener klik `#chart`.

## Tujuan & non-tujuan

**Tujuan**
- Play: bar terakhir (bar yang sedang dibentuk) tumbuh bertahap dari data TF halus.
- Ganti TF di tengah replay: bar terakhir = bar TF baru yang memuat `T` (partial),
  mulus tanpa loncat, dengan label tanggal benar (trading-day).
- Anti-lookahead: OHLC forming bar hanya dari data ≤ `T`.

**Non-tujuan (ditunda — follow-up terpisah)**
- Eksekusi SL/TP/pending intra-bar. Fill trade & alert **tetap** dievaluasi saat bar
  penuh currentTF menutup (perilaku sekarang). Forming bar = murni **visual**.

## Desain

### Komponen (di-hidupkan kembali dari #38 + diperluas)

1. **State**
   - `replayPartial` — `{tf, candle:{timestamp,open,high,low,close}}` atau `null`:
     bar berjalan sintetis TF aktif @ cursor `T`.
   - `fineWinCache` — cache window sub-bar per rentang (key `INST|fineTF|open|end`).

2. **Helper**
   - `pickFineTF(coarseTF, spanMs)` — pilih TF sub-bar terhalus wajar
     (`['M1','M5','M15','M30','H1','H4']`, `DUR<coarse`, jumlah bar/periode ≤ 1000).
     `null` bila coarseTF sudah cukup halus.
   - `ensureFineWindow(fineTF, open, end)` — **hybrid**: slice dari `tfData[fineTF]`
     bila sudah menutupi; kalau tidak `fetchCandles` on-demand + cache.
   - `buildReplayPartial(tf)` — bar pertama-belum-tutup (`tfData[tf][revealed(tf).length]`)
     sbg pemuat `T`; agregasi OHLC sub-bar yang **tutup ≤ T** (`open`=pertama,
     `high`=max, `low`=min, `close`=terakhir); return `{timestamp:open,…}` / `null`.
     Guard: bila `T` di boundary (`open>=T`) atau tak ada sub-bar tutup → `null`.

3. **`render(full)`** — setelah `revealed(currentTF)`, bila `replayMode` &&
   `replayPartial` valid (tf cocok, `candle.timestamp` == open bar pertama-belum-tutup)
   → sisipkan `replayPartial.candle` sbg bar terakhir; paksa `applyNewData` penuh saat
   ada partial (hindari salah jalur `updateData` inkremental).

4. **Playback halus (`play`)** — ganti loop `setInterval(step(1))`:
   - Konstanta `REPLAY_SUBSTEPS = N` (mis. 24) — sub-langkah per bar (tetap, agar
     Daily & M15 terbentuk dlm wall-time serupa).
   - Tiap tick: `T += DUR[currentTF] / N`. Bila belum lewat batas bar →
     `replayPartial = buildReplayPartial(currentTF)`; `render()`.
   - Bila `T` mencapai/melewati tutup bar → `T` = boundary tutup, `replayPartial=null`,
     `onNewBar(barBaru)` (cek trade/alert), lalu bar berikutnya mulai terbentuk.
   - Di ujung data → `autoExtend` + `pauseIfNoData` (spt sekarang).
   - Kecepatan diukur **per-bar** (spt sekarang: `speed` bar/detik); N hanya kehalusan.
     Waktu per bar = `1000/speed` ms, dibagi N tick → interval = `1000/(speed*N)`.
   - **Clamp performa:** interval minimum ~16ms (≈60fps). Bila `1000/(speed*N)` < 16ms
     (speed tinggi), naikkan besar sub-langkah (`T` maju beberapa sub-bar/tick) alih-alih
     menembak <16ms — jaga jumlah render wajar. Di speed sangat tinggi, boleh jatuh ke
     perilaku diskrit (1 bar/tick) — kehalusan memang tak terlihat saat sangat cepat.
   - Fine window bar kini & berikutnya di-`ensureFineWindow` (async, cache) saat masuk
     bar baru; render partial dari yg tersedia (mengisi setelah fetch selesai).

5. **`step(d)` (Next/Prev)** — **tak berubah**: maju/mundur 1 bar penuh currentTF,
   `T` mendarat di boundary, `replayPartial=null` → bar terakhir = bar utuh.

6. **`switchTF(tf)`** — setelah data siap, sebelum `render(true)`:
   `replayPartial = replayMode ? {tf, candle: await buildReplayPartial(tf)} : null`
   (overlay lunar tetap tampil bila fetch). `T` tak diubah → kalau `T` di tengah bar
   TF baru, forming partial langsung tampil (mulus). Label trading-day (sudah ada)
   memastikan tanggal benar.

7. **Pembersihan `replayPartial`** — `null` di `exitReplay()`, handler pick (saat `T`
   di-set ulang), dan `step()` (T re-align ke boundary).

### Alur data
`T` (absolut) → `revealed()` (bar utuh, anti-lookahead) + `buildReplayPartial()`
(bar partial dari fine data ≤ T) → `render()` menyisipkan partial sbg bar terakhir.
Play menggerakkan `T` sub-bar; Step/pick/switchTF mengatur `T` & partial.

### Yang TIDAK diubah
`revealed()`, semantik pick exclusive & label trading-day (PR #41), eksekusi trade/
alert (tetap bar-close), mode Live.

## Verifikasi (manual, butuh login OANDA)
`PORT=8765 ./luna-trade`, login OANDA.
1. Replay M15, **Play** → bar terakhir tumbuh bertahap (open→wick→body), lalu menutup
   & bar berikutnya mulai; tidak lompat. Pause di tengah → bar tampil partial.
2. Saat Play (T di tengah bar), **ganti TF** ke H1/H4/D → bar terakhir = bar TF baru
   yang memuat momen (partial), tanggal benar (trading-day), tak loncat hari.
3. **Next/Prev** tetap 1 candle penuh; setelah step, bar terakhir = bar utuh (bukan
   partial).
4. Anti-lookahead: high/low/close forming bar ≤ data s/d `T` (bandingkan step manual
   di TF halus).
5. Daily Play: bar harian terbentuk dari M5 dalam waktu wajar (≈N tick), bukan ratusan
   langkah; window M5 ter-fetch/cache tanpa error.
6. Console bebas error JS di semua langkah.
