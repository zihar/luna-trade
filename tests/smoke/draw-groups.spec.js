// Pengelompokan rail drawing mengikuti TradingView (diverifikasi di TV 2026-11-27): urutan & nama
// grup = tooltip rail TV, flyout memakai judul seksi TV (LINES / CHANNELS, ...). Key grup sengaja
// tetap nilai lama (dipakai localStorage), dan grup `channel` yang dilebur ke `trend` tak boleh
// membuang favorite lama pengguna.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { openFlyout } = require('../helpers/draw');

test('rail: urutan & nama grup ala TradingView', async ({ page }) => {
  await gotoApp(page);
  const groups = await page.evaluate(() => DRAW_GROUPS.map((g) => g.key + '|' + g.title));
  expect(groups).toEqual([
    'cursor|Cursors', 'trend|Trend tools', 'fib|Gann and Fibonacci tools',
    'positions|Forecasting and measurement tools', 'shapes|Geometric shapes', 'text|Annotation tools', 'measure|Measure',
  ]);
  const rail = await page.locator('#drawtools .dt-cat').evaluateAll((els) => els.map((e) => e.dataset.cat));
  expect(rail).toEqual(['cursor', 'trend', 'fib', 'positions', 'shapes', 'text', 'measure']);
  assertNoPageErrors(page);
});

test('flyout: judul seksi ala TV, tool di bawah seksinya', async ({ page }) => {
  await gotoApp(page);
  const read = () => page.locator('#dtFlyout > *').evaluateAll((els) => els.map((e) =>
    e.classList.contains('dt-fly-title') ? '#' + e.textContent : e.querySelector('.dt-nm').textContent));
  await openFlyout(page, 'trend');
  expect(await read()).toEqual(['#LINES', 'Trend Line', 'Ray', 'Extended Line', 'Horizontal Line', 'Horizontal Ray',
    'Vertical Line', 'Price Line', '#CHANNELS', 'Parallel Channel', 'Price Channel']);
  await page.keyboard.press('Escape');
  await openFlyout(page, 'shapes');
  expect(await read()).toEqual(['#ARROWS', 'Arrow', 'Arrow Mark Up', 'Arrow Mark Down',
    '#SHAPES', 'Rectangle', 'Path', 'Circle', 'Ellipse']);
  await page.keyboard.press('Escape');
  await openFlyout(page, 'positions');
  expect(await read()).toEqual(['#FORECASTING', 'Long Position', 'Short Position', '#MEASURERS', 'Date Range']);
  await page.keyboard.press('Escape');
  await openFlyout(page, 'cursor');                       // tanpa seksi → satu judul = nama grup
  expect((await read())[0]).toBe('#CURSORS');
  assertNoPageErrors(page);
});

test('Geometric shapes default Rectangle walau seksi Arrows di atas', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('#drawtools .dt-cat[data-cat="shapes"]')).toHaveAttribute('data-tool', 'rect');
  assertNoPageErrors(page);
});

test('favorite lama di grup `channel` (dilebur) dimigrasi ke `trend`', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('br_fav_tools', JSON.stringify(['channel:parallelStraightLine', 'priceChannelLine', 'trend:rayLine']));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await gotoApp(page);
  const favs = await page.evaluate(() => JSON.parse(localStorage.getItem('br_fav_tools')));
  expect(favs).toEqual(['trend:parallelStraightLine', 'trend:priceChannelLine', 'trend:rayLine']);
  const btn = page.locator('#favBar .favbar-btn').first();
  await expect(btn).toHaveAttribute('title', 'Trend tools: Parallel Channel');
  await btn.click();
  await page.waitForFunction(() => inProgressId != null && chart.getOverlayById(inProgressId).name === 'parallelStraightLine', null, { timeout: 3000 });
  assertNoPageErrors(page);
});
