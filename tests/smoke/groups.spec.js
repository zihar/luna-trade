// Grup objek gambar (js/draw-groups.js): Group dari seleksi, klik anggota = seluruh grup,
// seret anggota (terpilih atau belum) = semua ikut, folder di Object Tree + aksi per grup,
// bertahan reload & undo. Di smoke karena menyentuh jalur persist & pressed-move semua tool.
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian PR3)

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

const MOD = 'ControlOrMeta';

/** Piksel (container-relative) semua titik objek. */
function ptsPx(page, id) {
  return page.evaluate((oid) => {
    const f = (a) => (Array.isArray(a) ? a[0] : a);
    return chart.getOverlayById(oid).points.map((q) => {
      const c = f(chart.convertToPixel(
        q.timestamp != null ? { timestamp: q.timestamp, value: q.value } : { dataIndex: q.dataIndex, value: q.value },
        { paneId: 'candle_pane', absolute: true }));
      return { x: c.x, y: c.y };
    });
  }, id);
}
/** Titik di badan garis pada pecahan t (0.5 = tengah). */
async function midOf(page, id, t = 0.5) {
  const c = await ptsPx(page, id);
  return { x: c[0].x + (c[1].x - c[0].x) * t, y: c[0].y + (c[1].y - c[0].y) * t };
}
/** Klik badan (jeda >400ms dari klik sebelumnya, lihat tests/README.md). */
async function clickBody(page, rect, id, mod = false, t = 0.5) {
  await page.waitForTimeout(450);
  const m = await midOf(page, id, t);
  await page.mouse.move(rect.x + m.x, rect.y + m.y, { steps: 3 });
  if (mod) await page.keyboard.down(MOD);
  await page.mouse.down();
  await page.mouse.up();
  if (mod) await page.keyboard.up(MOD);
  await page.waitForTimeout(150);
}
const sel = (page) => page.evaluate(() => [...multiSel].sort());

/** Tiga trendline di pita vertikal berbeda supaya badannya tak saling tumpuk. */
async function drawThree(page) {
  const rect = await chartRect(page);
  const ids = [];
  for (const fy of [0.25, 0.5, 0.75]) {
    const t = await drawTool(page, 'trendline', {
      rect,
      targets: [{ x: Math.round(rect.width * 0.3), y: Math.round(rect.height * fy) },
                { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * (fy + 0.06)) }],
    });
    ids.push(t.obj.id);
  }
  await page.evaluate(() => deselectOverlay());
  await page.waitForTimeout(50);
  return { ids, rect };
}

/** Klik kanan area kosong. Kursor digerakkan bertahap dulu supaya hoverId lepas dari objek
 *  (klik kanan di atas objek membuka modal setelannya, bukan menu). Titik 0,6 lebar: panel
 *  Object Tree yang terbuka menutupi sisi kanan #chart. */
async function rightClickEmpty(page) {
  const rect = await chartRect(page);
  await page.waitForTimeout(450);
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.08, { steps: 4 });
  await page.waitForTimeout(100);
  await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.08, { button: 'right' });
}
const groupRows = (page) => page.locator('#objTreeList .ot-group');
const openTree = async (page) => {
  await page.click('#railObjTree');
  await expect(page.locator('#objTreePane')).toHaveClass(/open/);
};
/** a & b jadi satu grup lewat tombol header Object Tree; c tetap lepas. */
async function groupAB(page, rect, a, b) {
  await clickBody(page, rect, a);
  await clickBody(page, rect, b, true);
  await expect(page.locator('#objTreeGroup')).toBeEnabled();
  await page.click('#objTreeGroup');
  await expect(groupRows(page)).toHaveCount(1);
}

test.describe('groups', () => {
  test('Group dari seleksi; klik anggota memilih seluruh grup; seret anggota yang belum terpilih membawa grup', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await openTree(page);
    await expect(page.locator('#objTreeGroup'), 'butuh ≥2 objek terpilih').toBeDisabled();
    await groupAB(page, rect, a, b);
    await expect(groupRows(page).locator('.ot-name')).toHaveText('Group 1');
    await expect(groupRows(page).locator('.ot-gcount')).toHaveText('2');
    await expect(page.locator('#objTreeList .ot-child')).toHaveCount(2);

    // klik biasa satu anggota = seluruh grup; objek lepas tetap sendiri
    await page.evaluate(() => { msClear(); deselectOverlay(); });
    await clickBody(page, rect, a);
    expect(await sel(page)).toEqual([a, b].sort());
    await expect(groupRows(page)).toHaveClass(/sel/);
    await clickBody(page, rect, c);
    expect(await sel(page)).toEqual([c]);
    // Ctrl/⌘+klik anggota = grup masuk sbg satu kesatuan
    await clickBody(page, rect, b, true);
    expect(await sel(page)).toEqual([a, b, c].sort());

    // seret badan anggota yang BELUM terpilih → seluruh grup ikut, objek lepas diam
    await page.evaluate(() => { msClear(); deselectOverlay(); });
    const [a0, b0, c0] = [await ptsPx(page, a), await ptsPx(page, b), await ptsPx(page, c)];
    await page.waitForTimeout(450);
    const m = await midOf(page, b);
    await page.mouse.move(rect.x + m.x, rect.y + m.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + m.x + 60, rect.y + m.y + 30, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const [a1, b1, c1] = [await ptsPx(page, a), await ptsPx(page, b), await ptsPx(page, c)];
    const dB = { x: b1[0].x - b0[0].x, y: b1[0].y - b0[0].y };
    expect(Math.abs(dB.x), 'objek yang diseret bergeser').toBeGreaterThan(30);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs((a1[i].x - a0[i].x) - dB.x), `anggota a titik ${i} X sejajar`).toBeLessThanOrEqual(1);
      expect(Math.abs((a1[i].y - a0[i].y) - dB.y), `anggota a titik ${i} Y sejajar`).toBeLessThanOrEqual(1);
      expect(c1[i], 'objek di luar grup diam').toEqual(c0[i]);
    }

    // Delete saat grup terpilih = semua anggota terhapus, grup ikut hilang.
    // Klik di 20% badan, BUKAN tengah: seret tadi membuat a terpilih, dan klik tengah trendline
    // terpilih yang kosong = undangan "+ Add text" (overPlaceholder ±55px) → textarea menelan Delete.
    await clickBody(page, rect, a, false, 0.2);
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => drawIds.slice())).toEqual([c]);
    await expect(groupRows(page)).toHaveCount(0);
    assertNoPageErrors(page);
  });

  test('folder di Object Tree: pilih, lipat, lock/hide/remove grup, ungroup', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await openTree(page);
    await groupAB(page, rect, a, b);
    const g = groupRows(page);

    await page.evaluate(() => { msClear(); deselectOverlay(); });
    await g.locator('.ot-name').click();
    expect(await sel(page), 'klik baris grup = semua anggota').toEqual([a, b].sort());
    // baris ANGGOTA = objek itu saja
    await page.locator(`#objTreeList .ot-row[data-id="${a}"] .ot-name`).click();
    expect(await sel(page)).toEqual([a]);

    await g.locator('.ot-caret').click();
    await expect(page.locator('#objTreeList .ot-child')).toHaveCount(0);
    await g.locator('.ot-caret').click();
    await expect(page.locator('#objTreeList .ot-child')).toHaveCount(2);

    await g.hover(); await g.locator('.ot-lock').click();
    expect(await page.evaluate((ids) => ids.map(isLocked), [a, b, c])).toEqual([true, true, false]);
    await g.hover(); await g.locator('.ot-del').click();
    expect(await page.evaluate(() => drawIds.length), 'grup terkunci tak terhapus').toBe(3);
    await g.locator('.ot-lock').click();
    expect(await page.evaluate((ids) => ids.map(isLocked), [a, b])).toEqual([false, false]);

    await g.hover(); await g.locator('.ot-eye').click();
    expect(await page.evaluate((ids) => ids.map((id) => chart.getOverlayById(id).visible), [a, b, c])).toEqual([false, false, true]);
    await g.locator('.ot-eye').click();
    expect(await page.evaluate((ids) => ids.map((id) => chart.getOverlayById(id).visible), [a, b])).toEqual([true, true]);

    await g.hover(); await g.locator('.ot-ungroup').click();
    await expect(groupRows(page)).toHaveCount(0);
    expect(await page.evaluate(() => drawIds.length), 'ungroup tak menghapus objek').toBe(3);
    await page.evaluate(() => { msClear(); deselectOverlay(); });
    await clickBody(page, rect, a);
    expect(await sel(page), 'setelah ungroup klik = objek itu saja').toEqual([a]);

    // remove grup
    await groupAB(page, rect, a, b);
    await groupRows(page).hover(); await groupRows(page).locator('.ot-del').click();
    await expect.poll(() => page.evaluate(() => drawIds.slice())).toEqual([c]);
    assertNoPageErrors(page);
  });

  test('ganti nama, menu klik kanan, dan grup bertahan setelah reload & undo', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await openTree(page);

    // Group lewat menu klik kanan area kosong
    await clickBody(page, rect, a);
    await clickBody(page, rect, b, true);
    await rightClickEmpty(page);
    const item = page.locator('.ctxmenu .ctxitem', { hasText: 'Group 2 drawings' });
    await expect(item).toBeVisible();
    await item.click();
    await expect(groupRows(page)).toHaveCount(1);

    await groupRows(page).locator('.ot-name').dblclick();
    const inp = page.locator('#objTreeList .ot-rename');
    await expect(inp).toBeFocused();
    await inp.fill('Daily levels');
    await inp.press('Enter');
    await expect(groupRows(page).locator('.ot-name')).toHaveText('Daily levels');

    // undo mengembalikan nama lama, tetap satu grup (restore → id baru, grup ikut payload)
    await page.waitForTimeout(500);
    await page.evaluate(() => undoDraw());
    await expect(groupRows(page).locator('.ot-name')).toHaveText('Group 1');
    await page.evaluate(() => redoDraw());
    await expect(groupRows(page).locator('.ot-name')).toHaveText('Daily levels');

    await page.waitForTimeout(500);   // debounce saveDraws 350ms
    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 3, null, { timeout: 8000 });
    await expect(groupRows(page).locator('.ot-name')).toHaveText('Daily levels');
    await expect(page.locator('#objTreeList .ot-child')).toHaveCount(2);
    const grouped = await page.evaluate(() => drawIds.filter((id) => grpOf(id)).length);
    expect(grouped).toBe(2);

    // Ungroup lewat menu klik kanan
    const r2 = await chartRect(page);
    const member = await page.evaluate(() => drawIds.find((id) => grpOf(id)));
    await clickBody(page, r2, member);
    await rightClickEmpty(page);
    await page.locator('.ctxmenu .ctxitem', { hasText: 'Ungroup' }).click();
    await expect(groupRows(page)).toHaveCount(0);
    assertNoPageErrors(page);
  });
});
