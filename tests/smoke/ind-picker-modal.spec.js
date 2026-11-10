// Indicators picker: kerangka .dmodal (header dm-head, ✕ dm-x); Esc & ✕ menutup, pencarian menyaring.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Indicators picker: tampil dengan kerangka .dmodal, cari menyaring, Esc & ✕ menutup', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#indBtn').click();
  const box = page.locator('#indModal .dmodal');
  await expect(box.locator('.dm-title')).toHaveText('Indicators');
  const all = await page.locator('#indList .ind-row').count();
  await page.locator('#indSearch').fill('rsi');
  await expect.poll(() => page.locator('#indList .ind-row').count()).toBeLessThan(all);
  await page.keyboard.press('Escape');
  await expect(page.locator('#indModal')).toBeHidden();
  await page.locator('#indBtn').click();
  await box.locator('.dm-x').click();
  await expect(page.locator('#indModal')).toBeHidden();
  assertNoPageErrors(page);
});
