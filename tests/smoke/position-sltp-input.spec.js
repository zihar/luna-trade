// Modal Long/Short Position (double-click, tab Levels): SL & TP bisa diketik sebagai harga.
// Di smoke karena ia MENULIS ke points objek posisi (titik 1,3 = TP; 2,4 = SL).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays } = require('../helpers/draw');

async function openPopup(page, name) {
  const { obj } = await drawTool(page, name);
  await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 200, 'levels'), obj.id);
  await expect(page.locator('.dmodal-scrim.show #ppTp')).toBeVisible();
  return obj;
}

for (const name of ['longPosition', 'shortPosition']) {
  test(`${name}: ketik TP & SL menggeser level, Entry tetap`, async ({ page }) => {
    await gotoApp(page);
    await openPopup(page, name);
    const before = (await overlays(page))[0].points;
    const entry = before[0].value, long = name === 'longPosition';
    const span = Math.abs(before[1].value - entry);
    const tp = +(entry + (long ? 1 : -1) * span * 2).toFixed(5);
    const sl = +(entry - (long ? 1 : -1) * span / 2).toFixed(5);

    const tpInp = page.locator('#ppTp'), slInp = page.locator('#ppSl');
    await tpInp.fill(String(tp)); await tpInp.press('Enter');
    await slInp.fill(String(sl)); await slInp.press('Enter');

    const p = (await overlays(page))[0].points;
    expect(p[1].value).toBeCloseTo(tp, 5); expect(p[3].value).toBeCloseTo(tp, 5);
    expect(p[2].value).toBeCloseTo(sl, 5); expect(p[4].value).toBeCloseTo(sl, 5);
    expect(p[0].value).toBeCloseTo(entry, 6);
    assertNoPageErrors(page);
  });
}

test('level yang menyeberangi Entry ditolak, objek tak bergerak', async ({ page }) => {
  await gotoApp(page);
  await openPopup(page, 'longPosition');
  const before = (await overlays(page))[0].points;
  const inp = page.locator('#ppTp');
  const shown = await inp.inputValue();
  await inp.fill(String(+(before[0].value - 0.001).toFixed(5)));   // TP long di bawah Entry
  await inp.press('Enter');
  await expect(inp).toHaveClass(/bad/);
  expect(await inp.inputValue()).toBe(shown);
  expect((await overlays(page))[0].points[1].value).toBeCloseTo(before[1].value, 6);
  assertNoPageErrors(page);
});

test('modal posisi: warna & opacity zona Profit/Stop tertulis ke style objek', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'longPosition');
  await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 200), obj.id);
  const m = page.locator('.dmodal');
  await m.locator('[data-pcol="tgt"][data-pc="#4a71ff"]').click();
  await m.locator('[data-pcol="stop"][data-pc="#a78bfa"]').click();
  await m.locator('[data-palpha="tgt"]').fill('40');
  const st = await page.evaluate((id) => dstyle(chart.getOverlayById(id)), obj.id);
  expect(st.tgtColor).toBe('#4a71ff'); expect(st.stopColor).toBe('#a78bfa'); expect(st.tgtAlpha).toBe(40);
  await expect(m.locator('.dm-sval').first()).toHaveText('40%');
  assertNoPageErrors(page);
});

test('modal posisi: Delete menghapus objek, Lock mematikan field level', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'shortPosition');
  await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 200, 'levels'), obj.id);
  await page.locator('.dm-lock').click();
  await expect(page.locator('#ppTp')).toBeDisabled();
  await page.locator('.dm-lock').click();
  await page.locator('.dm-del').click();
  await expect.poll(async () => (await overlays(page)).length).toBe(0);
  assertNoPageErrors(page);
});
