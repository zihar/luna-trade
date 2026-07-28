# Pemecahan `index.html` Fase 2 — rencana potongan ≤800 baris

**Tanggal:** 2026-07-28
**Status:** **SELESAI** — kesembilan PR (PR-2…PR-10) mendarat 2026-07-28 bersama dua PR penawar.
`index.html` 6.862 → **450 baris (markup saja)**, 50 modul `js/`, suite hermetik 227 hijau di tiap
langkah. Yang berubah dari rencana ini saat dikerjakan, biar tercatat jujur:

- **Rentang bergeser terus.** Nomor di tabel di bawah basi setelah PR pertama; dua PR penawar
  menambah baris komentar dan bahkan mengubah PEMBAGIAN potongan (PR-9 jadi `797-1540` bukan
  `737-1536`, karena `737-1540` melewati 800 baris). `tools/audit-cut.js` dijalankan ulang tiap PR.
- **`fmtCountdown` tidak berakhir di satu file** seperti diduga di bagian "Landmine yang gugur":
  kedua deklarasinya di banner berbeda → dua file. Tetap aman (nol referensi eager), dan
  perilakunya dipaku test di boot-integrity.
- **Penjaga `SENTINEL` perlu diperluas** dengan entri `{ probe, why }`: sebagian file hasil
  pemecahan tak mendeklarasikan apa pun (IIFE / efek samping saja).
- **Verifikasi sentinel harus pakai parser, bukan grep** — deklarator kedua dalam satu baris `let`
  (`hoverName`, `inProgressId`) membuat pola `^let <nama>` melaporkan positif palsu "tak ada".
**Basis:** `docs/superpowers/specs/2026-07-27-split-index-js-phase2-design.md` (spec Fase 2).
Rencana ini **menggantikan** tabel "PR-0 + ~16 PR di batas banner alami" di spec itu, dan
memperbaiki dua klaim landmine-nya (lihat "Landmine spec yang gugur").
**Basis pengukuran:** branch PR #136 (ekor sudah pindah), blok inline JS = `398-6436`.

## Keputusan

Potongan **sampai 800 baris**, tetap **kupas dari ekor**, satu potongan = satu PR.
Sisa 6.039 baris JS inline → **9 PR** (PR-2 … PR-10), bukan ~15.

9 adalah **minimum** untuk batas 800 baris, bukan hasil tebakan: batas potong harus jatuh di
banner section, dan pencarian jalur terpendek atas 60 banner memberi 9 (greedy-dari-ekor pun
menghasilkan angka yang sama).

Kenapa kupas-dari-ekor tetap dipertahankan di ukuran potongan apa pun: selama yang dicabut adalah
ekor, sisa blok inline tetap **satu blok kontigu** → hoisting tak pernah berubah. Memperbesar
potongan tidak menambah risiko hoisting sedikit pun; yang bertambah hanya jumlah baris per review.

## Rencana potongan

Urutan PR = urutan ekstraksi (dari ekor ke atas). Kolom "audit" = hasil `tools/audit-cut.js`
terhadap titik potongnya.

| PR | Rentang | Baris | Modul yang dihasilkan (batas banner) | Audit titik potong |
|---|---|---|---|---|
| PR-2 | 5688–6436 | 749 | `replay-ui` (5688–5830), `draw-style-modal` (5831–5968), `chart-settings` (5969–6013), `indicators` (6014–6325), `chart-type` (6326–6352), `context-menu` (6353–6412), `chart-boot` (6413–6436) | **bersih** |
| PR-3 | 5305–5687 | 383 | `news-notify` (5305–5615), `keyboard` (5616–5687) | **bersih** |
| PR-4 | 4514–5304 | 791 | `price-stream` (4514–4646), `forming-candle` (4647–4863), `order-panel` (4864–5304) | **bersih** |
| PR-5 | 3758–4513 | 756 | `draw-rail` (3758–3950), `stats-journal` (3951–4014), `trades-panel` (4015–4109), `watchlist` (4110–4306), `instrument-picker` (4307–4513) | **bersih** |
| PR-6 | 3086–3757 | 672 | `draw-tools` (3086–3354), `draw-persist` (3355–3414), `draw-undo` (3415–3757) | ☠ **1 bahaya senyap** — `posPressedMove` |
| PR-7 | 2298–3085 | 788 | `sltp-draft` (2298–2364), `positions-onchart` (2365–2745), `replay-intrabar` (2746–2848), `broker-paper` (2849–3085) | (sama; sudah beres kalau PR-6 lewat) |
| PR-8 | 1531–2297 | 767 | `chart-legend` (1531–1582), `theme` (1583–1626), `tf-bar` (1627–1705), `load-chart` (1706–1886), `render` (1887–2056), `replay-control` (2057–2132), `live-refresh` (2133–2204), `sizing-pnl` (2205–2297) | ☠ **1 bahaya senyap** — `candleTooltipCustom` |
| PR-9 | 737–1530 | 794 | `draw-style` (737–796), `box-resize` (797–861), `overlays-custom` (862–1299), `chart-init` (1300–1349), `ny-time` (1350–1479), `click-guard` (1480–1530) | **bersih** |
| PR-10 | 398–736 | 339 | `constants` (398–412), `state` (413–445), `util` (446–636), `replay-forming-bar` (637–736) | **bersih** (blok inline habis) |

Nama file = `js/<modul>.js`. Granularitasnya tetap **per banner section**, bukan per PR — tujuan
inisiatif ini modul per-fitur; potongan 800 baris cuma satuan *merge*, bukan satuan file. Banner
kecil yang satu domain boleh digabung jadi satu file (mis. tiga banner Bar Replay → `replay-ui.js`),
selama urutan sumber tak berubah.

## Dua bahaya senyap — perbaiki sebagai commit sendiri LEBIH DULU

Keduanya kelas yang sama dan satu-satunya kelas yang tak akan ditangkap test mana pun: nama
diserahkan **sebagai nilai** oleh kode yang dievaluasi langsung di top-level, sementara
deklarasinya ada di potongan yang akan dimuat belakangan → nilainya `undefined`, **tanpa error**.

| Sebelum PR | Lokasi | Yang mati kalau dilewat |
|---|---|---|
| PR-6 | `index.html:1197-1198` → `posPressedMove` (dideklarasikan 3669) | drag long/short position |
| PR-8 | `index.html:1322,1341` → `candleTooltipCustom` (dideklarasikan 1542) | tooltip candle custom (dark & light styles) |

Penawarnya sama, dan menghapus jebakannya permanen alih-alih menghindarinya:

```js
performEventPressedMove: posPressedMove        →  (...a)=>posPressedMove(...a)
custom: candleTooltipCustom                   →  (...a)=>candleTooltipCustom(...a)
```

Resolusi berpindah dari saat registrasi ke saat pemanggilan, ketika semua script sudah termuat.
Hari ini pun keduanya cuma tertahan oleh kebetulan (hoisting satu blok), jadi commit ini bernilai
sendiri — jalankan lebih dulu, terpisah, dengan verifikasi perilakunya sendiri (drag posisi
long/short jalan; tooltip candle masih tampil di tema gelap & terang).

## `tools/audit-cut.js` — audit yang menggantikan pembacaan tangan

Spec lama meminta audit hoisting manual per PR mid-file ("kumpulkan nama, cari referensinya di
antara statement top-level"). Itu sudah tak perlu: `tools/audit-cut.js` menjawabnya dengan parser
(acorn AST), memisahkan referensi yang **dievaluasi langsung** dari yang ada di dalam body fungsi,
lalu memilah temuan jadi dua kelas menurut konsekuensinya (`CALL` = berisik & ketangkap suite,
`VALUE` = senyap & wajib diperbaiki).

```sh
npm i                              # acorn = devDependency (sekali per checkout)
node tools/audit-cut.js            # usulkan potongan ≤800 + audit semua titik potong
node tools/audit-cut.js 3086       # audit satu titik potong
```

**Jalankan ulang tiap PR**, jangan percaya tabel di atas: nomor baris bergeser tiap kali ada commit
yang menyentuh `index.html`, dan alat itu menurunkan banner + rentang dari file yang sedang ada.
Pelajaran yang sudah terbukti mahal di spec: batas ekor `6398-6822` salah dalam hitungan menit
karena dua PR lain mendarat di sela-sela.

## Landmine spec yang gugur (terukur, bukan diasumsikan)

Dua hal yang spec tandai sebagai penghalang ternyata **tidak berlaku untuk urutan & ukuran potongan
ini**:

1. **`fmtCountdown` ganda — defused.** Dua deklarasi berbeda isi ada di `4580` dan `5142`; keduanya
   jatuh di **potongan yang sama** (PR-4, `4514-5304`), jadi berakhir di satu file dengan urutan
   sumber utuh → pemenangnya tak berpindah. Spec menempatkannya sebagai prasyarat; dengan potongan
   800 baris ia bukan prasyarat lagi. (Rename salah satunya masih layak sebagai kebersihan
   tersendiri, bukan penghalang.)
2. **Lima guard `typeof` — bukan masalah.** Semua guard `typeof <nama-global>` di file ini berada di
   **dalam body fungsi**; satu-satunya `typeof` eager (`1069`) menyangkut variabel lokal. Fungsi
   berisi guard hanya berbahaya bila dipanggil eager dari atas potongan — dan audit menunjukkan
   **nol temuan `CALL`** di kesembilan titik potong. Jadi maknanya tak berubah pada urutan ini.

Yang **tetap berlaku** dari spec: jangan rebase branch pemecahan yang stale (buang & turunkan
ulang), dan jangan jalankan PR pemecahan paralel dengan PR yang menyentuh `index.html`.

## Protokol verifikasi per PR

Tiga hal, semuanya murah (~6 menit, sebagian besar waktu mesin):

1. **Byte-identik.** Rumus di spec dipatok ke nomor baris; untuk PR-PR berikutnya pakai bentuk
   invarian — rekonstruksi seluruh JS dari kedua sisi dan bandingkan:

   ```sh
   recon() { ( cd "$1" && { awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' index.html; \
                grep -o 'src="/js/[^"]*"' index.html | sed 's|src="/||;s|"$||' \
                  | while read -r f; do cat "$f"; done; } ) }
   git worktree add -q /tmp/wt-base main && diff <(recon /tmp/wt-base) <(recon .) \
     && echo "BYTE-IDENTICAL"; git worktree remove /tmp/wt-base
   ```

   (`while read` bukan `xargs cat`: dengan nol file — keadaan `main` sebelum PR pertama — GNU
   xargs tetap menjalankan `cat` tanpa argumen dan perintahnya menggantung menunggu stdin.)

   Bentuk ini tetap benar di PR terakhir, saat blok inline habis (`awk` menghasilkan nol baris) —
   dan di PR itu `<script></script>` yang tinggal kosong ikut dihapus.
2. **Urutan tag.** Tag PR baru **disisipkan di ATAS** tag yang sudah ada (urutan sumber:
   potongan yang lebih awal di file lama = dimuat lebih dulu). Penjaga:
   ```sh
   [ "$(grep -n 'src="/js/' index.html | head -1 | cut -d: -f1)" -gt \
     "$(grep -n '^</script>$' index.html | cut -d: -f1)" ] && echo "ORDER OK"
   ```
3. **`npx playwright test --project=hermetic`** hijau, plus satu entri baru di tabel `SENTINEL`
   (`tests/smoke/boot-integrity.spec.js`) **per file** yang lahir — testnya sengaja merah untuk
   file `js/*.js` tanpa sentinel, dan itu satu-satunya cek yang membuktikan file benar-benar
   termuat & dieksekusi di browser.

**Kontrol negatif cukup sekali, tidak per PR.** Sudah dijalankan di PR #136 (cabut satu tag →
merah; file tanpa sentinel → merah): yang dibuktikan adalah *mekanismenya* menggigit, dan
mekanismenya tak berubah antar-PR. Ulangi hanya bila penjaganya sendiri diubah.

## Urutan & prasyarat

1. PR #135 (sync `js/` di jalur deploy) — **sudah merge & sudah lewat satu tick.**
2. PR #136 (ekor, 425 baris) — **harus merge lebih dulu** sebelum PR-2 dimulai; dua PR pemecahan
   tak boleh hidup bersamaan di `index.html`.
3. PR-2 … PR-10 berurutan, satu per satu, masing-masing dengan protokol di atas. Commit penawar
   (`posPressedMove`, `candleTooltipCustom`) mendarat sebelum PR-6 dan PR-8.

Sesudah PR-10, `index.html` tinggal markup + daftar `<script src>`, dan gerbang test untuk
perubahan kecil tak lagi harus seluruh suite — itu tujuan akhir Fase 2.
