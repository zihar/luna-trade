// Timing klik saat menggambar.
//
// Temuan yang dijaga spec ini: lapisan synthetic-event klinecharts mendeteksi double-click
// TANPA memeriksa jarak, jadi dua klik berjeda < ~400ms dianggap satu double-click dan klik
// ke-2 DITELAN → objek tak pernah selesai. DOM #chart sendiri menerima dua `click` normal
// (detail=1), jadi ini murni lapisan chart, bukan browser.
//
// Dampak nyata: user yang menggambar cepat (kebiasaan wajar, dan mulus di TradingView)
// kehilangan klik ke-2 dan harus mengklik lagi.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, overlays } = require('../helpers/draw');

/** Coba selesaikan trendline dengan 2 klik berjeda `gap` ms. */
async function drawWithGap(page, rect, gap) {
  await page.evaluate(() => drawIds.slice().forEach((id) => chart.removeOverlay(id)));
  await page.keyboard.press('Escape');
  await armTool(page, 'trendline');
  const pts = [
    { x: Math.round(rect.width * 0.34), y: Math.round(rect.height * 0.5) },
    { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.25) },
  ];
  const domClicks = [];
  await page.evaluate(() => {
    window.__clicks = [];
    if (!window.__clickSpy) {
      window.__clickSpy = true;
      document.getElementById('chart').addEventListener('click', (e) => window.__clicks.push(e.detail), true);
    }
  });
  for (let i = 0; i < pts.length; i++) {
    await page.mouse.move(rect.x + pts[i].x, rect.y + pts[i].y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    if (i < pts.length - 1) await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({ inProgress: inProgressId != null, clicks: window.__clicks.slice(), n: drawIds.length }));
  domClicks.push(...st.clicks);
  return { finished: !st.inProgress, domClicks, count: st.n };
}

test.describe('timing klik', () => {
  test('jeda longgar (≥450ms): 2 klik menyelesaikan objek', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const r = await drawWithGap(page, rect, 450);
    expect(r.finished, 'objek harus selesai dengan 2 klik berjeda longgar').toBe(true);
    const objs = await overlays(page);
    expect(objs).toHaveLength(1);
    expect(objs[0].points).toHaveLength(2);
    assertNoPageErrors(page);
  });

  test('klik cepat (120ms): klik ke-2 TIDAK boleh tertelan', async ({ page }) => {
    // EKSPEKTASI, bukan rekaman perilaku: menggambar cepat harus tetap jadi. Kalau merah,
    // itu gap UX vs TradingView di lapisan klinecharts — bukan test yang salah.
    await gotoApp(page);
    const rect = await chartRect(page);
    const r = await drawWithGap(page, rect, 120);

    // Bukti bahwa browser MEMANG mengirim dua klik normal (bukan dblclick browser):
    expect(r.domClicks, 'DOM #chart harus menerima dua click detail=1').toEqual([1, 1]);
    expect(r.finished, 'objek harus selesai walau dua klik berjeda 120ms').toBe(true);
  });

  test('ambang penelanan terdokumentasi: cari jeda minimum yang berhasil', async ({ page }) => {
    // Bukan assertion perilaku — ini pengukuran yang dilaporkan ke output test supaya
    // angka ambangnya terlihat dan bisa dibandingkan setelah upgrade klinecharts.
    await gotoApp(page);
    const rect = await chartRect(page);
    const results = [];
    for (const gap of [100, 200, 300, 350, 400, 500]) {
      const r = await drawWithGap(page, rect, gap);
      results.push(`${gap}ms→${r.finished ? 'jadi' : 'tertelan'}`);
    }
    const firstOk = [100, 200, 300, 350, 400, 500].find((g, i) => results[i].endsWith('jadi'));
    console.log(`  ambang klik: ${results.join('  ')}  → jeda minimum yang berhasil: ${firstOk ?? 'tak ada'}ms`);
    test.info().annotations.push({ type: 'ambang-klik', description: results.join(' ') });
    expect(firstOk, 'harus ada jeda yang berhasil, kalau tidak harness-nya rusak').toBeTruthy();
  });
});
