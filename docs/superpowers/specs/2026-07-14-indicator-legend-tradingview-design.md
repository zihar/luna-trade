# Rombak UI Indikator — Legend On-Chart ala TradingView

**Tanggal:** 2026-07-14
**Status:** Design (menunggu review)

## Ringkasan

Merombak UI indikator teknikal (`ƒx`) di `index.html` menjadi tiga bagian bergaya
TradingView:

1. **Modal "Indicators"** menggantikan dropdown `ƒx` — pencarian + kategori; klik =
   add/remove. Tidak ada gear di sini.
2. **Legend on-chart per-indikator** (baru) — muncul untuk tiap indikator aktif di
   pojok kiri-atas pane-nya, dengan nama + parameter + nilai live; saat hover
   memunculkan tombol **hide (👁) · settings (⚙) · remove (✕)**.
3. **Editor parameter (gear)** dipertahankan apa adanya, tapi dipanggil dari legend.

Motivasi: kontrol per-indikator (settings/hide/remove) tidak lagi bercampur di daftar
tambah — daftar tambah murni untuk memilih indikator, dan pengelolaan tiap indikator
dilakukan langsung di chart, sebagaimana TradingView.

## Kondisi saat ini (baseline)

Seluruh logika indikator terpusat di blok `index.html` **6711–6877**:

- `IND_DEFS` (6715–6740): 7 indikator — `MA/EMA/BOLL/QT` (overlay, `overlay:true`) dan
  `VOL/MACD/RSI` (oscillator, `overlay:false`).
- `activeInd` map `name -> paneId` (`'candle_pane'` untuk overlay; id sub-pane dinamis
  untuk oscillator). `indParams` map `name -> calcParams[]`.
- `addInd/removeInd/removeAllInd`, `persistInd/savedInd` (localStorage
  `'br_indicators'`), `updateIndBadge`.
- Editor parameter lengkap: `openIndEditor/renderIndEditor/setIndParams` (6781–6857) —
  popup mengambang tunggal, skema `controls/fixed/list`, debounce 150ms, persist.
- Dropdown `ƒx`: markup `#indBtn`/`#indMenu` (1459–1460), CSS `.ind-menu/.ind-item/
  .ind-gear` (180–206), render `renderIndMenu` (6858–6871), toggle open (6873–6877).
- Chart: klinecharts **9.8.10** (UMD, di-pin; baris 1739). Init baris 2756.
  `createIndicator(name, true, {id:'candle_pane'})` untuk overlay, `createIndicator(name)`
  untuk sub-pane; `overrideIndicator`, `removeIndicator`.
- Legend indikator saat ini memakai **native klinecharts** (default, kiri-atas tiap
  pane). Legend OHLC/instrumen custom terpisah (`.chart-legend` 215–219, markup 1505,
  `candleTooltipCustom` 2772, `updateChartLegend` 2791).
- Preseden akses internal klinecharts 9.8.10 dengan try/catch: baris 4288.

## Arsitektur & keputusan

**Keputusan inti:** legend dibangun sebagai **HTML overlay penuh**; legend indikator
native klinecharts **dimatikan** via `indicator.tooltip.showRule:'none'` di
`darkStyles` & `lightStyles`. Alasan: hanya HTML overlay yang memungkinkan menaruh
tombol hide/gear/remove inline per-baris dengan interaksi hover — mustahil menempelkan
tombol HTML presisi di atas teks yang digambar canvas.

Konsekuensi: kita menyediakan sendiri **(a) nilai live** dan **(b) posisi Y sub-pane**,
keduanya dibaca dari internal klinecharts di dalam `try/catch` dengan *graceful
degradation*.

### Komponen

**A. `IND_DEFS` — metadata tambahan.**
Tambah `desc` (deskripsi singkat, ≤ ~40 char) per indikator untuk baris modal, dan
`cat` bila perlu (sudah tersirat dari `overlay`: Overlays vs Oscillators). Teks UI
bahasa Inggris (CLAUDE.md).

**B. Modal "Indicators"** (ganti dropdown `.ind-menu`).
- Overlay modal di tengah layar (ikuti pola modal/dialog yang sudah ada di app bila
  ada; jika tidak, buat baru minimalis konsisten token `--panel/--border/--accent`).
- Struktur: header judul "Indicators" + tombol close; kotak **search** di atas; sidebar
  kategori (All / Overlays / Oscillators); daftar kanan — tiap baris: nama + label +
  `desc`, indikator status **added** (tercentang/highlight). Klik baris = toggle
  add/remove. Search memfilter nama+label+desc (case-insensitive).
- Tombol `ƒx` toolbar membuka modal; Escape / klik-luar / tombol close menutup.
- `#indBadge` (jumlah aktif) dipertahankan pada tombol `ƒx`.

**C. Legend on-chart per-indikator** (baru).
- Kontainer HTML overlay di dalam `#chart` (posisi absolut).
- **Overlay indicators**: satu kelompok baris di pojok kiri-atas candle pane, di-stack
  **di bawah** baris info instrumen + OHLC (`.chart-legend`). Perlu penyesuaian offset
  agar tak menimpa OHLC.
- **Oscillator**: baris legend di pojok kiri-atas pane masing-masing; posisi Y dibaca
  dari layout pane klinecharts (internal), di-reposisi saat resize / scroll / tambah /
  hapus pane.
- Tiap baris:
  - Baris-1: nama + parameter (mis. `MA 5 10 30 60`), diwarnai sesuai warna plot.
  - Baris-2 (opsional saat ada nilai): angka nilai **live** — ikut crosshair; tanpa
    crosshair → nilai bar terakhir.
  - Tombol **👁 ⚙ ✕** muncul saat hover baris (nama tetap tampil di non-hover):
    - 👁 hide/show → toggle visible indikator; **sub-pane tetap ada, hanya plot
      disembunyikan** (bukan collapse). Ikon jadi mata-coret saat hidden.
    - ⚙ settings → `openIndEditor(name)` (popup existing).
    - ✕ remove → `removeInd(name)` + refresh legend/modal/badge/persist.
  - `pointer-events` aktif hanya pada area teks+tombol agar tak menghalangi interaksi
    chart di area kosong.

**D. Editor gear (tetap).**
`openIndEditor/renderIndEditor` tidak berubah; dihapus dari daftar tambah (kini modal),
dipanggil dari tombol ⚙ legend.

### Sumber nilai live

- `chart.subscribeAction('onCrosshairChange', d => …)` memberi `d.kLineData.timestamp`
  → petakan ke dataIndex (via `getDataList`). Saat crosshair keluar chart → pakai indeks
  bar terakhir.
- Nilai indikator terhitung dibaca dari hasil indikator klinecharts (`indicator.result`
  per dataIndex) melalui store internal — pola akses internal sudah ada preseden
  (baris 4288). Dibungkus `try/catch`.
- **Graceful degradation:** bila pembacaan gagal, baris nilai (baris-2) disembunyikan;
  nama + parameter + tombol tetap berfungsi.

### Hide/show (visibility)

- Implementasi visibility indikator memakai `overrideIndicator` dengan flag visible bila
  didukung klinecharts 9.8.10; bila tidak, fallback ke override figure-style
  (garis/area jadi transparan). **Tidak** memakai remove/re-add agar layout pane tak
  melompat.
- Perlu diverifikasi mekanisme visibility yang benar untuk 9.8.10 saat implementasi
  (spike kecil di awal task legend).

### State & persistence

- `activeInd`, `indParams`, `persistInd()` dipertahankan.
- Tambah state `hiddenInd` (Set nama yang di-hide).
- Format localStorage `'br_indicators'` di-extend: tiap entri `{name, calcParams, hidden}`.
  `savedInd()` tetap backward-compat (string murni & entri tanpa `hidden` ditoleransi →
  `hidden:false`). Restore saat load memulihkan status hide.

### Yang dihapus / diubah

- Dropdown `.ind-menu` + gear per-item + `renderIndMenu` → diganti modal.
- `indicator.tooltip.showRule:'none'` ditambahkan ke `darkStyles` & `lightStyles`
  (matikan legend indikator native).
- `#indBtn` handler membuka modal (bukan toggle dropdown).

## Alur data

1. **Add:** modal → `addInd(name)` → `chart.createIndicator(...)` → build baris legend →
   `persistInd` + `updateIndBadge` + refresh modal state.
2. **Crosshair bergerak:** `onCrosshairChange` → hitung dataIndex → baca nilai indikator
   → update baris-2 tiap legend (throttle bila perlu).
3. **Resize/scroll/tambah-hapus pane:** reposisi legend oscillator ke top-Y pane baru.
4. **Hide:** 👁 → toggle visible + `hiddenInd` + persist; ikon berubah.
5. **Settings:** ⚙ → `openIndEditor(name)`.
6. **Remove:** ✕ → `removeInd(name)` → hapus baris legend + persist + badge + modal state.
7. **Reload:** `savedInd()` restore indikator + calcParams + status hidden.

## Error handling

- Semua akses internal klinecharts (nilai, posisi pane, visibility) dibungkus
  `try/catch`; kegagalan tidak boleh mematahkan chart — degradasi anggun (angka/
  posisi diabaikan, fitur inti add/remove/gear tetap jalan).
- Input editor parameter sudah menangani NaN/kosong (existing) — tidak diubah.

## Testing / verifikasi

Frontend tanpa unit test — verifikasi manual via browser (`PORT=8765 ./luna-trade`,
butuh `.env` OANDA; chart butuh login OANDA untuk candle). Checklist:

- Modal `ƒx`: buka/tutup, search memfilter, klik add & remove, status "added" benar,
  badge jumlah benar.
- Legend muncul untuk tiap indikator aktif di pane yang benar (overlay di candle,
  oscillator di sub-pane-nya).
- Nilai live ikut crosshair; tanpa crosshair menunjukkan bar terakhir; degradasi anggun
  bila baca nilai gagal.
- Hover memunculkan 👁 ⚙ ✕; 👁 menyembunyikan plot tanpa collapse pane, toggle balik;
  ⚙ membuka editor & perubahan param langsung terlihat; ✕ menghapus indikator + legend.
- Resize window & scroll chart: legend oscillator tetap menempel di top pane-nya.
- Reload: indikator, parameter, dan status hidden pulih.
- Tidak ada error JS di console.

## Risiko

- **Utama:** membaca nilai & posisi sub-pane dari internal klinecharts rapuh terhadap
  upgrade versi. Mitigasi: try/catch + graceful degradation + versi di-pin 9.8.10 +
  spike verifikasi visibility di awal.
- Penempatan legend overlay candle agar tak menabrak OHLC/instrumen legend existing —
  perlu koordinasi offset (mirip `updateChartLegend`).

## Di luar cakupan (YAGNI)

- Menu "…" (more) tambahan, drag-reorder indikator di legend, duplikasi indikator,
  template/preset indikator. Tidak dikerjakan sekarang.
