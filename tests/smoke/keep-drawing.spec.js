// Keep drawing mode ("Stay in Drawing Mode" ala TradingView): tool tetap aktif setelah objek jadi.
//
// Di smoke (gerbang PR) karena ia menyentuh createDraw/onDrawEnd — jalur yang dipakai SEMUA tool
// gambar. Kalau rearm-nya salah, yang rusak bukan cuma fitur ini tapi setiap tool.
//
// Rancangan: docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test.describe('keep drawing: toggle & persistensi', () => {
  test('default mati; klik menyalakan, menulis localStorage, dan bertahan setelah reload', async ({ page }) => {
    await gotoApp(page);

    expect(await page.evaluate(() => keepDrawOn), 'default harus mati (sama dgn TradingView)').toBe(false);
    const btn = page.locator('#keepDrawBtn');
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveClass(/armed/);
    expect(await btn.getAttribute('title'), 'teks UI wajib Inggris').toMatch(/drawing mode/i);

    await btn.click();
    expect(await page.evaluate(() => keepDrawOn)).toBe(true);
    await expect(btn).toHaveClass(/armed/);
    expect(await page.evaluate(() => localStorage.getItem('br_keepdraw'))).toBeTruthy();

    await page.reload();
    await page.waitForFunction(() => typeof keepDrawOn !== 'undefined');
    expect(await page.evaluate(() => keepDrawOn), 'status bertahan setelah reload').toBe(true);
    await expect(page.locator('#keepDrawBtn')).toHaveClass(/armed/);

    await page.locator('#keepDrawBtn').click();
    expect(await page.evaluate(() => keepDrawOn), 'klik kedua mematikan').toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('br_keepdraw'))).toBeFalsy();
    assertNoPageErrors(page);
  });
});
