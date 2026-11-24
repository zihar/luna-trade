// Candle MENYAMBUNG: open tiap bar yang DIGAMBAR = close bar sebelumnya (gaya FOREX.com).
//
// Kenapa file ini ada. OANDA mengisi `open` dengan tick PERTAMA di periode itu, bukan close bar
// sebelumnya. Diukur di XAU_USD (2026-11-24, 500 bar/TF): 99% bar di SEMUA TF punya celah —
// median $0,03 (M1–H4), $2,6 (D, karena jeda harian 17–18 NY), maks $90 (pembukaan pekan).
// Di chart itu tampil sebagai "gap candle". Pengguna minta semua celah ditutup, termasuk akhir pekan.
//
// Normalisasi dilakukan di lapisan TAMPILAN (js/bar-gapless.js), bukan di tfData: engine fill
// replay & agregasi tetap memakai OHLC asli OANDA. Fixture default sudah menyambung, jadi test
// ini memasang candle bergap sendiri.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

const M15 = 15 * 60 * 1000;
function gappyCandles(n) {
  const t0 = Date.parse('2026-07-10T16:00:00Z');
  const out = [];
  let prevClose = 1.0865;
  for (let i = 0; i < n; i++) {
    // celah selang-seling naik/turun, sebagian besar (± 3 pip) — lebih lebar dari badan bar
    const o = prevClose + (i % 2 ? 1 : -1) * 0.0003 * (1 + (i % 3));
    const c = o + Math.sin(i / 5) * 0.0004;
    const hi = Math.max(o, c) + 0.0001;
    const lo = Math.min(o, c) - 0.0001;
    out.push({
      time: new Date(t0 + i * M15).toISOString(),
      mid: { o: o.toFixed(5), h: hi.toFixed(5), l: lo.toFixed(5), c: c.toFixed(5) },
      volume: 100,
      complete: true,
    });
    prevClose = c;
  }
  return { instrument: 'EUR_USD', granularity: 'M15', candles: out };
}

/** Pelanggaran "menyambung" pada daftar bar yang benar-benar dipegang chart. */
const breaks = (page) =>
  page.evaluate(() => {
    const dl = chart.getDataList();
    const bad = [];
    for (let i = 1; i < dl.length; i++) {
      const p = dl[i - 1], c = dl[i];
      if (c.open !== p.close || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close))
        bad.push({ i, open: c.open, prevClose: p.close, high: c.high, low: c.low });
    }
    return { n: dl.length, bad: bad.slice(0, 5), count: bad.length };
  });

test.describe('candle menyambung (tanpa gap harga)', () => {
  const beforeGoto = async (page) => {
    const body = JSON.stringify(gappyCandles(300));
    await page.route('**/api/candles**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }));
  };

  test('chart: open = close bar sebelumnya, high/low melebar menutup celah', async ({ page }) => {
    await gotoApp(page, { beforeGoto });
    // Prasyarat: data MENTAH memang bergap (kalau tidak, test ini tak menguji apa-apa).
    const rawGaps = await page.evaluate(() => {
      const a = tfData[currentTF];
      let g = 0;
      for (let i = 1; i < a.length; i++) if (a[i].open !== a[i - 1].close) g++;
      return g;
    });
    expect(rawGaps).toBeGreaterThan(100);
    const r = await breaks(page);
    expect(r.n).toBeGreaterThan(100);
    expect(r.bad, `bar bergap di chart (${r.count})`).toEqual([]);
    assertNoPageErrors(page);
  });

  test('magnet menempel ke open yang DIGAMBAR, bukan open mentah OANDA', async ({ page }) => {
    await gotoApp(page, { beforeGoto });
    const r = await page.evaluate(() => {
      const a = revealed(currentTF);
      const i = a.length - 10, bar = a[i], prev = a[i - 1];
      // kursor tepat di harga open MENTAH → kandidat "open" harus bernilai open yang tampak
      const s = magnetSnap(bar.timestamp, bar.open);
      return { rawOpen: bar.open, shownOpen: prev.close, value: s && s.value,
               ohlcShown: [prev.close, Math.max(bar.high, prev.close), Math.min(bar.low, prev.close), bar.close] };
    });
    expect(r.rawOpen).not.toBe(r.shownOpen);
    expect(r.value).not.toBe(r.rawOpen);
    expect(r.ohlcShown).toContain(r.value);
  });
});
