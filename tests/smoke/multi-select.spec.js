// Multi-select objek gambar (js/draw-multi-select.js): Ctrl/⌘+klik di chart & di Object Tree,
// seret badan = semua anggota bergeser, Delete = hapus semua, Esc = lepas.
// Di smoke karena menyentuh jalur pressed-move semua tool drawing & Delete/Esc global.
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian PR2)

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
async function midOf(page, id) {
  const c = await ptsPx(page, id);
  return { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
}
/** Klik badan (jeda >400ms dari klik sebelumnya, lihat tests/README.md). */
async function clickBody(page, rect, id, mod = false) {
  await page.waitForTimeout(450);
  const m = await midOf(page, id);
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

test.describe('multi-select', () => {
  test('Ctrl/⌘+klik menambah & melepas; klik biasa menyempitkan; klik kosong / Esc melepas semua', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);

    await clickBody(page, rect, a);
    expect(await sel(page)).toEqual([a]);
    await clickBody(page, rect, b, true);
    await clickBody(page, rect, c, true);
    expect(await sel(page)).toEqual([a, b, c].sort());
    expect(await page.evaluate(() => selectedId), 'primer = yang terakhir di-Ctrl+klik').toBe(c);
    await expect(page.locator('#msLayer'), 'handle anggota non-primer tampak').toBeVisible();

    await clickBody(page, rect, b, true);   // toggle lepas
    expect(await sel(page)).toEqual([a, c].sort());

    await clickBody(page, rect, a);          // klik biasa = pilih itu saja
    expect(await sel(page)).toEqual([a]);
    expect(await page.evaluate(() => selectedId)).toBe(a);
    await expect(page.locator('#msLayer')).toBeHidden();

    await clickBody(page, rect, c, true);
    expect(await sel(page)).toEqual([a, c].sort());
    await page.waitForTimeout(450);
    await page.mouse.click(rect.x + rect.width * 0.85, rect.y + rect.height * 0.1);   // area kosong
    await expect.poll(() => sel(page)).toEqual([]);
    expect(await page.evaluate(() => selectedId)).toBe(null);

    await clickBody(page, rect, a);
    await clickBody(page, rect, b, true);
    await page.keyboard.press('Escape');
    await expect.poll(() => sel(page)).toEqual([]);
    expect(await page.evaluate(() => selectedId)).toBe(null);
    assertNoPageErrors(page);
  });

  test('seret badan menggeser semua anggota sejajar; anggota terkunci diam', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await page.evaluate((id) => toggleDrawLock(id), c);

    await clickBody(page, rect, a);
    await clickBody(page, rect, b, true);
    await clickBody(page, rect, c, true);
    expect(await sel(page)).toEqual([a, b, c].sort());

    const [a0, b0, c0] = [await ptsPx(page, a), await ptsPx(page, b), await ptsPx(page, c)];
    await page.waitForTimeout(450);
    const m = await midOf(page, a);
    await page.mouse.move(rect.x + m.x, rect.y + m.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(rect.x + m.x + 60, rect.y + m.y + 40, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const [a1, b1, c1] = [await ptsPx(page, a), await ptsPx(page, b), await ptsPx(page, c)];

    const dA = { x: a1[0].x - a0[0].x, y: a1[0].y - a0[0].y };
    expect(Math.abs(dA.x), 'objek yang diseret memang bergeser').toBeGreaterThan(30);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs((b1[i].x - b0[i].x) - dA.x), `anggota b titik ${i} X sejajar`).toBeLessThanOrEqual(1);
      expect(Math.abs((b1[i].y - b0[i].y) - dA.y), `anggota b titik ${i} Y sejajar`).toBeLessThanOrEqual(1);
      expect(c1[i], 'anggota terkunci tak bergeser').toEqual(c0[i]);
    }
    expect(await sel(page), 'seret tak mengubah seleksi').toEqual([a, b, c].sort());

    // satu langkah undo mengembalikan SEMUA anggota
    await page.waitForTimeout(500);
    await page.evaluate(() => undoDraw());
    // undo memulihkan lewat restore (id baru), jadi bandingkan posisi, bukan id
    const firstXs = async () => {
      const ids = await page.evaluate(() => drawIds.slice());
      const out = [];
      for (const id of ids) out.push(Math.round((await ptsPx(page, id))[0].x));
      return out.sort((p, q) => p - q);
    };
    await expect.poll(firstXs).toEqual([a0[0].x, b0[0].x, c0[0].x].map(Math.round).sort((p, q) => p - q));
    assertNoPageErrors(page);
  });

  test('Delete menghapus semua anggota tak terkunci', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await page.evaluate((id) => toggleDrawLock(id), c);
    await clickBody(page, rect, a);
    await clickBody(page, rect, b, true);
    await clickBody(page, rect, c, true);
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => drawIds.slice())).toEqual([c]);
    expect(await sel(page)).toEqual([c]);
    assertNoPageErrors(page);
  });

  test('Object Tree: Ctrl/⌘+klik & Shift+klik baris', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c] } = await drawThree(page);
    await page.click('#railObjTree');
    const row = (id) => page.locator(`#objTreeList .ot-row[data-id="${id}"] .ot-name`);

    await row(c).click();                              // baris teratas (terbaru)
    expect(await sel(page)).toEqual([c]);
    await row(a).click({ modifiers: [MOD] });
    expect(await sel(page)).toEqual([a, c].sort());
    await expect(page.locator('#objTreeList .ot-row.sel')).toHaveCount(2);

    await row(c).click();
    await row(a).click({ modifiers: ['Shift'] });      // rentang c..a = semua
    expect(await sel(page)).toEqual([a, b, c].sort());
    expect(await page.evaluate(() => selectedId)).toBe(a);
    await expect(page.locator('#objTreeList .ot-row.sel')).toHaveCount(3);

    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => drawIds.length)).toBe(0);
    assertNoPageErrors(page);
  });
});
