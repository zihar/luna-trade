// Trend-Based Fib Extension (ala TradingView, js/overlays-custom.js): 3 titik A (awal gerak),
// B (akhir gerak), C (akhir koreksi); level = C + (B−A)·Lv. Yang dijaga: rumus proyeksi, default
// level TERPISAH dari Fib Retracement (br_fibExtLevels ≠ br_fibLevels), dan tab Style bersama
// (daftar level per objek) bekerja tanpa chip Reverse yang hanya bermakna utk Retracement.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');

const figs = (page, id) => page.evaluate((i) => {
  const o = chart.getOverlayById(i), C = klinecharts.getOverlayClass('fibExtension');
  const coords = chart.convertToPixel(o.points, { paneId: 'candle_pane' });
  return new C({}).createPointFigures({ overlay: o, coordinates: coords, bounding: { width: 800, height: 400 } })
    .map((f) => ({ type: f.type, text: f.attrs.text, c: f.attrs.coordinates }));
}, id);

test('Fib Extension: level = C + (B−A)·Lv, trend A→B→C, default level sendiri', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'fibExtension');
  expect(obj && obj.name).toBe('fibExtension');
  expect(obj.points.length).toBe(3);
  const lv = await page.evaluate((i) => objStyle[i].fibLevels.map((l) => l.value), obj.id);
  expect(lv, 'snapshot default Extension (ala TV)').toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
  expect(await page.evaluate(() => fibLevels.map((l) => l.value)), 'default Retracement tak tersentuh').toEqual([0, 0.5, 1]);

  // harga tiap level dihitung dari titik yang benar-benar tersimpan
  await page.evaluate((i) => setObjStyle(i, { fibShowPrices: true, fibShowLevels: false }), obj.id);
  const [A, B, C] = obj.points.map((p) => p.value);
  const want = await page.evaluate(([a, b, c, L]) => L.map((v) => fmtPx(c + (b - a) * v)), [A, B, C, lv]);
  const F = await figs(page, obj.id);
  expect(F.filter((f) => f.type === 'text').map((f) => f.text).sort()).toEqual([...want].sort());
  // level 0 tepat di harga C, level 1 di C + (B−A)
  const px = await page.evaluate((pts) => chart.convertToPixel(pts, { paneId: 'candle_pane' }), obj.points);
  const lines = F.filter((f) => f.type === 'line' && f.c.length === 2 && f.c[0].y === f.c[1].y);
  const yC = px[2].y, y1 = px[2].y + (px[1].y - px[0].y);
  expect(lines.some((l) => Math.abs(l.c[0].y - yC) <= 0.5), 'level 0 di C').toBe(true);
  expect(lines.some((l) => Math.abs(l.c[0].y - y1) <= 0.5), 'level 1 di C+(B−A)').toBe(true);
  // trend line putus-putus melewati 3 titik
  const trend = F.find((f) => f.type === 'line' && f.c.length === 3);
  expect(trend, 'trend A→B→C').toBeTruthy();
  // garis level selebar rentang X B..C
  expect(Math.min(...lines.map((l) => l.c[0].x))).toBeCloseTo(Math.min(px[1].x, px[2].x), 0);
  expect(Math.max(...lines.map((l) => l.c[1].x))).toBeCloseTo(Math.max(px[1].x, px[2].x), 0);
  assertNoPageErrors(page);
});

test('Fib Extension: tab Style — level per objek menulis default Extension, tanpa Reverse', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'fibExtension');
  await page.evaluate((i) => openObjSettings(chart.getOverlayById(i), 10, 10, 'style'), obj.id);
  const modal = page.locator('.dmodal-scrim.show');
  await expect(modal.locator('.dm-title')).toHaveText('Trend-Based Fib Extension');
  await expect(modal.locator('.dm-tab[data-tab="coords"]')).toHaveCount(1);
  const pane = modal.locator('.dm-pane[data-pane="style"]');
  await expect(pane.locator('[data-fflag="fibReverse"]')).toHaveCount(0);
  await expect(pane.locator('[data-ftrend]')).toHaveClass(/\bon\b/);
  const rows = pane.locator('.fp-row');
  await expect(rows).toHaveCount(11);
  await rows.nth(1).locator('.fp-on').uncheck();
  expect(await page.evaluate((i) => objStyle[i].fibLevels[1].on, obj.id)).toBe(false);
  const saved = await page.evaluate(() => ({ ext: JSON.parse(localStorage.getItem('br_fibExtLevels')), ret: localStorage.getItem('br_fibLevels') }));
  expect(saved.ext[1].on).toBe(false);
  expect(saved.ret, 'Retracement tak ikut berubah').toBeNull();
  await pane.locator('#fpReset').click();
  await expect(rows).toHaveCount(11);
  await page.keyboard.press('Escape');
  const persisted = await page.evaluate(() => serializeDraws().filter((d) => d.name === 'fibExtension'));
  expect(persisted.length).toBe(1);
  expect(persisted[0].points.length).toBe(3);
  assertNoPageErrors(page);
});
