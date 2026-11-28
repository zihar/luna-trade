// Klik "goyang" saat menggambar: mousedown → tangan bergeser beberapa piksel → mouseup.
//
// Di TradingView itu tetap KLIK: titiknya tertanam dan chart tak bergeser. Di klinecharts mentah,
// geseran ≥5px (manhattan) saat tombol ditekan langsung membatalkan klik (`_cancelClick`) dan
// berubah jadi pan → titik HILANG, chart bergeser, dan pendingClicks (dicatat Luna di mousedown)
// jadi desync: Esc pada Path menyimpan titik karet, refine onDrawEnd memasang klik yang salah.
// Penawarnya di js/draw-pointer.js (DRAW_CLICK_SLOP_PX). Seret yang benar-benar jauh tetap pan.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, overlays, defaultTargets, commitTextEditor, openFlyout, CLICK_GAP_MS } = require('../helpers/draw');
const { TOOL_SPEC } = require('../helpers/spec');

// 5px kanan + 3px bawah: manhattan 8 (≥5 → klinecharts membatalkan klik), euclid ≈5,8px.
const WIGGLE = { dx: 5, dy: 3 };

async function wiggleClick(page, rect, p, w = WIGGLE) {
  await page.mouse.move(rect.x + p.x, rect.y + p.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(rect.x + p.x + w.dx, rect.y + p.y + w.dy, { steps: 3 });
  await page.mouse.up();
}

const offsetRight = (page) => page.evaluate(() => chart.getOffsetRightDistance());

test.describe('klik goyang saat menggambar', () => {
  for (const spec of TOOL_SPEC) {
    test(`${spec.name}: klik goyang menanam titik & tak pan`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      await armTool(page, spec.name);
      const off0 = await offsetRight(page);
      const T = defaultTargets(rect, spec.clicks);
      for (let i = 0; i < T.length; i++) {
        await wiggleClick(page, rect, T[i]);
        if (i < T.length - 1) {
          await page.waitForTimeout(CLICK_GAP_MS);
          expect(await page.evaluate(() => pendingClicks.length), `pendingClicks setelah klik ${i + 1}`).toBe(i + 1);
        }
      }
      await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
      expect(await offsetRight(page), 'chart tak boleh bergeser (pan)').toBe(off0);
      if (spec.autoEditor) await commitTextEditor(page);
      if (!spec.ephemeral) {
        const objs = (await overlays(page)).filter((o) => o.name === spec.name);
        expect(objs, 'objek harus terbentuk').toHaveLength(1);
        expect(objs[0].points).toHaveLength(spec.pointsAfter);
      }
      assertNoPageErrors(page);
    });
  }

  test('path: klik goyang tak meninggalkan titik karet saat Esc', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await openFlyout(page, 'shapes');
    await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Path$/ }) }).click();
    await page.waitForFunction(() => inProgressId != null && chart.getOverlayById(inProgressId).name === 'path', null, { timeout: 3000 });
    const off0 = await offsetRight(page);
    const T = defaultTargets(rect, 3);
    for (const t of T) { await wiggleClick(page, rect, t); await page.waitForTimeout(CLICK_GAP_MS); }
    await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.6, { steps: 6 });   // karet, belum diklik
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    expect(await offsetRight(page)).toBe(off0);
    const o = (await overlays(page)).filter((x) => x.name === 'path');
    expect(o).toHaveLength(1);
    expect(o[0].points, '3 klik goyang = 3 titik, tanpa titik karet').toHaveLength(3);
    assertNoPageErrors(page);
  });

  test('seret jauh saat menggambar tetap pan, dan tak meninggalkan klik hantu', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    const off0 = await offsetRight(page);
    const T = defaultTargets(rect, 2);
    await wiggleClick(page, rect, T[0], { dx: 80, dy: 0 });
    await page.waitForTimeout(CLICK_GAP_MS);
    expect(await offsetRight(page), 'seret 80px = pan').not.toBe(off0);
    expect(await page.evaluate(() => pendingClicks.length), 'pan bukan klik').toBe(0);
    expect(await page.evaluate(() => inProgressId != null), 'tool tetap armed').toBe(true);
    // gambar tetap bisa diselesaikan normal setelahnya
    for (const t of T) { await wiggleClick(page, rect, t, { dx: 0, dy: 0 }); await page.waitForTimeout(CLICK_GAP_MS); }
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    const o = (await overlays(page)).filter((x) => x.name === 'trendline');
    expect(o).toHaveLength(1);
    expect(o[0].points).toHaveLength(2);
    assertNoPageErrors(page);
  });
});
