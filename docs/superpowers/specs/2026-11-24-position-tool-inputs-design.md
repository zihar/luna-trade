# Long/Short Position — tab Inputs ala TradingView

Tanggal: 2026-11-24 · Status: disetujui

## Intent
Dialog setelan Long/Short Position saat ini hanya bisa mengetik harga TP & SL (tab Levels). Samakan
dengan TradingView: input lengkap akun/risiko/level supaya tool bisa dipakai merencanakan ukuran posisi.

## Goals
- Tab **Inputs** menggantikan tab Levels, berisi (urutan TV):
  - Account size (USD) — default `#balance`.
  - Lot size (unit per lot) — default per instrumen: forex 100000, XAU/XAG 100, lainnya 1.
  - Risk + satuan `%`/`USD` — default `#riskPct` (%). Ganti satuan = konversi, nominal tetap.
  - Entry price — kini editable; TP & SL ikut bergeser dengan jarak (ticks) tetap.
  - Profit level: Ticks ↔ Price (sinkron dua arah).
  - Stop level: Ticks ↔ Price (sinkron dua arah).
  - Qty precision 0–8.
- Label on-chart: P&L nominal di pill Target (+$) & Stop (−$), pill tengah `LONG · Qty N lot · RR 1:x`.
- Nilai Account/Risk/Lot terakhir disimpan (localStorage) → default posisi berikutnya.

## Non-goals
Leverage, tab Visibility, konversi akun non-USD.

## Anti-goals
- Level yang menyeberangi Entry diam-diam di-clamp (harus ditolak + field merah, seperti sekarang).
- Merusak drag handle posisi (tests/drawing/32-position-handles.spec.js harus tetap hijau).

## Constraints
- Setelan per objek disimpan di `objStyle[id]` (wadah warna zona) → ikut persist, sync server,
  copy/paste/clone tanpa skema baru.
- Matematika memakai `unitsFromRisk`/`quoteToUsd` di js/sizing-pnl.js; tick size sama dengan
  `posFigures` (XAU 0.01, lainnya 10^-desimal).
- Teks UI bahasa Inggris. Input harga `type=text` + `parseCoordNum` (jebakan locale).

## Approaches
1. **Dipilih:** perluas tab Levels jadi Inputs; state per objek di `objStyle`. Gratis persist/sync/clone.
2. Simpan setelan di struktur terpisah — butuh jalur persist & sync baru (risiko kehilangan data).
3. Selalu baca panel order (opsi B) — ditolak pengguna: semua posisi berubah bila balance berubah.

## Diserahkan ke builder
Tata letak detail field, pembulatan tampilan nominal, struktur modul (boleh modul baru
js/draw-position-inputs.js; perbarui module-hygiene bila menambah file).

## Tes
Spec baru di tests/drawing/ (sinkron ticks↔price, entry menggeser level, Qty dari risk) +
32-position-handles.spec.js + module-hygiene bila ada file JS baru.
