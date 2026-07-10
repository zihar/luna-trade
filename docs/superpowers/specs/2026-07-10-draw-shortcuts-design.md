# Keyboard Shortcut Drawing ala TradingView — Design

Tanggal: 2026-07-10
Status: Disetujui

## Tujuan
Menambah keyboard shortcut untuk mengaktifkan drawing tool, mengikuti standar TradingView
(Alt + huruf; Mac ⌥ + huruf) + tambahan mnemonik untuk tool yang TV tak punya default.
Fokus HANYA tool gambar (bukan Alt+I invert / Alt+S snapshot).

## Konteks kode
- `index.html`: `DRAW_GROUPS` (kategori + tool), `pickTool(g,t,catBtn)` (aktifkan tool: set ikon
  kategori, persist `br_lasttool_<key>`, `createDraw`, tutup flyout), `openFlyout` (render `.dt-item`).
- Listener keydown global (~baris 5026): skip saat fokus INPUT/SELECT/TEXTAREA; sudah ada
  Ctrl/⌘+Z/Y (undo/redo), Arrow (replay step), Space (play), Delete/Backspace (hapus terpilih),
  Escape (batal gambar), `b`/`s` (buy/sell — TANPA Alt, tak bentrok).

## Keymap
Resmi TradingView (identik):
| sc | tool name |
|----|-----------|
| T  | trendline |
| H  | horizontalStraightLine |
| V  | verticalStraightLine |
| F  | fib3 |

Tambahan (mnemonik):
| sc | tool name | | sc | tool name |
|----|-----------|-|----|-----------|
| R  | rect      | | O  | circle |
| E  | straightLine (Extended) | | A | arrow |
| Y  | rayLine (Ray) | | X | text |
| P  | priceLine | | | |

Tool lain (ellipse, callout, parallelStraightLine, priceChannelLine, fibonacciLine,
longPosition, shortPosition, dateRange, simpleAnnotation, simpleTag) TANPA shortcut.
Alt+C dilewati (tak ada overlay cross line).

## Arsitektur
1. **Field `sc`** ditambahkan ke tool terkait di `DRAW_GROUPS` (nilai satu huruf kapital, mis. `sc:'T'`).
   Satu sumber kebenaran untuk: lookup keydown, label hint, tooltip.
2. **`IS_MAC`** = deteksi platform → label `⌥T` (Mac) vs `Alt+T` (lainnya). Helper `scLabel(sc)`.
3. **`SC_BY_CODE`** = map dibangun dari `DRAW_GROUPS`: `{'Key'+sc → {group, tool}}`. Lookup pakai
   `e.code` (fisik, OS/layout-independent — di Mac ⌥+T: `e.key='†'` tapi `e.code='KeyT'`, `e.altKey=true`).
4. **Handler** di listener global existing: `if(e.altKey && !e.ctrlKey && !e.metaKey){ const hit=SC_BY_CODE[e.code];
   if(hit){ e.preventDefault(); activateShortcut(hit); return; } }` — ditaruh SEBELUM cabang lain.
5. **`activateShortcut({group,tool})`**: cari tombol kategori
   `_dt.querySelector('.dt-cat[data-cat="'+group.key+'"]')` lalu `pickTool(group, tool, catBtn)`.
6. **Hint flyout**: di `openFlyout`, tiap `.dt-item` yg punya `t.sc` menambah
   `<span class="dt-sc">`+scLabel+`</span>` (rata kanan via `margin-left:auto`). CSS `.dt-sc`.
7. **Tooltip**: `pickTool`/`buildDrawRail` set `title` = `group.title+': '+tool.title` + (sc? ` ('+scLabel+')` : '').

## Error handling / guard
- Hanya bereaksi bila `e.altKey` true tanpa Ctrl/Meta; input fields sudah di-skip di awal listener.
- `e.preventDefault()` mencegah menu access-key browser (Firefox/Windows) & karakter khusus Mac.
- Tool tak ditemukan (map miss) → tak melakukan apa-apa (jatuh ke cabang lain).

## Testing (Playwright, manual di browser)
1. Tekan Alt+T/H/V/F/R/E/Y/P/O/A/X → tool aktif: ikon kategori berubah, tombol armed,
   `inProgressId` terset, `localStorage['br_lasttool_<key>']` tersimpan.
2. Simulasikan `e.code='KeyT', altKey:true` (juga cek `e.key='†'` untuk Mac) → tetap memicu trendline.
3. Buka flyout → hint shortcut tampil rata kanan untuk tool yg punya `sc`.
4. Tooltip ikon kategori memuat shortcut.
5. Alt+Z tak bentrok undo (undo tetap Ctrl/⌘+Z). Ketik di input LOT tak memicu shortcut.

## Non-goals
Tak mengubah shortcut existing. Tak memasang Alt+I / Alt+S (bukan drawing).
Tak menambah shortcut untuk tool long-tail (bisa menyusul).
