// Editor level Fibonacci: modal gaya .dmodal; tambah/hapus/reset level, Esc & ✕ menutup.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Fibonacci levels: modal terbuka, Add/hapus/Reset bekerja, Esc menutup', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => showFibPop());
  const m = page.locator('.dmodal-scrim.show .fib-modal');
  await expect(m.locator('.dm-title')).toHaveText('Fibonacci levels');
  await expect(page.locator('.fibpop')).toHaveCount(0);
  const n0 = await page.evaluate(() => fibLevels.length);
  await expect(m.locator('.fp-row')).toHaveCount(n0);
  await m.locator('#fpAdd').click();
  await expect(m.locator('.fp-row')).toHaveCount(n0 + 1);
  expect(await page.evaluate(() => fibLevels.length)).toBe(n0 + 1);
  await m.locator('.fp-x').last().click();
  await expect(m.locator('.fp-row')).toHaveCount(n0);
  await m.locator('#fpReset').click();
  expect(await page.evaluate(() => fibLevels.length)).toBe(await page.evaluate(() => defaultFibLevels().length));
  await page.keyboard.press('Escape');
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  await page.evaluate(() => showFibPop());
  await page.locator('.fib-modal .dm-x').click();
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  assertNoPageErrors(page);
});
