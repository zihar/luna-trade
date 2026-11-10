// Konfirmasi tutup/ubah posisi: dialog .dmodal di tengah; Cancel/✕/Esc/klik scrim membatalkan, tombol aksi memanggil callback.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('miniConfirm: kerangka .dmodal, Cancel/Esc batal, tombol aksi jalan', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { window.__r = []; miniConfirm('Close position #1?', 'Close', () => __r.push('yes'), () => __r.push('no')); });
  const box = page.locator('.pos-confirm .dmodal');
  await expect(box.locator('.dm-title')).toHaveText('Confirm close');
  await expect(box.locator('.pc-msg')).toHaveText('Close position #1?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pos-confirm')).toBeHidden();
  await page.evaluate(() => miniConfirm('Change SL to 1.0?', 'Save', () => __r.push('yes'), () => __r.push('no')));
  await expect(box.locator('.dm-title')).toHaveText('Confirm change');
  await box.locator('.pc-yes').click();
  await expect(page.locator('.pos-confirm')).toBeHidden();
  expect(await page.evaluate(() => __r)).toEqual(['no', 'yes']);
  assertNoPageErrors(page);
});
