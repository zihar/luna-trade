// Object Tree (js/draw-object-tree.js): panel daftar objek gambar ala TradingView.
// Di smoke karena menyentuh jalur persist (field `hidden`) & visibilitas semua tool.
// Assertion lewat PERILAKU (klik chart tak memilih objek tersembunyi, dll), bukan cuma flag.
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');

/** Titik tengah objek 2-titik dalam pixel container-relative. */
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

const openTree = async (page) => {
  await page.click('#railObjTree');
  await expect(page.locator('#objTreePane')).toHaveClass(/open/);
};
const row = (page, id) => page.locator(`#objTreeList .ot-row[data-id="${id}"]`);

/** Klik badan objek di chart (jeda >400ms dari klik sebelumnya, lihat tests/README.md). */
async function clickBody(page, rect, id) {
  await page.waitForTimeout(450);
  const m = await midOf(page, id);
  await page.mouse.click(rect.x + m.x, rect.y + m.y);
  await page.waitForTimeout(150);
}

test.describe('object tree', () => {
  test('mendaftar objek (terbaru di atas) & klik baris memilih objeknya', async ({ page }) => {
    await gotoApp(page);
    const a = (await drawTool(page, 'trendline')).obj;
    const b = (await drawTool(page, 'rect')).obj;
    await page.evaluate(() => deselectOverlay());
    await openTree(page);

    const rows = page.locator('#objTreeList .ot-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-id', b.id);
    await expect(rows.nth(1)).toHaveAttribute('data-id', a.id);
    await expect(page.locator('#objTreeCount')).toHaveText('2');

    await row(page, a.id).locator('.ot-name').click();
    await expect.poll(() => page.evaluate(() => selectedId)).toBe(a.id);
    await expect(row(page, a.id)).toHaveClass(/sel/);

    // panel Alerts & Object Tree berbagi slot kanan: buka satu menutup yang lain
    await page.evaluate(() => setAlertsPane(true));
    await expect(page.locator('#objTreePane')).not.toHaveClass(/open/);
    assertNoPageErrors(page);
  });

  test('hide: objek tak tampak & tak bisa dipilih dari chart; bertahan setelah reload', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    await page.evaluate(() => deselectOverlay());

    // pembanding: klik badan MEMANG memilih objek saat tampak
    await clickBody(page, rect, obj.id);
    expect(await page.evaluate(() => selectedId)).toBe(obj.id);

    await openTree(page);
    await row(page, obj.id).hover();
    await row(page, obj.id).locator('.ot-eye').click();
    expect(await page.evaluate((id) => chart.getOverlayById(id).visible, obj.id)).toBe(false);
    expect(await page.evaluate(() => selectedId), 'objek tersembunyi dilepas pilihannya').toBe(null);
    await expect(row(page, obj.id)).toHaveClass(/is-hidden/);

    await clickBody(page, rect, obj.id);
    expect(await page.evaluate(() => selectedId), 'objek tersembunyi tak bisa diklik').toBe(null);

    await page.waitForTimeout(500); // debounce saveDraws 350ms
    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 1, null, { timeout: 8000 });
    const id2 = await page.evaluate(() => drawIds[0]);
    expect(await page.evaluate((id) => chart.getOverlayById(id).visible, id2)).toBe(false);
    expect(await page.evaluate((id) => isDrawHidden(id), id2)).toBe(true);

    // "Hide all" lalu "Show all" tak boleh memunculkan objek yang disembunyikan per objek
    await page.evaluate(() => { drawsHidden = true; applyDrawsVisibility(); drawsHidden = false; applyDrawsVisibility(); });
    expect(await page.evaluate((id) => chart.getOverlayById(id).visible, id2)).toBe(false);

    // klik barisnya = munculkan + pilih
    await expect(page.locator('#objTreePane'), 'status panel dipulihkan').toHaveClass(/open/);
    await row(page, id2).locator('.ot-name').click();
    expect(await page.evaluate((id) => chart.getOverlayById(id).visible, id2)).toBe(true);
    await expect.poll(() => page.evaluate(() => selectedId)).toBe(id2);
    assertNoPageErrors(page);
  });

  test('lock & delete dari tree; objek terkunci tak terhapus', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await openTree(page);

    await row(page, obj.id).hover();
    await row(page, obj.id).locator('.ot-lock').click();
    expect(await page.evaluate((id) => isLocked(id), obj.id)).toBe(true);
    await expect(row(page, obj.id).locator('.ot-lock')).toHaveClass(/on/);

    await row(page, obj.id).hover();
    await row(page, obj.id).locator('.ot-del').click();
    expect(await page.evaluate(() => drawIds.length), 'terkunci → tak terhapus').toBe(1);

    await row(page, obj.id).locator('.ot-lock').click();
    await row(page, obj.id).hover();
    await row(page, obj.id).locator('.ot-del').click();
    await expect.poll(() => page.evaluate(() => drawIds.length)).toBe(0);
    await expect(page.locator('#objTreeList .ot-empty')).toBeVisible();
    await expect(page.locator('#objTreeCount')).toHaveText('');
    assertNoPageErrors(page);
  });

  test('ganti nama objek: dblclick → input; Esc batal, kosong = nama otomatis; bertahan undo & reload', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.evaluate(() => deselectOverlay());
    await openTree(page);
    const name = row(page, obj.id).locator('.ot-name');
    const auto = (await name.textContent()).trim();
    const inp = page.locator('#objTreeList .ot-rename');

    // Esc = batal
    await name.dblclick();
    await expect(inp).toBeFocused();
    await inp.fill('Ignored');
    await inp.press('Escape');
    await expect(name).toHaveText(auto);

    await name.dblclick();
    await inp.fill('  Weekly high  ');
    await inp.press('Enter');
    await expect(name).toHaveText('Weekly high');

    // undo → nama otomatis (restore = id baru, bandingkan label baris satu-satunya)
    const only = page.locator('#objTreeList .ot-row .ot-name');
    await page.waitForTimeout(500);
    await page.evaluate(() => undoDraw());
    await expect(only).toHaveText(auto);
    await page.evaluate(() => redoDraw());
    await expect(only).toHaveText('Weekly high');

    await page.waitForTimeout(500); // debounce saveDraws 350ms
    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 1, null, { timeout: 8000 });
    await expect(only).toHaveText('Weekly high');

    // nama kosong = kembali ke nama otomatis
    await only.dblclick();
    await inp.fill('   ');
    await inp.press('Enter');
    await expect(only).toHaveText(auto);
    expect(await page.evaluate(() => Object.keys(objName).length)).toBe(0);
    assertNoPageErrors(page);
  });
});
