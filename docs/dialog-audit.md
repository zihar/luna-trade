# Audit dialog / popup (2026-11-10)

Acuan gaya baru: **`.dmodal`** (js/draw-style-modal.js, css/order-panel.css) — scrim blur, kartu 304px,
garis aksen 2px di atas, header ikon+judul+✕, tab bergaris-bawah, footer Lock/Delete/Close.

## Sudah di gaya baru
- Modal setelan objek gambar (rect, trendline, dst.) — acuan.
- **Long/Short Position** — dirombak jadi `.dmodal` (tab Style | Levels). `showPosPopup` & `objPop` dihapus.
- `.ivl-card` (Change interval) — gaya kartu baru, biarkan.

## Masih gaya lama (`.objpop` = popup mengambang + grip, tanpa header/tab/footer)
| # | Dialog | Lokasi | Catatan |
|---|--------|--------|---------|
| 1 | Setting chart (⚙) | js/chart-settings.js | Label **Indonesia** ("Candle naik/turun", "Border naik/turun") — melanggar aturan teks UI Inggris |
| 2 | Editor Fibonacci levels | `.fibpop` — js/draw-style-modal.js | Dibuka dari tombol di modal Fib; layak jadi tab/sub-panel modal |
| 3 | ~~Indicator editor~~ — SELESAI (js/indicators.js, kerangka .dmodal, scrim "live") |
| 4 | Konfirmasi tutup posisi | `.objpop.pos-confirm` — js/positions-onchart.js | Kecil; cukup disamakan token (radius/shadow/tombol) |
| 5 | Edit Open Position | `.objpop.pos-edit2` — js/positions-onchart.js | Sengaja meniru TradeLocker; teks Indonesia ("Harga Stop Loss", "Trailing (segera)") |

## Modal lama berbeda dari `.dmodal` (kartu sendiri, tanpa aksen/blur/animasi)
| # | Dialog | Lokasi |
|---|--------|--------|
| 6 | ~~Create alert~~ — SELESAI (index.html + css/controls.css, kerangka .dmodal) |
| 7 | Analytics | `.an-modal` — js/analytics.js |
| 8 | Indicators picker | `.ind-modal` — css/controls.css (z-index 80, di bawah modal lain) |

## Lain-lain (bukan modal, dicatat)
- Banner bentrok sync (`.sync-conflict`), `.user-pop`, `.nmk-pop` (kartu marker news) — popover, bukan dialog.
- Tidak ada `confirm()/prompt()/alert()` native tersisa di js/.

## Urutan rombak yang disarankan (satu PR per baris)
1 Setting chart (+ terjemah label) → 6 Create alert → 3 Indicator editor → 2 Fib levels → 8 Indicators picker → 7 Analytics → 4 Konfirmasi → 5 Edit Open Position.
