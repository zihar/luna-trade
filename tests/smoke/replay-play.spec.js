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

async function setupPlay(page) {
  await gotoApp(page, {
    beforeGoto: (p) =>
      p.route('**/api/candles**', async (r) => {
        await new Promise((s) => setTimeout(s, LATENCY_MS));
        await r.fallback();
      }),
  });
  // H1 → forming bar disusun dari sub-bar M1 yang di-fetch on-demand (jalur yang dulu memblokir).
  await page.evaluate(() => switchTF('H1'));
  await page.waitForFunction(() => currentTF === 'H1' && tfData.H1 && tfData.H1.length > 200);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => replayMode === true);
  // Mundurkan cursor jauh dari ujung data supaya Play tak langsung pause karena kehabisan bar.
  await page.evaluate(() => {
    const a = tfData[currentTF];
    T = barEndAt(currentTF, 150, a); fillT = T; replayPartial = null; render(true);
  });
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
  const gaps = await page.evaluate(async () => {
    const frames = [];
    const orig = window.render;
    window.render = function (...a) { frames.push(performance.now()); return orig.apply(this, a); };
    play();
    await new Promise((r) => setTimeout(r, 4000));
    pause();
    window.render = orig;
    // Abaikan 1 dtk pertama: jendela bar PERTAMA memang belum ada di cache (belum sempat di-prefetch).
    const t0 = frames[0] + 1000;
    const f = frames.filter((t) => t >= t0);
    return f.slice(1).map((t, i) => t - f[i]);
  });
  expect(gaps.length, 'Play harus menghasilkan frame').toBeGreaterThan(20);
  // Speed 1× di H1 = ±1 bar/dtk → 3 pergantian bar di jendela ukur. Dulu masing-masing jeda ≈ latensi.
  const stalls = gaps.filter((g) => g > LATENCY_MS * 0.8);
  expect(stalls, `frame tertahan ≈ latensi fetch (${LATENCY_MS}ms)`).toEqual([]);
  assertNoPageErrors(page);
});
