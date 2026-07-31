// Lock objek gambar. Di smoke (gerbang PR) karena proteksinya menyentuh jalur hapus milik SEMUA
// tool (Delete, eraser, Remove-all) dan jalur persist.
//
// Assertion lewat PERILAKU (objek tak bergeser / tak terhapus), bukan cuma membaca flag.
//
// Rancangan: docs/superpowers/specs/2026-07-31-lock-drawings-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays } = require('../helpers/draw');

/** Titik tengah objek dalam pixel container-relative (untuk drag badan). */
function midOf(page, id) {
  return page.evaluate((oid) => {
    const p = chart.getOverlayById(oid).points;
    const f = (a) => (Array.isArray(a) ? a[0] : a);
    const c = p.map((q) =>
      f(
        chart.convertToPixel(
          q.timestamp != null ? { timestamp: q.timestamp, value: q.value } : { dataIndex: q.dataIndex, value: q.value },
          { paneId: 'candle_pane', absolute: true }
        )
      )
    );
    return { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
  }, id);
}

const pointsOf = (page, id) => page.evaluate((oid) => JSON.stringify(chart.getOverlayById(oid).points), id);

test.describe('lock: inti & persistensi', () => {
  test('objek terkunci tak bisa digeser; yang tak terkunci bergeser dgn gestur sama', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');

    // pembanding dulu: gestur ini MEMANG menggeser objek saat tak terkunci
    const before = await pointsOf(page, obj.id);
    const mid = await midOf(page, obj.id);
    await page.mouse.move(rect.x + mid.x, rect.y + mid.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + mid.x + 40, rect.y + mid.y + 30, { steps: 6 });
    await page.mouse.up();
    const moved = await pointsOf(page, obj.id);
    expect(moved, 'gestur pembanding harus benar-benar menggeser').not.toBe(before);

    // kunci, lalu ulangi gestur yang sama dari posisi barunya
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    expect(await page.evaluate((id) => isLocked(id), obj.id)).toBe(true);
    const mid2 = await midOf(page, obj.id);
    await page.mouse.move(rect.x + mid2.x, rect.y + mid2.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + mid2.x + 50, rect.y + mid2.y + 40, { steps: 6 });
    await page.mouse.up();
    expect(await pointsOf(page, obj.id), 'objek terkunci tak boleh bergeser').toBe(moved);
    assertNoPageErrors(page);
  });

  test('handle disembunyikan saat terkunci, kembali saat dibuka', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'rect');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    expect(await page.evaluate((id) => chart.getOverlayById(id).styles.point.color, obj.id)).toBe('transparent');
    await page.evaluate((id) => setDrawLock(id, false), obj.id);
    expect(await page.evaluate((id) => chart.getOverlayById(id).styles.point.color, obj.id)).not.toBe('transparent');
    assertNoPageErrors(page);
  });

  test('status kunci bertahan setelah reload', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    await page.waitForTimeout(500); // debounce saveDraws 350ms

    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 1, null, { timeout: 8000 });
    const o = (await overlays(page))[0];
    expect(o.lock, 'lock ikut tersimpan & dipulihkan').toBe(true);
    expect(await page.evaluate(() => chart.getOverlayById(drawIds[0]).styles.point.color)).toBe('transparent');
    assertNoPageErrors(page);
  });

  test('undo tak menghasilkan objek dobel walau ada yang terkunci', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate((id) => setDrawLock(id, true), obj.id);
    await page.waitForTimeout(500);
    await drawTool(page, 'rect');
    await page.waitForTimeout(500);
    expect((await overlays(page)).length).toBe(2);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect((await overlays(page)).length, 'clearDrawings internal harus tetap tanpa syarat').toBe(1);
    assertNoPageErrors(page);
  });
});
