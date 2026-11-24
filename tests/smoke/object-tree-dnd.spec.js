// Drag & drop baris Object Tree + urutan tumpukan (js/draw-zorder.js), ala TradingView:
// urutan baris tree = z-order chart (paling depan di atas); seret baris = ubah z-order, masuk/keluar
// grup, seret folder = pindahkan seluruh grup. Di smoke karena menyentuh jalur persist (urutan
// drawIds = urutan payload) dan hover semua tool (jebakan zLevel MAX klinecharts).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

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
  return { ids, rect };
}
const openTree = async (page) => {
  await page.click('#railObjTree');
  await expect(page.locator('#objTreePane')).toHaveClass(/open/);
};
const row = (page, id) => page.locator(`#objTreeList .ot-row[data-id="${id}"]`);
const groupRow = (page) => page.locator('#objTreeList .ot-group');
const treeOrder = (page) => page.locator('#objTreeList .ot-row').evaluateAll((rs) => rs.map((r) => r.dataset.id || 'G:' + r.dataset.gid));

/** Seret baris `src` ke baris `dst` pada fraksi tinggi `f` (0 = tepi atas, 1 = tepi bawah). */
async function dragRow(page, src, dst, f) {
  const bb = await dst.boundingBox();
  await src.locator('.ot-name').dragTo(dst, { targetPosition: { x: Math.round(bb.width * 0.4), y: Math.max(1, Math.min(bb.height - 1, Math.round(bb.height * f))) } });
  await page.waitForTimeout(450);   // > debounce saveDraws 350ms → tiap seret = satu langkah undo
}
/** zLevel overlay mengikuti urutan drawIds (naik ketat) — z-order chart = urutan tree. */
const zOrdered = (page) => page.evaluate(() => {
  const z = drawIds.map((id) => chart.getOverlayById(id).zLevel);
  return z.every((v, i) => i === 0 || v > z[i - 1]) && z.every((v) => v < 1e6);
});

test.describe('object tree drag & drop', () => {
  test('seret baris = ubah z-order; hover tak menaikkan objek ke depan; bertahan reload', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await openTree(page);
    expect(await treeOrder(page)).toEqual([c, b, a]);

    // a (paling belakang) → di atas c = paling depan
    await dragRow(page, row(page, a), row(page, c), 0.1);
    expect(await treeOrder(page)).toEqual([a, c, b]);
    expect(await page.evaluate(() => drawIds.slice())).toEqual([b, c, a]);
    expect(await zOrdered(page)).toBe(true);

    // hover badan b (klinecharts menyetel zLevel MAX) → zApply mengembalikannya
    const m = await page.evaluate((id) => {
      const f = (x) => (Array.isArray(x) ? x[0] : x);
      const p = chart.getOverlayById(id).points.map((q) => f(chart.convertToPixel(q, { paneId: 'candle_pane', absolute: true })));
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    }, b);
    await page.mouse.move(rect.x + m.x, rect.y + m.y, { steps: 4 });
    await expect.poll(() => page.evaluate(() => hoverId)).toBe(b);
    expect(await zOrdered(page), 'hover tak mengubah tumpukan').toBe(true);

    // c ke bawah b = paling belakang
    await dragRow(page, row(page, c), row(page, b), 0.9);
    expect(await page.evaluate(() => drawIds.slice())).toEqual([c, b, a]);

    await page.waitForTimeout(500); // debounce saveDraws 350ms
    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 3, null, { timeout: 8000 });
    // id berganti setelah restore → bandingkan posisi Y titik pertama (pita 0.25/0.5/0.75)
    const ys = await page.evaluate(() => drawIds.map((id) => chart.getOverlayById(id).points[0].value));
    expect(ys[0]).toBeLessThan(ys[1]);   // c (pita bawah, harga terendah) paling belakang
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(await zOrdered(page)).toBe(true);
    assertNoPageErrors(page);
  });

  test('masuk & keluar grup, seret folder memindah seluruh grup, undo memulihkan', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c] } = await drawThree(page);
    await openTree(page);
    // grup a+b lewat API seleksi (alur UI Group sudah diuji groups.spec.js)
    await page.evaluate(([x, y]) => { msSelectOnly(x); multiSel.add(y); msRender(); }, [a, b]);
    await page.click('#objTreeGroup');
    await expect(groupRow(page)).toHaveCount(1);
    const gid = await page.evaluate((x) => grpOf(x), a);
    expect(await treeOrder(page)).toEqual([c, 'G:' + gid, b, a]);

    // c ke tengah folder = masuk grup (paling atas di grup)
    await dragRow(page, row(page, c), groupRow(page), 0.5);
    expect(await page.evaluate((x) => grpOf(x), c)).toBe(gid);
    await expect(groupRow(page).locator('.ot-gcount')).toHaveText('3');
    expect(await treeOrder(page)).toEqual(['G:' + gid, c, b, a]);

    // c ke seperempat bawah anggota terakhir (a) = keluar ke bawah grup
    await dragRow(page, row(page, c), row(page, a), 0.95);
    expect(await page.evaluate((x) => grpOf(x), c)).toBe(null);
    expect(await treeOrder(page)).toEqual(['G:' + gid, b, a, c]);
    expect(await page.evaluate(() => drawIds.slice())).toEqual([c, a, b]);

    // seret folder ke bawah c = seluruh grup ke belakang
    await dragRow(page, groupRow(page), row(page, c), 0.9);
    expect(await treeOrder(page)).toEqual([c, 'G:' + gid, b, a]);
    expect(await page.evaluate(() => drawIds.slice())).toEqual([a, b, c]);
    expect(await zOrdered(page)).toBe(true);

    // undo mengembalikan urutan sebelumnya (restore → id baru; cek lewat grup & posisi)
    await page.waitForTimeout(500);
    await page.evaluate(() => undoDraw());
    await expect.poll(() => page.evaluate(() => drawIds.map((id) => !!grpOf(id)))).toEqual([false, true, true]);
    assertNoPageErrors(page);
  });
});
