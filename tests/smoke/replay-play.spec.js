// Kelancaran Play Bar Replay (`playFrame()` di js/replay-control.js).
//
// Kenapa file ini ada. Play terasa "stuck & patah-patah" karena dua hal di loop frame (~25×/dtk):
//  1. render() memanggil updateChartLegend() tiap frame → chart.setStyles() membuat klinecharts
//     menggambar ulang seluruh chart + layout paksa. Terukur ~14 ms/frame (±60% biaya render).
//  2. Jendela sub-bar (forming bar) di-fetch & di-await DI DALAM frame → di tiap pergantian bar
//     kasar chart diam selama satu round-trip /api/candles.
// Test di bawah menahan keduanya. Latensi jaringan disimulasikan 300ms supaya (2) terlihat.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

const LATENCY_MS = 300;

async function setupPlay(page, tf = 'H1') {
  await gotoApp(page, {
    beforeGoto: (p) =>
      p.route('**/api/candles**', async (r) => {
        await new Promise((s) => setTimeout(s, LATENCY_MS));
        await r.fallback();
      }),
  });
  // H1 → forming bar disusun dari sub-bar M1 yang di-fetch on-demand (jalur yang dulu memblokir).
  await page.evaluate((t) => switchTF(t), tf);
  await page.waitForFunction((t) => currentTF === t && tfData[t] && tfData[t].length > 200, tf);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => replayMode === true);
  // Mundurkan cursor jauh dari ujung data supaya Play tak langsung pause karena kehabisan bar.
  await page.evaluate(() => {
    const a = tfData[currentTF];
    T = barEndAt(currentTF, 150, a); fillT = T; replayPartial = null; render(true);
  });
}

// Ukur kelancaran Play selama `ms`, dinormalisasi terhadap CPU. Di samping frame render() dicatat
// heartbeat setInterval(40ms) yang tak ada hubungannya dgn replay: bila CPU kelaparan (worker
// Playwright paralel), heartbeat ikut tersendat persis sama (terukur maxF≈maxH, ±10 frame/3 dtk
// di keduanya). Jeda frame yang TAK dialami heartbeat = loop menunggu sesuatu selain CPU — fetch.
//   ratio  = frame / heartbeat (dulu 10×: ±0,1; sekarang ±1)
//   stalls = jeda frame > ambang yang tak tumpang-tindih jeda heartbeat > 150ms
async function measurePlay(page, { ms, skipMs, stallMs }) {
  return page.evaluate(async ({ ms, skipMs, stallMs }) => {
    const fr = [], hb = [];
    const orig = window.render;
    window.render = function (...a) { fr.push(performance.now()); return orig.apply(this, a); };
    const h = setInterval(() => hb.push(performance.now()), 40);
    play();
    await new Promise((r) => setTimeout(r, ms));
    pause();
    clearInterval(h);
    window.render = orig;
    const t0 = (fr[0] ?? performance.now()) + skipMs;
    const f = fr.filter((t) => t >= t0), b = hb.filter((t) => t >= t0);
    const spans = (a, min) => a.slice(1).map((t, i) => [a[i], t]).filter(([x, y]) => y - x > min);
    const hbGaps = spans(b, 150);
    const stalls = spans(f, stallMs)
      .filter(([x, y]) => !hbGaps.some(([c, d]) => c < y && d > x))
      .map(([x, y]) => Math.round(y - x));
    return { frames: f.length, beats: b.length, ratio: f.length / Math.max(1, b.length), stalls };
  }, { ms, skipMs, stallMs });
}

test('replay Play: render per-frame tak memanggil chart.setStyles', async ({ page }) => {
  await setupPlay(page);
  const n = await page.evaluate(async () => {
    let calls = 0;
    const orig = chart.setStyles.bind(chart);
    chart.setStyles = (...a) => { calls++; return orig(...a); };
    play();
    await new Promise((r) => setTimeout(r, 2000));
    pause();
    chart.setStyles = orig;
    return calls;
  });
  expect(n, 'setStyles = redraw penuh; tak boleh terjadi tiap frame Play').toBe(0);
  assertNoPageErrors(page);
});

test('replay Play: pergantian bar tak menahan loop frame selama fetch sub-bar', async ({ page }) => {
  await setupPlay(page);
  // Abaikan 1 dtk pertama: jendela bar PERTAMA memang belum ada di cache (belum sempat di-prefetch).
  const m = await measurePlay(page, { ms: 4000, skipMs: 1000, stallMs: LATENCY_MS * 0.8 });
  expect(m.ratio, `Play harus jalan selaju heartbeat (${JSON.stringify(m)})`).toBeGreaterThan(0.7);
  // Speed 1× di H1 = ±1 bar/dtk → 3 pergantian bar di jendela ukur. Dulu masing-masing jeda ≈ latensi.
  expect(m.stalls, `frame tertahan ≈ latensi fetch (${LATENCY_MS}ms)`).toEqual([]);
  assertNoPageErrors(page);
});

// Speed tinggi. Satu frame bisa maju speed×0,25 dtk (clamp elapsed) → di 10× ±2,5 bar per frame:
// prefetch tetap 2 bar terlewati tiap frame, sehingga TIAP frame dulu menunggu satu round-trip
// (terukur 5–6 frame dalam 3 dtk, ±2 fps). Test 1× di atas tak melihat ini kecuali CPU sedang sibuk.
// Varian "posisi terbuka" memaksa jalur evalFills (fill intra-bar) yang juga butuh jendela sub-bar.
// TF M15, bukan H1: fixture hermetic memakai bar M15 untuk SEMUA TF, jadi "H1" di sini 4× lebih rapat
// dari DUR.H1 → 10× = ±40 jendela/dtk, melampaui kapasitas fisik (±6 koneksi / 300ms). Di M15 jarak
// bar = DUR → 10 bar/dtk, sama dengan data nyata; sub-bar M1 tetap di-fetch on-demand.
for (const withTrade of [false, true]) {
  test(`replay Play 10×${withTrade ? ' + posisi terbuka' : ''}: frame tak menunggu fetch sub-bar`, async ({ page }) => {
    await setupPlay(page, 'M15');
    if (withTrade) {
      await page.evaluate(() => {
        const c = currentCandle();
        trades.length = 0;
        // SL/TP jauh → posisi tetap terbuka selama ukur; yang diuji hanya kelancaran frame.
        trades.push({ id: -77, no: 77, dir: 'long', entry: c.close, sl: c.close * 0.5, tp: c.close * 2,
          risk: 1, units: 1000, trail: 0, instrument: inst, time: T, fillFrom: T });
      });
    }
    await page.locator('#speed').evaluate((s) => { s.value = '10'; });
    const m = await measurePlay(page, { ms: 3000, skipMs: 500, stallMs: LATENCY_MS * 0.8 });
    expect(m.ratio, `Play 10× harus jalan selaju heartbeat (${JSON.stringify(m)})`).toBeGreaterThan(0.7);
    expect(m.stalls, `frame tertahan ≈ latensi fetch (${LATENCY_MS}ms)`).toEqual([]);
    if (withTrade) expect(await page.evaluate(() => trades.length), 'posisi tak boleh tertutup').toBe(1);
    assertNoPageErrors(page);
  });
}
