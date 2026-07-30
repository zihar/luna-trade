// Keep drawing mode ("Stay in Drawing Mode" ala TradingView): tool tetap aktif setelah objek jadi.
//
// Di smoke (gerbang PR) karena ia menyentuh createDraw/onDrawEnd — jalur yang dipakai SEMUA tool
// gambar. Kalau rearm-nya salah, yang rusak bukan cuma fitur ini tapi setiap tool.
//
// Rancangan: docs/superpowers/specs/2026-07-31-keep-drawing-mode-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { overlays } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

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

/** Dua klik pada posisi berbeda (jeda 400ms — jebakan klik canvas, tests/README.md). */
async function twoClicks(page, rect, ax = 0.35, ay = 0.6, bx = 0.55, by = 0.4) {
  await page.mouse.click(rect.x + rect.width * ax, rect.y + rect.height * ay);
  await page.waitForTimeout(400);
  await page.mouse.click(rect.x + rect.width * bx, rect.y + rect.height * by);
}

test.describe('keep drawing: rearm', () => {
  test('nyala → dua trendline berturut-turut tanpa menyentuh rail lagi', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await twoClicks(page, rect);
    // objek pertama jadi → tool HARUS aktif lagi (rearm async, beri waktu satu tick)
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('trendline');

    await page.waitForTimeout(400);
    await twoClicks(page, rect, 0.6, 0.7, 0.78, 0.5);
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    const jadi = (await overlays(page)).filter((o) => o.name === 'trendline' && o.points.length >= 2);
    expect(jadi.length, 'dua objek selesai tanpa mengklik rail lagi').toBe(2);
    assertNoPageErrors(page);
  });

  test('mati (default) → tool disarm setelah objek jadi (perilaku lama)', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(300); // beri kesempatan rearm yang tak boleh terjadi
    expect(await page.evaluate(() => inProgressId), 'toggle mati → tetap disarm').toBeNull();
    assertNoPageErrors(page);
  });

  test('Alt+H saat nyala → satu garis jatuh, tool armed kembali TANPA menjatuhkan garis kedua', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.45, { steps: 4 });
    await page.keyboard.press('Alt+H');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await page.waitForTimeout(400);

    const hlines = (await overlays(page)).filter((o) => o.name === 'horizontalStraightLine');
    // 1 garis yang sudah jatuh + 1 overlay in-progress hasil rearm
    expect(hlines.length, 'rearm non-instant: tak ada garis kedua yang jatuh sendiri').toBe(2);
    const prog = await page.evaluate(() => inProgressId);
    expect(hlines.filter((o) => o.id !== prog).length, 'tepat satu garis yang benar-benar jatuh').toBe(1);
    assertNoPageErrors(page);
  });

  test('measure tak di-rearm walau toggle nyala', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => inProgressId), 'measure ephemeral → tak di-rearm').toBeNull();
    assertNoPageErrors(page);
  });

  test('Esc membatalkan objek in-progress tapi toggle tetap nyala', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#keepDrawBtn').click();

    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+T');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await twoClicks(page, rect);
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => inProgressId), 'Esc membatalkan gambar in-progress').toBeNull();
    expect(await page.evaluate(() => keepDrawOn), 'Esc TIDAK mematikan preferensi').toBe(true);
    assertNoPageErrors(page);
  });
});
