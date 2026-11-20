// Halaman tak boleh lebih lebar dari layar, dan tak boleh bisa tergeser ke samping.
// Regresi: #alertsPane tertutup (translateX(100%)) menjorok 300px ke kanan; body overflow:hidden
// hanya menahan gulir pengguna — satu tekan Tab memfokuskan tombol "+" di panel tertutup dan
// browser menggulir SELURUH layar 300px ke kiri (dan tetap di situ).
const { test, expect } = require('@playwright/test');
const { gotoApp } = require('../helpers/app');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await gotoApp(page);
});

test('dokumen tak lebih lebar dari layar', async ({ page }) => {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw).toBe(r.cw);
});

test('Tab & fokus programatik tak menggeser layar', async ({ page }) => {
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  const r = await page.evaluate(async () => {
    const el = document.querySelector('#alertAddBtn');
    el.focus(); el.scrollIntoView();
    await new Promise(res => setTimeout(res, 50));
    return { x: document.scrollingElement.scrollLeft, app: document.querySelector('.app').scrollLeft,
             paneFocused: !!document.activeElement.closest('#alertsPane') };
  });
  expect(r).toEqual({ x: 0, app: 0, paneFocused: false });
});

test('panel Alerts tetap bisa dibuka & dipakai', async ({ page }) => {
  await page.evaluate(() => setAlertsPane(true));
  await expect(page.locator('#alertAddBtn')).toBeVisible();
  await page.evaluate(() => setAlertsPane(false));
  await expect(page.locator('#alertAddBtn')).toBeHidden();
});
