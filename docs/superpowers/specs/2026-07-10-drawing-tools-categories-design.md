# Drawing Tools Berkategori ala TradingView — Design

Tanggal: 2026-07-10
Status: Disetujui (menunggu review spec)

## Tujuan

Menambah lebih banyak model drawing yang tersedia dan mengelompokkannya ke dalam
kategori dengan pola flyout ala TradingView, menggantikan rail datar 8-tool yang
sekarang. Mengekspos overlay bawaan klinecharts 9.8.10 yang belum dipakai + menambah
beberapa shape/text custom yang belum ada di klinecharts v9.

## Konteks kode saat ini

Semua frontend ada di `index.html` (klinecharts 9.8.10 dari CDN, UMD).

- **`DRAW_TOOLS`** (array datar, ~baris 3845): sumber tombol rail. Di-render ke
  `#drawtools` (`.drawtools`, rail 42px). Tiap tombol `onclick → createDraw(name, btn)`.
- **`createDraw(name, btn, extra)`** (~3550): `chart.createOverlay({name, ...delHooks()})`,
  set `inProgressId`, arm tombol.
- **`DRAW_DEFAULT`** (~1663): default per-tool `{color,size,style,textAlign,textValign}`
  (untuk popup styling & render teks).
- **`BUILTIN_LINE`** (~1676): overlay garis bawaan yang di-styling via `styles.line`
  (bukan `createPointFigures`). Saat ini hanya `horizontalStraightLine`, `verticalStraightLine`.
- **`PERSIST_DRAW`** (~3573): whitelist overlay yang di-serialize ke localStorage
  per-instrumen (`br_draws_<inst>`), restore tahan refresh/ganti TF.
- **`MAGNET_REFINE_SKIP`** (~1632): overlay yang dilewati saat refine magnet.
- **`registerOverlay`**: custom overlay sudah ada untuk `rect`, `trendline`, `fib3`,
  `longPosition`, `shortPosition`, `dateRange`, + axis figures.
- Styling helper: `dstyle(o)`, `klineLineStyles(st)`, `setObjStyle(id, patch)`, `objStyle{}`.
- Rail bawah: magnet (`#magBtn`), hide (`#hideDrawBtn`), trash (flyout `openRemoveMenu`).

Semua teks yang tampil ke UI **bahasa Inggris** (memori `ui-text-english`).

## Struktur kategori final

Rail kiri jadi daftar **ikon kategori**; klik ikon → flyout ke kanan berisi tool-nya.
Ikon rail = tool terakhir yang dipilih dari kategori itu (disimpan
`localStorage['br_lasttool_<cat>']`). Urutan rail atas→bawah:

**Cursor · Trend Lines · Channels · Fibonacci · Shapes · Positions · Text**
→ spacer → **magnet · hide · trash** (tak diubah).

### 0. Cursor
Bukan overlay — mengubah mode kursor global + membatalkan mode gambar aktif.
Pilihan terakhir diingat di `localStorage['br_cursor']`.

| Tool | Fungsi | Implementasi |
|---|---|---|
| Cross | Crosshair penuh (H+V) — default | `chart.setStyles({crosshair:{horizontal:{show:true},vertical:{show:true}}})` |
| Dot | Titik di kursor, garis penuh off | crosshair garis off + titik on |
| Arrow | Pointer biasa, crosshair mati | `chart.setStyles({crosshair:{show:false}})` |
| Eraser | Klik objek → hapus objek itu | mode hapus: klik overlay → `removeOverlay` |

Memilih Cursor apa pun = `disarmIcons()` + hentikan mode gambar (batal `inProgressId`).

### 1. Trend Lines
| Tool | name overlay | sumber |
|---|---|---|
| Trend Line | `trendline` | custom existing (punya +Add text — dipertahankan) |
| Ray | `rayLine` | bawaan |
| Extended Line | `straightLine` | bawaan |
| Horizontal Line | `horizontalStraightLine` | bawaan (existing) |
| Horizontal Ray | `horizontalRayLine` | bawaan |
| Vertical Line | `verticalStraightLine` | bawaan (existing) |
| Price Line | `priceLine` | bawaan |

### 2. Channels
| Tool | name overlay | sumber |
|---|---|---|
| Parallel Channel | `parallelStraightLine` | bawaan |
| Price Channel | `priceChannelLine` | bawaan |

### 3. Fibonacci
| Tool | name overlay | sumber |
|---|---|---|
| Fib Retracement | `fib3` | custom existing |
| Fib Line | `fibonacciLine` | bawaan |

### 4. Shapes
| Tool | name overlay | sumber |
|---|---|---|
| Rectangle | `rect` | custom existing |
| Circle | `circle` | **custom baru** |
| Ellipse | `ellipse` | **custom baru** |
| Arrow | `arrow` | **custom baru** |

### 5. Positions
| Tool | name overlay | sumber |
|---|---|---|
| Long Position | `longPosition` | existing |
| Short Position | `shortPosition` | existing |
| Date Range | `dateRange` | existing |

### 6. Text
| Tool | name overlay | sumber |
|---|---|---|
| Text | `text` | custom existing |
| Callout | `callout` | **custom baru** |
| Annotation | `simpleAnnotation` | bawaan |
| Tag | `simpleTag` | bawaan |

## Komponen & perubahan

### A. Data model kategori
Ganti `DRAW_TOOLS` (array datar) dengan `DRAW_GROUPS` (array kategori):

```js
const DRAW_GROUPS = [
  { key:'cursor', title:'Cursor', cursor:true, tools:[
      {name:'cross', title:'Cross', svg:'…'},
      {name:'dot', title:'Dot', svg:'…'},
      {name:'arrow', title:'Arrow (no crosshair)', svg:'…'},
      {name:'eraser', title:'Eraser', svg:'…'},
  ]},
  { key:'trend', title:'Trend Lines', tools:[ … ] },
  … dst
];
```

`cursor:true` menandai grup Cursor (handler beda: set mode kursor, bukan `createDraw`).

### B. Render rail + flyout
- Untuk tiap grup: buat 1 tombol ikon `.dtool.dt-cat` di `#drawtools`.
  Ikon awal = tool terakhir (`localStorage['br_lasttool_<key>']`) atau tool pertama.
- Klik tombol kategori → toggle flyout `.dt-flyout` di kanan tombol (posisi via
  `getBoundingClientRect`). Flyout berisi baris `.dt-item` (ikon + label English).
- Klik `.dt-item`:
  - grup biasa → `createDraw(name, catBtn)`; set ikon kategori = ikon tool;
    simpan `localStorage['br_lasttool_<key>']`; tutup flyout; arm tombol kategori.
  - grup cursor → `setCursorMode(name)`; simpan `localStorage['br_cursor']`;
    set ikon kategori; tutup flyout.
- Tutup flyout: klik di luar (listener window, `stopPropagation` di tombol/flyout
  seperti pola `openRemoveMenu`), pilih tool, atau Esc.
- CSS baru: `.dt-cat`, `.dt-flyout`, `.dt-item` — ikuti token warna existing
  (`--panel`, `--border`, `--txt`, `--accent`), konsisten dgn `.ctxMenu`/remove menu.

### C. Cursor mode
```js
let cursorMode = localStorage.getItem('br_cursor') || 'cross';
let eraserOn = false;
function setCursorMode(name){
  // batalkan mode gambar aktif
  if(inProgressId){ try{chart.removeOverlay(inProgressId);}catch(_){}
    drawIds = drawIds.filter(id=>id!==inProgressId); inProgressId=null; }
  disarmIcons();
  eraserOn = (name==='eraser');
  cursorMode = name; localStorage.setItem('br_cursor', name);
  if(name==='cross') chart.setStyles({crosshair:{show:true, horizontal:{show:true}, vertical:{show:true}}});
  else if(name==='dot') chart.setStyles({crosshair:{show:true, horizontal:{line:{show:false}}, vertical:{line:{show:false}}}});
  else if(name==='arrow') chart.setStyles({crosshair:{show:false}});
  else if(name==='eraser') { /* crosshair biar cross; klik overlay → hapus */ }
}
```
Eraser: pada handler klik overlay (hover), bila `eraserOn` → `removeOverlay(hoverId)`
lalu update `drawIds`/`saveDraws()`. Detail exact crosshair style dot diverifikasi
ke API klinecharts 9.8.10 saat implementasi (fallback: dot = titik crosshair aktif,
garis disamarkan). Setelah eraser dipakai, tetap eraser sampai user pilih cursor lain.

### D. Overlay custom baru
`registerOverlay` untuk `circle`, `ellipse`, `arrow`, `callout` — pola sama seperti
`rect`/`trendline` existing (2 titik, `createPointFigures` pakai `dstyle(overlay)` untuk
`color/size/style`, `delHooks()` untuk select/right-click styling popup).
- `circle`: 2 titik = pusat + tepi → figure `circle` (radius = jarak pixel).
- `ellipse`: 2 titik = sudut kotak pembatas → figure ellipse (rx/ry).
- `arrow`: 2 titik = pangkal→ujung; garis + kepala panah (2 ruas garis).
- `callout`: 2 titik = anchor + posisi kotak teks; kotak + garis penunjuk + teks
  (pakai `extendData` + `openOverlayTextEditor`, reuse alur teks trendline/rect).

### E. Integrasi sistem existing
Tiap tool baru didaftarkan ke:
- **`DRAW_DEFAULT`**: entri default `{color:'#4a71ff',size:1,style:'solid', …}`.
  Garis bawaan (rayLine, straightLine, horizontalRayLine, priceLine,
  parallelStraightLine, priceChannelLine, fibonacciLine) → default `style` mengikuti
  selera (solid untuk trend, dotted untuk price line — final saat implementasi).
- **`BUILTIN_LINE`**: tambah semua overlay **garis bawaan** baru (rayLine,
  straightLine, horizontalRayLine, verticalRayLine?, priceLine, parallelStraightLine,
  priceChannelLine, fibonacciLine) → di-styling via `styles.line` & persist benar.
  (circle/ellipse/arrow/callout/simpleAnnotation/simpleTag TIDAK masuk BUILTIN_LINE —
  di-styling via createPointFigures / default.)
- **`PERSIST_DRAW`**: tambahkan semua name baru agar tersimpan & restore.
- **`MAGNET_REFINE_SKIP`**: tambah yang tak relevan magnet
  (simpleAnnotation, simpleTag, callout, text sudah; priceLine mungkin).
- **`serializeDraws`/`buildDrawsFromArray`**: sudah generik (pakai points vt/value +
  BUILTIN_LINE branch) → otomatis dukung tool baru selama masuk PERSIST_DRAW &
  BUILTIN_LINE dengan benar. Overlay multi-titik >2 (parallelStraightLine 3 titik,
  priceChannelLine) → verifikasi serialisasi points-nya utuh.

## Alur data
1. Load: render `DRAW_GROUPS` → rail + ikon per kategori dari localStorage.
2. Pilih tool draw → `createDraw` → overlay dibuat → user klik titik di chart →
   `onDrawEnd` → `scheduleSaveDraws` → localStorage.
3. Pilih cursor → `setCursorMode` → `chart.setStyles` (tak buat overlay).
4. Reload/ganti TF → `restoreDraws` → `buildDrawsFromArray` (semua tool ter-persist).

## Error handling
- `createOverlay` gagal (name tak dikenal) → `setStatus('Failed to activate '+name, true)`
  (sudah ada di `createDraw`).
- Flyout: guard bila `getBoundingClientRect` di luar viewport → clamp posisi.
- Cursor style tak didukung API → try/catch, fallback ke cross.

## Testing / verifikasi
Manual di browser (pola proyek — tak ada unit test FE):
1. Tiap kategori: buka flyout, pilih tiap tool, gambar di chart, pastikan muncul.
2. Ikon kategori berubah ke tool terakhir & bertahan setelah reload.
3. Persist: gambar tiap tool baru → reload → masih ada; ganti TF → masih ada.
4. Styling: right-click overlay baru → popup style → ubah warna/size → tersimpan.
5. Cursor: Cross/Dot/Arrow ubah crosshair; Arrow mematikan crosshair; Eraser hapus
   objek yang diklik; memilih cursor membatalkan mode gambar aktif.
6. Magnet masih jalan untuk tool garis baru; tidak error untuk text/annotation.

## Non-goals (YAGNI)
Pola kompleks (XABCD, Elliott, Gann, pitchfork), brush/highlighter, emoji/sticker,
kategori Measure/Zoom. Di luar scope.
