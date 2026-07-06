# Indikator Teknikal — Design

Tanggal: 2026-07-06 · Status: disetujui, siap implementasi

## Tujuan
Backlog terakhir ROADMAP: menambahkan indikator teknikal bawaan KLineCharts
(`chart.createIndicator`) ke panel chart utama Luna Trade.

## Cakupan
6 indikator, parameter default, hanya chart utama:
- **Overlay (pane candle):** MA, EMA, BOLL
- **Sub-pane terpisah:** VOL, MACD, RSI

Parameter memakai default KLineCharts (MA 5/10/30/60, EMA 6/12/20, BOLL 20/2,
VOL, MACD 12/26/9, RSI 6/12/24).

## UI
- Tombol baru **`ƒₓ Indicators`** di toolbar, dekat grup TF/replay.
- Klik → dropdown menu berisi 6 baris toggle (checkbox). Dua grup: "Overlays" & "Oscillators".
- Baris aktif tercentang; tombol `ƒₓ` menampilkan badge jumlah indikator aktif.
- Klik baris aktif → hapus indikator itu.
- Menu tutup saat klik di luar (pola sama seperti popup lain di app).

## Mekanisme (KLineCharts 9.8.10)
- Overlay: `chart.createIndicator(name, true, { id: 'candle_pane' })` → numpang di pane harga.
- Sub-pane: `chart.createIndicator(name)` → pane baru; simpan `paneId` yang dikembalikan.
- Hapus: `chart.removeIndicator(paneId, name)` (overlay memakai `'candle_pane'`).

## State & persistensi
- `activeIndicators`: map `name → paneId` (`'candle_pane'` untuk overlay).
- Persist daftar nama aktif ke `localStorage` key `br_indicators` (global, lintas simbol).
- Re-apply saat load halaman setelah chart siap.
- Indikator otomatis bertahan saat ganti simbol/TF (`applyNewData` tak menghapus indikator).

## Non-goal (YAGNI)
- Edit periode/warna per indikator (gear ditunda).
- Indikator pada panel sekunder.
- Drag-reorder / resize sub-pane.

## Verifikasi
Jalankan app, buka menu ƒₓ, aktifkan tiap indikator, pastikan tampil di pane yang benar,
matikan lagi, reload → indikator aktif kembali muncul, ganti simbol → tetap ada.
