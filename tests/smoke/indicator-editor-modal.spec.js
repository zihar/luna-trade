// Editor parameter indikator: modal gaya .dmodal (bukan popup .objpop); live-apply, +Add/Reset, Esc/✕ menutup.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Indicator editor: modal terbuka, param berubah live, Add/Reset, Esc menutup', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => openIndEditor('MA'));
  const m = page.locator('.dmodal-scrim.show .ind-editor');
  await expect(m.locator('.dm-title')).toHaveText(/MA|Moving/);
  await expect(page.locator('.objpop.show')).toHaveCount(0);
  const first = m.locator('.ie-num').first();
  await first.fill('7');
  await expect.poll(() => page.evaluate(() => effParams('MA')[0])).toBe(7);
  const n0 = await m.locator('.ie-num').count();
  await m.locator('.ie-add').click();
  await expect(m.locator('.ie-num')).toHaveCount(n0 + 1);
  await m.locator('.ie-reset').click();
  expect(await page.evaluate(() => effParams('MA').join())).toBe(await page.evaluate(() => defParams('MA').join()));
  await page.keyboard.press('Escape');
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  await page.evaluate(() => openIndEditor('MA'));
  await page.locator('.ind-editor .dm-x').click();
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  assertNoPageErrors(page);
});
