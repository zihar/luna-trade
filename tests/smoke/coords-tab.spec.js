// Tab Coordinates (harga + nomor bar) — versi ringan untuk gerbang PR. Cakupan lengkap per tool
// ada di tests/drawing/41-modal-coords.spec.js yang dijalankan CI saat push ke `main`.
//
// Di smoke karena tab ini MENULIS ke points objek: kalau jalur tulis-baliknya rusak, ia merusak
// objek gambar apa pun, bukan cuma tampilan modal.
//
// Rancangan: docs/superpowers/specs/2026-08-10-coordinates-tab-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays } = require('../helpers/draw');

test.describe('tab Coordinates', () => {
  test('ubah harga di tab Coordinates memindahkan titik objek', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => openDrawModal(chart.getOverlayById(id), 'coords'), obj.id);

    const pane = page.locator('.dmodal .dm-pane[data-pane="coords"]');
    await expect(pane).toBeVisible();

    const before = (await overlays(page))[0];
    const target = +(before.points[0].value * 1.001).toFixed(5);
    const inp = pane.locator('input[data-cf="p0"]');
    await inp.fill(String(target));
    await inp.press('Enter');

    const after = (await overlays(page))[0];
    expect(after.points[0].value, 'titik 1 pindah ke harga yang diketik').toBeCloseTo(target, 5);
    expect(after.points[1].value, 'titik 2 tak ikut bergerak').toBeCloseTo(before.points[1].value, 6);
    assertNoPageErrors(page);
  });

  test('input tak valid dikembalikan, objek tak bergerak', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => openDrawModal(chart.getOverlayById(id), 'coords'), obj.id);

    const before = (await overlays(page))[0];
    const inp = page.locator('.dmodal .dm-pane[data-pane="coords"] input[data-cf="p0"]');
    const shown = await inp.inputValue();
    await inp.fill('');
    await inp.press('Enter');

    await expect(inp).toHaveClass(/bad/);
    expect(await inp.inputValue()).toBe(shown);
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(before.points[0].value, 6);
    assertNoPageErrors(page);
  });
});
