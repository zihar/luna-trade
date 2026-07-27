// Stub /api/candles yang mensimulasikan keadaan SESUDAH tab lama idle: candle yang sudah
// dimuat klien ketinggalan beberapa periode, sementara candle INCOMPLETE (seed) di server
// sudah berada di periode kini.
//
// Kenapa lag-nya dipasang di respons muatan awal, bukan dengan memundurkan jam:
// server sungguhan selalu punya data segar — yang tertinggal adalah KLIEN, karena timer-nya
// di-throttle/di-freeze saat tab tak terlihat. Keadaan akhir yang perlu diuji sama saja:
// `tfData` ketinggalan N periode, `formingSeed` di periode kini, `live=true`, `T=last+DUR`.
// Membuat muatan awal berhenti di periode lama adalah cara termurah untuk sampai ke sana
// tanpa memalsukan waktu (fake timer akan ikut membekukan rAF & seluruh polling aplikasi).
//
// Respons meniru passthrough OANDA di candlesHandler (main.go):
//   { candles: [{ time, mid:{o,h,l,c}, volume, complete }] }
// dan meniru tiga bentuk permintaan yang dipakai frontend:
//   count=5000 (loadInit)      → hanya sampai bar tutup "lama"
//   count=2    (fetchFormingSeed) → [bar tutup TERAKHIR di server, bar incomplete periode kini]
//   from=…     (autoExtend)    → bar tutup yang terlewat + bar incomplete periode kini

const M15_MS = 15 * 60 * 1000;
const BASE = 1.0865;
const PIP = 0.0001;

// Hash → [0,1). Harga jadi fungsi MURNI dari indeks periode, jadi bar dengan timestamp sama
// selalu punya OHLC sama di semua bentuk permintaan (muatan awal, seed, autoExtend).
function h(n) {
  let t = (n >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const closeOf = (k) => BASE + Math.sin(k / 37) * 20 * PIP + (h(k) - 0.5) * 4 * PIP;

function bar(ts, tfMs, complete) {
  const k = Math.round(ts / tfMs);
  const o = closeOf(k - 1); // open = close periode sebelumnya → seri nyambung, tanpa gap harga
  const c = closeOf(k);
  const hi = Math.max(o, c) + h(k ^ 0x9e37) * 2 * PIP;
  const lo = Math.min(o, c) - h(k ^ 0x51ed) * 2 * PIP;
  const d = (v) => v.toFixed(5);
  return {
    time: new Date(ts).toISOString().replace('.000Z', '.000000000Z'),
    mid: { o: d(o), h: d(hi), l: d(lo), c: d(c) },
    volume: 200 + Math.floor(h(k ^ 0x1234) * 1800),
    complete,
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ tfMs?: number, lagBars?: number, deadBars?: number, bars?: number, now?: number }} opts
 *   lagBars  — berapa bar TUTUP yang server punya tapi klien belum muat (default 3) = kasus idle
 *   deadBars — berapa periode KOSONG antara bar tutup terakhir & bar berjalan; meniru boundary
 *              sah yang bukan kelipatan grid (H4/D align 18:00 NY, gap akhir pekan). Di sini
 *              tak ada bar yang terlewat — forming bar HARUS tetap digambar.
 * @returns {{ tfMs, staleLast }} titik henti klien (server dihitung ulang tiap permintaan)
 */
async function installLaggingCandles(page, opts = {}) {
  const tfMs = opts.tfMs || M15_MS;
  const lagBars = opts.lagBars == null ? 3 : opts.lagBars;
  const deadBars = opts.deadBars || 0;
  const bars = opts.bars || 300;
  const now = opts.now || Date.now();

  // Titik henti KLIEN tetap (dihitung sekali). Sisi SERVER dihitung ulang tiap permintaan dari
  // jam sekarang — kalau test kebetulan berjalan melewati batas periode, server ikut maju
  // seperti aslinya dan test tetap sah (lag/zona mati-nya cuma bertambah satu bar).
  const staleLast = Math.floor(now / tfMs) * tfMs - (lagBars + deadBars + 1) * tfMs;

  await page.route('**/api/candles*', (route) => {
    const url = new URL(route.request().url());
    const count = +url.searchParams.get('count') || 0;
    const from = url.searchParams.get('from');
    const formingOpen = Math.floor(Date.now() / tfMs) * tfMs; // periode yang sedang berjalan
    // Bar tutup terakhir yang server punya. Dgn zona mati, ia dipatok relatif ke titik henti
    // klien supaya periode kosongnya tetap kosong (bukan berubah jadi bar yang "terlewat").
    const serverLast = deadBars ? staleLast + lagBars * tfMs : formingOpen - tfMs;
    const missing = [];
    for (let ts = staleLast + tfMs; ts <= serverLast; ts += tfMs) missing.push(ts);
    let candles;

    if (from) {
      // autoExtend: semua bar tutup sesudah `from`, plus bar berjalan (incomplete).
      const after = Date.parse(from);
      candles = missing.filter((ts) => ts >= after).map((ts) => bar(ts, tfMs, true));
      candles.push(bar(formingOpen, tfMs, false));
    } else if (count === 2) {
      // fetchFormingSeed: bentuk persis OANDA count=2 → [tutup terakhir, berjalan].
      candles = [bar(serverLast, tfMs, true), bar(formingOpen, tfMs, false)];
    } else {
      // loadInit: berhenti di bar tutup "lama" → klien lahir dalam keadaan ketinggalan.
      candles = [];
      for (let i = bars - 1; i >= 0; i--) candles.push(bar(staleLast - i * tfMs, tfMs, true));
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ instrument: 'EUR_USD', granularity: 'M15', candles }),
    });
  });

  return { tfMs, staleLast };
}

module.exports = { installLaggingCandles, M15_MS };
