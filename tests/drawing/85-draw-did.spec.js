// Id stabil objek gambar (did) — prasyarat alert yang terikat objek.
// Spec: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

async function drawLine(page, rect, f = {}) {
  const p1 = { x: Math.round(rect.width * (f.x1 ?? 0.36)), y: Math.round(rect.height * (f.y1 ?? 0.4)) };
  const p2 = { x: Math.round(rect.width * (f.x2 ?? 0.58)), y: Math.round(rect.height * (f.y2 ?? 0.6)) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
}

test.describe('did: id stabil objek gambar', () => {
  test('objek baru dapat did, dan did ikut tersimpan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    const id = (await overlays(page))[0].id;
    const did = await page.evaluate((i) => objDid[i], id);
    expect(did, 'objek baru harus punya did').toBeTruthy();
    const ser = await page.evaluate(() => serializeDraws());
    expect(ser[0].did, 'did harus ikut terserialisasi').toBe(did);
    assertNoPageErrors(page);
  });

  test('did BERTAHAN lewat reload — itulah gunanya "stabil"', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    const did = await page.evaluate(() => objDid[drawIds[0]]);
    await page.waitForTimeout(2500);   // biarkan tersimpan ke server

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof chart !== 'undefined' && chart.getDataList().length > 0 && typeof drawIds !== 'undefined', null, { timeout: 20000 });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => objDid[drawIds[0]]), 'did harus sama sesudah reload').toBe(did);
    assertNoPageErrors(page);
  });

  test('objek lama tanpa did dapat did saat dimuat (backfill)', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    // muatan gaya lama: TANPA field did
    await page.evaluate((t) => {
      __seedDrawings(inst, [{ name: 'trendline', points: [{ vt: t - 3600000, value: 1.1 }, { vt: t, value: 1.12 }], lock: 0, extendData: null, style: null }], 3);
    }, ts);
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => objDid[drawIds[0]]), 'objek lama harus ikut dapat did').toBeTruthy();
    assertNoPageErrors(page);
  });

  test('salinan (paste) dapat did BARU, bukan warisan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    const asal = await page.evaluate(() => objDid[drawIds[0]]);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(90, 90); });
    await page.waitForTimeout(300);

    const dids = await page.evaluate(() => drawIds.map((i) => objDid[i]));
    expect(dids).toHaveLength(2);
    expect(dids[1], 'salinan tak boleh mewarisi did asalnya').not.toBe(asal);
    expect(dids[1], 'salinan tetap harus punya did').toBeTruthy();
    assertNoPageErrors(page);
  });
});
