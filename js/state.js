// ===================== state =====================
let inst = 'EUR_USD';
const tfData = {};       // { 'M15':[{timestamp,open,high,low,close,volume}], ... } native asc
let currentTF = 'M15';
let T = null;            // cursor time (ms) = close-time candle TF tampil saat ini
let lastLen = -1;
let chartHasPartial = false;   // bar terakhir di chart adalah forming bar sintetis (replay) → perlu tahu utk buang/timpa
let playing = false, playTimer = null;
let live = false, liveTimer = null;
let trade = null;        // {dir,entry,sl,tp,risk,units,trail,time,lineEntry,lineSL,lineTP}
let pending = null;      // order menunggu harga tersentuh (Fase 1c)
let lotsManual = false;  // true setelah user ubah lot/stepper manual → Risk% berhenti auto-isi lot
let alerts = [];         // price alert dari server: {id,sym,price,triggeredAt,oid} (oid=id overlay chart lokal)
let quoteCache = {};     // harga terkini per simbol utk watchlist (candle harian, fallback)
let liveTicks = {};      // bid/ask realtime per simbol dari SSE /api/prices (Lapis 4)
let wlBuilt = false;     // watchlist: node baris dibangun sekali, lalu di-update in-place (anti flicker)
let wlNodes = {};        // sym -> {row,bid,ask,spr,hi,lo} referensi node span per baris
let priceTimerEl = null; // pill countdown candle berikutnya (mode Live)
let chartWmEl = null;    // watermark identitas Luna di kanvas (crescent + simbol·TF)
let axisTimeEl = null;   // label waktu sumbu-X saat hover area future
let formingBar = null;       // candle berjalan (live) yg di-update tiap tick stream
let formingSeed = null;      // candle incomplete OANDA (OHLC otoritatif periode berjalan) → seed wick
let replayPartial = null;    // {tf,candle}: bar berjalan sintetis TF aktif @ cursor T (mode replay)
const REPLAY_FRAME_MS = 40;  // ~25fps render saat Play halus
let fillT = null;            // frontier eksekusi intra-bar: fill/alert sudah dievaluasi s/d ms ini (replay); hanya-maju
let secondaries = [];        // panel chart sekunder (multi-chart, view-only) — diisi setLayout()
let chartLayout = 1;         // jumlah panel: 1 | 2 | 4
let formingTimer = null;     // poll seed forming dari OANDA (lebih sering dari liveRefresh)
let rollRefreshPending = false;
let journal = [];
let drawIds = [];        // overlay drawing
const extending = {};

