// "Other symbols" di Object Tree (js/draw-object-tree.js → fetchObjOther/renderObjOther): daftar
// instrumen LAIN yang punya objek gambar (GET /api/drawings/summary), klik = buka chart simbol itu.
// Chart aktif tak ikut terdaftar; search ikut menyaring; daftar diambil ulang saat instrumen berganti.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Object Tree mendaftar instrumen lain yang punya gambar; klik membuka chart-nya', async ({ page }) => {
  await gotoApp(page);
  const start = await page.evaluate(() => inst);
  // format serializeDraws (lihat tests/drawing/84-draw-sync.spec.js); vt = wall-clock ms
  const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
  const obj = { name: 'trendline', points: [{ vt: ts - 3600000, value: 1.1 }, { vt: ts, value: 1.12 }], lock: 0, extendData: null, style: null };
  await page.evaluate((o) => window.__seedDrawings('GBP_USD', [o, o], 1), obj);
  await page.evaluate((o) => window.__seedDrawings('XAU_USD', [o], 1), obj);
  await page.evaluate(() => window.__seedDrawings('USD_JPY', [], 1));   // kosong → tak terdaftar

  await page.click('#railObjTree');
  const syms = page.locator('#objTreeOther .ot-sym');
  await expect(page.locator('#objTreeOther .ot-oh')).toHaveText('Other symbols');
  await expect(syms).toHaveCount(2);   // chart aktif & USD_JPY (kosong) tak ikut
  expect(await syms.evaluateAll((xs) => xs.map((x) => [x.dataset.sym, x.querySelector('.ot-name').textContent, x.querySelector('.ot-gcount').textContent])))
    .toEqual([['GBP_USD', 'GBPUSD', '2'], ['XAU_USD', 'XAUUSD', '1']]);

  // search ikut menyaring daftar simbol
  await page.locator('#objTreeSearch').fill('xau');
  await expect(syms).toHaveCount(1);
  await expect(syms.first()).toHaveAttribute('data-sym', 'XAU_USD');
  await page.locator('#objTreeSearch').fill('');

  // klik → pindah chart; daftar diambil ulang: GBP_USD (kini chart aktif) hilang. Chart awal tak
  // punya gambar → tetap tak terdaftar.
  await syms.filter({ hasText: 'GBPUSD' }).click();
  await expect.poll(() => page.evaluate(() => inst)).toBe('GBP_USD');
  await expect.poll(() => syms.evaluateAll((xs) => xs.map((x) => x.dataset.sym)))
    .toEqual(['XAU_USD']);
  expect(start).not.toBe('GBP_USD');
  assertNoPageErrors(page);
});
