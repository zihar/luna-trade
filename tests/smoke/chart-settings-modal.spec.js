// Chart settings: modal gaya .dmodal (bukan popup mengambang); warna live-apply & Reset.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Chart settings: modal terbuka, warna tertulis ke chartCfg, Reset & Esc bekerja', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => showChartSet());
  const m = page.locator('.dmodal-scrim.show .dmodal');
  await expect(m.locator('.dm-title')).toHaveText('Chart settings');
  await expect(page.locator('.objpop.show')).toHaveCount(0);
  await m.locator('input[data-k="up"]').fill('#123456');
  expect(await page.evaluate(() => chartCfg.up)).toBe('#123456');
  await m.locator('#csReset').click();
  expect(await page.evaluate(() => chartCfg.up)).toBe(await page.evaluate(() => CHART_DEFAULT.up));
  await page.keyboard.press('Escape');
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  assertNoPageErrors(page);
});
