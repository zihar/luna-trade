// Analytics (admin): kerangka .dmodal, teks Inggris; ganti tab, ✕ & Esc menutup.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Analytics: kerangka .dmodal, tab By user, Esc & ✕ menutup', async ({ page }) => {
  await gotoApp(page);
  await page.route('**/api/analytics*', r => r.fulfill({ json: {
    active_users: { d1: 1, d7: 2, d30: 3 },
    features: [{ name: 'draw', count: 5, users: 1 }],
    users: [{ email: 'a@b.c', events: 5, last_seen: null, features: [{ name: 'draw', count: 5 }] }] } }));
  await page.evaluate(() => openAnalyticsDashboard(30));
  const box = page.locator('#anModal .dmodal');
  await expect(box.locator('.dm-title')).toContainText('Analytics');
  await expect(box.locator('.an-tbl')).toContainText('draw');
  await box.locator('.an-tabs button[data-v="users"]').click();
  await expect(box.locator('.an-user')).toContainText('a@b.c');
  await page.keyboard.press('Escape');
  await expect(page.locator('#anModal')).toBeHidden();
  await page.evaluate(() => openAnalyticsDashboard(7));
  await box.locator('.dm-x').click();
  await expect(page.locator('#anModal')).toBeHidden();
  assertNoPageErrors(page);
});
