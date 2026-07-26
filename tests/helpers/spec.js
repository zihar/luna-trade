// TOOL_SPEC — tabel EKSPEKTASI untuk semua tool drawing. Satu sumber kebenaran; test
// mengiterasi tabel ini, bukan menuliskan ulang daftar tool di tiap spec.
//
// Ini spec, bukan cerminan kode: kolom `anchor` menyatakan bagaimana tool SEHARUSNYA
// menambatkan sumbu X. Keputusan desain (docs/superpowers/specs/2026-07-25-e2e-ui-drawing-design.md):
// semua tool wajib presisi sub-bar (preview == final, mendarat di titik klik), KECUALI tool
// yang penambatan-per-bar-nya memang disengaja dan beralasan di kode:
//   - verticalStraightLine — penanda waktu harus = waktu candle yang diklik (index.html:590)
//   - longPosition / shortPosition — entry harus mendarat di center candle terpilih,
//     snapTimeToBar eksplisit dengan alasan tertulis (index.html:3408-3412)
//
// clicks      = jumlah klik untuk menyelesaikan objek (TERVERIFIKASI lewat penemuan otomatis
//               atas ke-24 tool, termasuk 9 overlay built-in klinecharts).
// pointsAfter = jumlah titik SETELAH onDrawEnd. Sebagian tool mengembang: rect & fib3 → 8
//               titik (expandBox, index.html:796), posisi → 6 titik (expandPosition,
//               index.html:3397). Karena itu parity/landing dibandingkan lewat pencocokan
//               titik TERDEKAT, bukan per-indeks.
// anchor      = 'subbar' (wajib ≤1px dari titik klik) | 'bar' (boleh snap ke bar terdekat)
// text        = null | 'modal' | 'modal+inline' (DM_TEXT_OBJS / ADDTEXT_CLICK, index.html:5546)
// autoEditor  = true bila editor teks inline terbuka sendiri setelah objek jadi
//               (applyTextInput → editTextOverlay, index.html:3306) → test wajib menutupnya.
// persist     = ada di PERSIST_DRAW (index.html:3158) → wajib bertahan setelah reload.
// settings    = 'modal' (double-click → modal Style|Text) | 'pospopup' (long/shortPosition
//               dialihkan ke showPosPopup, index.html:5573) | null (tak ada di DRAW_DEFAULT
//               index.html:715 → memang tak punya panel setting).

const TOOL_SPEC = [
  // ---- Trend Lines ----
  { name: 'trendline', group: 'trend', groupTitle: 'Trend Lines', title: 'Trend Line', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: 'modal+inline', settings: 'modal', persist: true, sc: 'T' },
  { name: 'rayLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Ray', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'Y', builtin: true },
  { name: 'straightLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Extended Line', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'E', builtin: true },
  { name: 'horizontalStraightLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Horizontal Line', clicks: 1, pointsAfter: 1, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'H' },
  // Horizontal Ray: klik ke-2 hanya menentukan arah/panjang di sumbu X — Y-nya WAJIB diabaikan,
  // kalau tidak garisnya tak lagi horizontal. Jadi landing Y klik ke-2 memang tak dinilai.
  { name: 'horizontalRayLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Horizontal Ray', clicks: 2, pointsAfter: 2, anchor: 'subbar', clickAxes: ['xy', 'x'], text: null, settings: 'modal', persist: true, builtin: true },
  { name: 'verticalStraightLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Vertical Line', clicks: 1, pointsAfter: 1, anchor: 'bar', anchorWhy: 'penanda waktu = waktu candle yang diklik (index.html:590)', text: null, settings: 'modal', persist: true, sc: 'V' },
  { name: 'priceLine', group: 'trend', groupTitle: 'Trend Lines', title: 'Price Line', clicks: 1, pointsAfter: 1, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'P', builtin: true },

  // ---- Channels ----
  { name: 'parallelStraightLine', group: 'channel', groupTitle: 'Channels', title: 'Parallel Channel', clicks: 3, pointsAfter: 3, anchor: 'subbar', text: null, settings: 'modal', persist: true, builtin: true },
  { name: 'priceChannelLine', group: 'channel', groupTitle: 'Channels', title: 'Price Channel', clicks: 3, pointsAfter: 3, anchor: 'subbar', text: null, settings: 'modal', persist: true, builtin: true },

  // ---- Fibonacci ----
  { name: 'fib3', group: 'fib', groupTitle: 'Fibonacci', title: 'Fib Retracement', clicks: 2, pointsAfter: 8, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'F' },
  { name: 'fibonacciLine', group: 'fib', groupTitle: 'Fibonacci', title: 'Fib Line', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true, builtin: true },

  // ---- Shapes ----
  { name: 'rect', group: 'shapes', groupTitle: 'Shapes', title: 'Rectangle', clicks: 2, pointsAfter: 8, anchor: 'subbar', text: 'modal+inline', settings: 'modal', persist: true, sc: 'R' },
  { name: 'circle', group: 'shapes', groupTitle: 'Shapes', title: 'Circle', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'O' },
  { name: 'ellipse', group: 'shapes', groupTitle: 'Shapes', title: 'Ellipse', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true },
  { name: 'arrow', group: 'shapes', groupTitle: 'Shapes', title: 'Arrow', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true, sc: 'A' },
  { name: 'arrowMarkUp', group: 'shapes', groupTitle: 'Shapes', title: 'Arrow Mark Up', clicks: 1, pointsAfter: 1, anchor: 'subbar', text: null, settings: 'modal', persist: true },
  { name: 'arrowMarkDown', group: 'shapes', groupTitle: 'Shapes', title: 'Arrow Mark Down', clicks: 1, pointsAfter: 1, anchor: 'subbar', text: null, settings: 'modal', persist: true },

  // ---- Positions ----
  { name: 'longPosition', group: 'positions', groupTitle: 'Positions', title: 'Long Position', clicks: 1, pointsAfter: 6, anchor: 'bar', anchorWhy: 'entry mendarat di center candle terpilih (index.html:3408-3412)', text: null, settings: 'pospopup', persist: true },
  { name: 'shortPosition', group: 'positions', groupTitle: 'Positions', title: 'Short Position', clicks: 1, pointsAfter: 6, anchor: 'bar', anchorWhy: 'entry mendarat di center candle terpilih (index.html:3408-3412)', text: null, settings: 'pospopup', persist: true },
  { name: 'dateRange', group: 'positions', groupTitle: 'Positions', title: 'Date Range', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: null, settings: 'modal', persist: true },

  // ---- Text ----
  { name: 'text', group: 'text', groupTitle: 'Text', title: 'Text', clicks: 1, pointsAfter: 1, anchor: 'subbar', text: 'modal', autoEditor: true, settings: 'modal', persist: true, sc: 'X' },
  { name: 'callout', group: 'text', groupTitle: 'Text', title: 'Callout', clicks: 2, pointsAfter: 2, anchor: 'subbar', text: 'modal+inline', autoEditor: true, settings: 'modal', persist: true },
  // simpleAnnotation ("Annotation") & simpleTag ("Tag") DITARIK dari rail 2026-07-27 (Temuan 3),
  // jadi keduanya keluar dari tabel ini — bukan karena testnya rewel, tapi karena tool-nya tak ada
  // lagi di UI. Keduanya overlay bawaan klinecharts yang menandai semua figure-nya
  // `ignoreEvent:true` → sekali tergambar tak bisa di-hover/dipilih/di-drag/dihapus lewat klik.
  // Tak diperbaiki karena redundan (simpleTag ≈ priceLine, simpleAnnotation ≈ callout/arrowMark).
  // Penjaga agar tak diam-diam kembali: tests/drawing/50-rail.spec.js describe "tool yang ditarik".
];
// Nama tool yang sengaja DITARIK dari UI. Dipakai penjaga di 50-rail.spec.js — ditaruh di sini
// supaya satu file tetap jadi sumber kebenaran soal "tool apa yang ada & tak ada".
const RETIRED_TOOLS = [
  { name: 'simpleAnnotation', title: 'Annotation', why: 'figure ber-ignoreEvent → tak bisa dijangkau; redundan dgn callout/arrowMark' },
  { name: 'simpleTag', title: 'Tag', why: 'figure ber-ignoreEvent → tak bisa dijangkau; redundan dgn priceLine' },
];

// Mode cursor (bukan overlay — mengubah crosshair global, index.html:3509).
const CURSOR_MODES = [
  { name: 'cross', title: 'Cross', crosshair: true, line: true },
  { name: 'dot', title: 'Dot', crosshair: true, line: false },
  { name: 'arrow', title: 'Arrow (no crosshair)', crosshair: false, line: false },
  { name: 'eraser', title: 'Eraser (click object to delete)', crosshair: true, line: true },
];

// Toleransi pixel. Y selalu ketat: tak ada tool yang boleh men-snap harga (kecuali magnet ON).
const TOL_SUBBAR_PX = 1.0;
const TOL_Y_PX = 1.0;

/** Toleransi X untuk satu tool, mengingat barSpace saat itu. */
function tolX(spec, barSpacePx) {
  return spec.anchor === 'bar' ? barSpacePx / 2 + 1 : TOL_SUBBAR_PX;
}

/** Sumbu klik ke-i yang bermakna: 'xy' (default), 'x', atau 'y'. */
function axisOf(spec, i) {
  return (spec.clickAxes && spec.clickAxes[i]) || 'xy';
}

const byName = (n) => TOOL_SPEC.find((t) => t.name === n);
const inGroup = (g) => TOOL_SPEC.filter((t) => t.group === g);
const withShortcut = () => TOOL_SPEC.filter((t) => t.sc);
const multiPoint = () => TOOL_SPEC.filter((t) => t.clicks > 1);

module.exports = { TOOL_SPEC, RETIRED_TOOLS, CURSOR_MODES, TOL_SUBBAR_PX, TOL_Y_PX, tolX, axisOf, byName, inGroup, withShortcut, multiPoint };
