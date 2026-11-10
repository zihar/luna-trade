// Create alert: dialog gaya .dmodal (bukan .alert-modal lama); buka/tutup & validasi harga.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Create alert: modal .dmodal terbuka, Esc & Cancel menutup, harga tak valid ditolak', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => openAlertDialog());
  const m = page.locator('#alertModal.show .dmodal');
  await expect(m.locator('.dm-title')).toContainText('Create alert on');
  await expect(page.locator('.alert-modal')).toHaveCount(0);
  await m.locator('#amPrice').fill('');
  await m.locator('#amCreate').click();
  await expect(page.locator('#alertModal.show')).toHaveCount(1);   // harga kosong → tetap terbuka
  await m.locator('#amPrice').press('Escape');
  await expect(page.locator('#alertModal.show')).toHaveCount(0);
  await page.evaluate(() => openAlertDialog());
  await page.locator('#amCancel').click();
  await expect(page.locator('#alertModal.show')).toHaveCount(0);
  assertNoPageErrors(page);
});
