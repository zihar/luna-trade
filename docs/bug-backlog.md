# Backlog bug (lintas area)

Bug yang dilaporkan tapi belum bisa direproduksi / belum dikerjakan. Bug khusus drawing tetap di
`docs/drawing-tools-gap-plan.md` (bagian "Bug diketahui"). Satu item = satu PR kecil (CLAUDE.md #1).

## B1 — TF chart "pindah sendiri" + menu klik-kanan muncul (intermittent)

**Dilaporkan:** 2026-11-27, pengguna (produksi `release` = `51f1e95`). Tak tahu tombol apa yang
ditekan; yang jelas menu klik-kanan chart ikut muncul di layar. Belum bisa direproduksi.

**Hasil telusur kode (2026-11-27):** TIDAK ada jalur otomatis yang mengganti TF — tak ada timer,
sync antar-tab (`storage`), sync server, atau event sintetis yang menyentuh `currentTF`. Semua
pergantian TF lewat input pengguna:

| # | Pemicu | Lokasi | Rawan tak sengaja? |
|---|---|---|---|
| 1 | Klik tombol TF di bar | `js/tf-bar.js` `rebuildTFBar` | kecil |
| 2 | Klik TF di dropdown ⌄ | `js/tf-bar.js` `buildTFMenu` | kecil |
| 3 | Ketik digit saat fokus BUKAN di input → dialog "Change interval" → Enter | `js/keyboard.js` `openIntervalDialog` | **ya** — mis. mengetik lot/harga "15"+Enter saat field order tak terfokus → M15 |
| 4 | Multi-chart: double-click header panel sekunder / tombol aktifkan → simbol+TF ditukar | `js/multi-chart.js` `activatePanel` / `focusIntoPrimary` | **ya** — terlihat "pindah sendiri" |
| 5 | Enter/Space saat tombol panel sekunder masih terfokus (default action tombol) | `js/multi-chart.js` | mungkin |

Rilis 2026-11-26 (#230 Position Style, #231 cheat-sheet, #232 draw guard) tak menyentuh jalur di
atas; #231 di `keyboard.js` hanya menambah `?` dan Ctrl/⌘+/. #229 (rilis 2026-11-25) mengubah
`loadInit` (TF yang diganti saat memuat ikut dimuat) — tak memilih TF sendiri.

Menu klik-kanan (`js/context-menu.js`) hanya dari event `contextmenu` asli (klik kanan, atau
ketuk dua jari di trackpad Mac); Ctrl+klik diabaikan; tertutup oleh klik mana pun / blur.

**Langkah berikut:**
1. **Instrumentasi (disarankan, PR kecil):** tambahkan sumber ke `track('timeframe',{tf, src})` —
   `bar` / `menu` / `hotkey` / `panel` — supaya kejadian berikutnya langsung menunjuk pemicunya.
2. Cek tabel `events` produksi di sekitar waktu kejadian (urutan `timeframe` vs `layout`,
   `symbol`, `chart_settings`, …):
   `ssh forex-alertd "sqlite3 <DB_PATH> \"SELECT ts,name,props FROM events WHERE ts>=datetime('now','-2 day') ORDER BY ts\""`
3. Tanyakan ke pelapor: pakai layout multi-chart? Simbol ikut berganti atau hanya TF? (simbol ikut
   ganti ⇒ hampir pasti jalur #4). Mac + trackpad?
