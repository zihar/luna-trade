# QT Fractal Indicator (Modul C) — Design

Status: approved (design), PR-1 scope.
Date: 2026-07-14.

## Konteks

User punya toolkit ICT/SMC lengkap di TradingView (`mml.pine`, 1155 baris, 5 modul:
A Struktur, B PD Array, C QT Fractal, D PDH/PDL, E Judas Swing). Tujuannya memakai
indikator-indikator itu di Luna Trade. File `.pine` **tidak bisa dijalankan** di luar
TradingView (Pine Script proprietary) — jadi ini **reimplementasi** di JavaScript pakai
API klinecharts, bukan menjalankan `.pine`. Konsekuensinya ada kemungkinan *drift* kecil
dari engine asli (sama seperti "DRIFT SENGAJA" yang sudah ditulis user di komentar Pine).

Port dilakukan **bertahap, satu modul per PR** (mengikuti CLAUDE.md: 1 fitur = 1 PR, PR
kecil, merge cepat). Modul pertama = **C (QT Fractal)**, sekaligus membangun infrastruktur
indikator custom yang belum ada.

## Keputusan yang sudah disepakati

1. **Siapa yang menulis logika:** Claude yang implementasi di JS; user menjelaskan/menyediakan
   `.pine`. Tidak ada in-app script editor / DSL.
2. **Modul awal:** C (QT Fractal).
3. **Fidelity bertahap:** PR-1 = visual (kotak quarter + 4 level auto + label netral + anchor
   NY DST-aware). PR-2 = klasifikasi fase AMD (A/M/D/X) + warna + gap-anchor.
4. **Params:** perluas editor gear ⚙ untuk mendukung kontrol `select` (dropdown) & `bool`
   (toggle), selain angka yang sudah ada. Sekali kerja, kepakai semua indikator custom nanti.

## Realita teknis (sudah diverifikasi di codebase)

- Chart: **klinecharts v9.8.10** (UMD dari unpkg, `index.html:1739`).
- Indikator saat ini **semua built-in** (MA/EMA/BOLL/VOL/MACD/RSI) dibungkus katalog
  `IND_DEFS` (`index.html:6586`) + UI menu ƒx + gear editor + persist `localStorage`
  (`br_indicators`). **Belum ada `registerIndicator` custom** — QT jadi yang pertama.
- Drawing bebas tersedia: app pakai `registerOverlay` + `createPointFigures` di puluhan
  tempat. Untuk indikator custom, klinecharts menyediakan hook `draw({ctx,xAxis,yAxis,...})`.
- Multi-TF fetch tersedia (`fetchCandles(tf,{count,to,from})`, `index.html:2907`) — **tidak
  dipakai di Modul C** (QT single-TF), tapi relevan untuk Modul B nanti.
- `GRAN` map hampir kosong (`index.html:1744`); butuh helper `tfSeconds(tf)`.

## Arsitektur

QT diregistrasi sebagai **custom indicator klinecharts** yang **overlay di `candle_pane`**,
lalu didaftarkan sebagai satu entri di `IND_DEFS`. Dengan begitu ia otomatis mewarisi jalur
yang sudah ada: toggle on/off (menu ƒx), badge hitung, gear ⚙, persist `localStorage`
(`persistInd`/`savedInd`) — tanpa membuat jalur paralel baru.

Tambahkan blok registrasi custom (mis. `registerCustomIndicators()`) yang dipanggil **sebelum
`chart` init**, sejajar dengan pemanggilan `registerOverlay` yang sudah ada.

## Komponen (unit terpisah, tiap satu tanggung jawab)

1. **Util waktu NY** — `nyParts(ts)` → `{y,mo,d,h,dow}` via `Intl.DateTimeFormat` timeZone
   `America/New_York` (DST-aware) + `nyTimestamp(y,mo,d,h,min)` → ms epoch. Mirror
   `timestamp(QT_TZ,…)` / `hour()/dayofweek()/…` Pine. **Independen dari timezone tampilan**
   yang dipilih user — anchor QT selalu NY.
2. **Anchor siklus** (port langsung dari Pine):
   - `qtSessStart(t)` — session start 18/00/06/12 NY yang memuat `t`.
   - `qtDayStart(t)` — trading-day start 18:00 NY.
   - `qtWeekStart(t)` — trading-week start Minggu 18:00 NY.
   - `qtMonthAnchor(y,mo)` + `qtMonthCycleStart(t)` — siklus bulanan mulai dari minggu yang
     memuat **Senin pertama** bulan itu.
   - `qtCycleStart(lvl,t)` — dispatch per level.
3. **`qtLevel(tfSec, opt)`** — auto: ≤300→Session(1), ≤900→Daily(2), ≤3600→Weekly(3),
   ≤14400→Monthly(4), else 0 (off). `opt` bisa paksa manual.
4. **`qtQuarter(lvl,t)`** — index quarter 0..4 di dalam siklus (4 = blok special: Jumat /
   minggu ke-5); -1 = di luar (weekend/jeda). Port dari Pine.
5. **Label netral** — `qtLabelText(lvl,t,q)` → teks **Inggris** (lihat Adaptasi).
6. **`calc(dataList, indicator)`** — untuk tiap bar: hitung `cycleStart` & `quarter`.
   Kelompokkan bar per (cycleStart, quarter) → **segmen** `{startTs,endTs,hi,lo,level,q,text}`
   dengan `hi/lo` = max high / min low candle pada quarter itu. Ambil hanya **N siklus
   terakhir** (mundur dari bar terakhir). Simpan array segmen di cache modul (mis.
   `qtState.segments`). Return array per-bar ringan (panjang == `dataList`) supaya klinecharts
   menganggap indikator "punya data" dan memanggil `draw`.
7. **`draw({ctx,kLineDataList,visibleRange,xAxis,yAxis,...})`** — untuk tiap segmen yang
   beririsan `visibleRange`: gambar kotak (border dotted 1px; fill transparan bila `Fill` ON)
   pakai `xAxis.convertToPixel(ts)` (x kiri/kanan dari `startTs/endTs`) & `yAxis.convertToPixel`
   (`hi/lo`), lalu label netral di pojok **kanan-bawah** kotak (bila `Label` ON). Warna PR-1 =
   satu warna netral default. Return `false`/handled sesuai kontrak klinecharts.

## Data flow

TF chart aktif → `qtLevel(tfSeconds(currentTF))` pilih level → `calc` bangun segmen dari
`dataList` (single-TF, tanpa fetch tambahan) → `draw` render tiap repaint (pan/zoom) dengan
koordinat dari xAxis/yAxis (otomatis ikut geser). Ganti TF/instrument → klinecharts panggil
`calc` ulang → segmen di-rebuild.

## Params & perluasan editor

Entri `IND_DEFS` baru untuk QT dengan skema kontrol campuran. Perluas `renderIndEditor`
(`index.html` ~6646) agar bisa render:

- **`select`** — Level: `Auto (by TF)` | `Session` | `Daily` | `Weekly` | `Monthly` (default Auto).
- **`number`** — N cycles (default 4, min 1, max 20).
- **`bool`** — Fill (default off), Label (default on).

Config disimpan sebagai `calcParams` **array posisi-tetap** (mis. `[levelCode, N, fill, label]`)
supaya jalur `persistInd`/`overrideIndicator`/`savedInd` yang ada tetap jalan tanpa perubahan
skema penyimpanan. `calc`/`draw` membaca `indicator.calcParams` pada posisi tetap tsb.
Warna (termasuk warna fase AMD) **ditunda ke PR-2**.

## Adaptasi wajib

- **Teks UI Inggris** (CLAUDE.md + memory ui-text-english): level `Session/Daily/Weekly/Monthly`;
  hari `Mon/Tue/Wed/Thu/Fri`; minggu `W1..W5`; sesi `Asia/London/NY-AM/PM`. Label netral PR-1 =
  `"<period> · Q<n>"` — mis. `"London · Q2"`, `"Mon · Q1"`, `"W3 · Q3"`; blok special = `"… · sp"`.
- **Anchor NY** dihitung independen dari timezone tampilan user.

## Batasan PR-1 (eksplisit → PR-2)

- Tanpa klasifikasi fase AMD (A/M/D/X) & warna per fase.
- Tanpa gap-anchor & ATR (tak diperlukan untuk visual).
- Tanpa `qtLblGap`×ATR offset (label nempel di tepi kanan-bawah kotak).

## Verifikasi (manual — frontend tanpa unit test)

`PORT=8765 ./luna-trade` → login OANDA → buka instrument → aktifkan QT dari menu ƒx.
Cek per TF:

- 5m → Session, 15m → Daily, 1H → Weekly, 4H → Monthly, >4H → indikator tak menggambar.
- Kotak "ngepas" range harga (high–low) tiap quarter; jumlah kotak sesuai N siklus.
- Label Inggris benar (period + quarter); pojok kanan-bawah kotak.
- Gear ⚙: ubah Level manual, N, toggle Fill/Label → chart update & tersimpan setelah reload.
- Tak ada error JS di console; toggle on/off & badge benar.
- Bandingkan mata-ke-mata dengan screenshot TradingView user.

## Risiko

- **Timezone/DST NY** — bagian paling rawan; util `nyParts` harus diuji di batas DST.
- **Kontrak `draw` klinecharts 9.8.10** — bila hook `draw` indikator tak berperilaku seperti
  diharapkan, fallback: render lewat `registerOverlay` yang di-drive oleh toggle indikator
  (mekanisme yang sudah terbukti dipakai app). Diputuskan saat implementasi.
- **Level Monthly ("Senin pertama")** — paling fiddly; verifikasi terpisah di 4H.

## Modul lain (di luar scope PR ini, urutan menyusul)

A Struktur, B PD Array (multi-TF, paling rawan drift), D PDH/PDL, E Judas Swing — masing-masing
PR sendiri setelah pola QT terbukti.
