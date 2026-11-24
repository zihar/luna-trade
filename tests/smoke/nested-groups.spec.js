// Grup bersarang (js/draw-groups.js) ala TradingView: mengelompokkan seleksi yang memuat grup UTUH
// menjadikannya sub-grup; klik anggota di chart = grup TERLUAR; aksi folder berlaku ke seluruh isi;
// Ungroup membubarkan satu tingkat; sarang bertahan reload & undo; seret folder ke folder lain.
// Di smoke karena menyentuh jalur persist (field `gpar`) dan seleksi semua tool.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

async function drawN(page, fys) {
  const rect = await chartRect(page);
  const ids = [];
  for (const fy of fys) {
    const t = await drawTool(page, 'trendline', {
      rect,
      targets: [{ x: Math.round(rect.width * 0.3), y: Math.round(rect.height * fy) },
                { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * (fy + 0.05)) }],
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
/** Pilih `ids` lewat API seleksi lalu tekan tombol Group di header tree. */
async function groupSel(page, ids) {
  await page.evaluate((xs) => { msSelectOnly(xs[0]); xs.slice(1).forEach((x) => multiSel.add(x)); msRender(); }, ids);
  await page.click('#objTreeGroup');
  await page.waitForTimeout(450);   // > debounce saveDraws 350ms → satu langkah undo per aksi
}
const folder = (page, name) => page.locator('#objTreeList .ot-group', { has: page.locator('.ot-name', { hasText: new RegExp('^' + name + '$') }) });
/** Struktur tree: [nama/ id, kedalaman] per baris. */
const shape = (page) => page.locator('#objTreeList .ot-row').evaluateAll((rs) =>
  rs.map((r) => [r.dataset.gid ? r.querySelector('.ot-name').textContent : r.dataset.id, +(r.style.getPropertyValue('--d') || 0)]));
const parentName = (page, name) => page.evaluate((n) => {
  const g = Object.keys(grpName).find((k) => grpName[k] === n);
  return g && grpParent[g] ? grpName[grpParent[g]] : null;
}, name);

async function dragRow(page, src, dst, f) {
  const bb = await dst.boundingBox();
  await src.locator('.ot-name').dragTo(dst, { targetPosition: { x: Math.round(bb.width * 0.4), y: Math.max(1, Math.min(bb.height - 1, Math.round(bb.height * f))) } });
  await page.waitForTimeout(450);
}

test.describe('nested groups', () => {
  test('grup utuh + objek → sub-grup; klik = grup terluar; Ungroup satu tingkat; bertahan reload & undo', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c] } = await drawN(page, [0.25, 0.5, 0.75]);
    await openTree(page);
    await groupSel(page, [a, b]);                // Group 1 = a,b
    // seleksi a,b (Group 1 utuh) + c → Group 2 berisi Group 1 + c
    await groupSel(page, [a, b, c]);
    expect(await parentName(page, 'Group 1')).toBe('Group 2');
    expect(await shape(page)).toEqual([['Group 2', 0], [c, 1], ['Group 1', 1], [b, 2], [a, 2]]);
    await expect(folder(page, 'Group 2').locator('.ot-gcount')).toHaveText('3');
    await expect(folder(page, 'Group 1').locator('.ot-gcount')).toHaveText('2');

    // seleksi yang tepat SATU grup utuh tak bisa dikelompokkan lagi
    await page.evaluate((xs) => { msSelectOnly(xs[0]); xs.slice(1).forEach((x) => multiSel.add(x)); msRender(); }, [a, b, c]);
    await expect(page.locator('#objTreeGroup')).toBeDisabled();

    // klik anggota terdalam di chart = grup TERLUAR; klik folder dalam = isinya saja
    expect(await page.evaluate((x) => grpExpand(x).sort(), a)).toEqual([a, b, c].sort());
    await page.evaluate(() => { msClear(); deselectOverlay(); });
    await folder(page, 'Group 1').locator('.ot-name').click();
    expect(await page.evaluate(() => [...multiSel].sort())).toEqual([a, b].sort());

    // lock folder luar = semua isi termasuk sub-grup
    await folder(page, 'Group 2').hover();
    await folder(page, 'Group 2').locator('.ot-lock').click();
    expect(await page.evaluate((ids) => ids.map(isLocked), [a, b, c])).toEqual([true, true, true]);
    await folder(page, 'Group 2').locator('.ot-lock').click();

    // lipat folder luar menyembunyikan seluruh isinya
    await folder(page, 'Group 2').locator('.ot-caret').click();
    await expect(page.locator('#objTreeList .ot-row')).toHaveCount(1);
    await folder(page, 'Group 2').locator('.ot-caret').click();

    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 3, null, { timeout: 8000 });
    await expect(page.locator('#objTreeList .ot-group')).toHaveCount(2);
    expect(await parentName(page, 'Group 1')).toBe('Group 2');
    expect((await shape(page)).map((r) => r[1])).toEqual([0, 1, 1, 2, 2]);

    // Ungroup luar → Group 1 naik ke tingkat atas utuh, objek lepas
    await folder(page, 'Group 2').hover();
    await folder(page, 'Group 2').locator('.ot-ungroup').click();
    await expect(page.locator('#objTreeList .ot-group')).toHaveCount(1);
    expect(await parentName(page, 'Group 1')).toBe(null);
    expect((await shape(page)).map((r) => r[1])).toEqual([0, 0, 1, 1]);

    await page.waitForTimeout(500);
    await page.evaluate(() => undoDraw());
    await expect(page.locator('#objTreeList .ot-group')).toHaveCount(2);
    expect(await parentName(page, 'Group 1')).toBe('Group 2');
    assertNoPageErrors(page);
  });

  test('seret folder ke folder lain = bersarang; ke dirinya sendiri ditolak; keluar lagi ke atas', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c, d] } = await drawN(page, [0.15, 0.35, 0.55, 0.75]);
    await openTree(page);
    await groupSel(page, [a, b]);   // Group 1
    await groupSel(page, [c, d]);   // Group 2 (paling depan)
    expect(await shape(page)).toEqual([['Group 2', 0], [d, 1], [c, 1], ['Group 1', 0], [b, 1], [a, 1]]);

    // Group 1 ke tengah folder Group 2 → sub-grup, paling atas di dalamnya
    await dragRow(page, folder(page, 'Group 1'), folder(page, 'Group 2'), 0.5);
    expect(await parentName(page, 'Group 1')).toBe('Group 2');
    expect(await shape(page)).toEqual([['Group 2', 0], ['Group 1', 1], [b, 2], [a, 2], [d, 1], [c, 1]]);
    await expect(folder(page, 'Group 2').locator('.ot-gcount')).toHaveText('4');

    // Group 2 ke dalam sub-grupnya sendiri → ditolak, tak berubah
    await dragRow(page, folder(page, 'Group 2'), folder(page, 'Group 1'), 0.5);
    expect(await parentName(page, 'Group 2')).toBe(null);
    expect(await parentName(page, 'Group 1')).toBe('Group 2');

    // objek d ke tengah folder Group 1 → anggota sub-grup
    await dragRow(page, page.locator(`#objTreeList .ot-row[data-id="${d}"]`), folder(page, 'Group 1'), 0.5);
    expect(await page.evaluate((x) => grpName[grpOf(x)], d)).toBe('Group 1');

    // Group 1 ke seperempat atas folder Group 2 → keluar ke tingkat atas, di atas Group 2
    await dragRow(page, folder(page, 'Group 1'), folder(page, 'Group 2'), 0.1);
    expect(await parentName(page, 'Group 1')).toBe(null);
    expect((await shape(page)).map((r) => r[0])).toEqual(['Group 1', d, b, a, 'Group 2', c]);
    assertNoPageErrors(page);
  });
});
