// Kotak seleksi (js/draw-marquee.js): Ctrl/⌘ + seret area kosong = pilih semua objek yang
// titik jangkarnya di dalam kotak, ditambahkan ke seleksi; grup ikut utuh; chart tak ter-pan.
// Di smoke karena mencegat mousedown #chart sebelum klinecharts (jalur pan & semua drawing).
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (follow-up 1)

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

const MOD = 'ControlOrMeta';
const sel = (page) => page.evaluate(() => [...multiSel].sort());
const range = (page) => page.evaluate(() => { const r = chart.getVisibleRange(); return [r.from, r.to]; });

/** Tiga trendline di pita vertikal 0.25 / 0.5 / 0.75 (x 0.3–0.55). */
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
  await page.waitForTimeout(450);
  return { ids, rect };
}
/** Ctrl/⌘ + seret dari (fx0,fy0) ke (fx1,fy1), pecahan lebar/tinggi chart. */
async function marquee(page, rect, fx0, fy0, fx1, fy1) {
  await page.mouse.move(rect.x + rect.width * fx0, rect.y + rect.height * fy0);
  await page.keyboard.down(MOD);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * fx1, rect.y + rect.height * fy1, { steps: 8 });
  await expect(page.locator('#mqBox'), 'kotak tampak selama seret').toBeVisible();
  await page.mouse.up();
  await page.keyboard.up(MOD);
  await page.waitForTimeout(150);
}

test.describe('marquee', () => {
  test('Ctrl/⌘+seret area kosong memilih objek di dalam kotak tanpa menggeser chart', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    const before = await range(page);

    await marquee(page, rect, 0.2, 0.15, 0.62, 0.62);
    expect(await sel(page)).toEqual([a, b].sort());
    expect([a, b]).toContain(await page.evaluate(() => selectedId));
    expect(await range(page), 'chart tak ter-pan').toEqual(before);
    await expect(page.locator('#mqBox')).toBeHidden();
    await expect(page.locator('#msLayer')).toBeVisible();

    // kotak kedua DITAMBAHKAN ke seleksi
    await page.waitForTimeout(450);
    await marquee(page, rect, 0.2, 0.7, 0.62, 0.9);
    expect(await sel(page)).toEqual([a, b, c].sort());

    // Ctrl/⌘+klik area kosong tanpa seret: seleksi tetap
    await page.waitForTimeout(450);
    await page.mouse.move(rect.x + rect.width * 0.1, rect.y + rect.height * 0.1);
    await page.keyboard.down(MOD);
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.up(MOD);
    await page.waitForTimeout(150);
    expect(await sel(page)).toEqual([a, b, c].sort());

    await assertNoPageErrors(page);
  });

  test('anggota grup ikut utuh; objek tersembunyi dilewati', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await page.evaluate(([x, y]) => { grpCreate([x, y]); msClear(); deselectOverlay(); }, [b, c]);
    await page.evaluate((x) => setDrawHidden(x, true), a);
    await page.waitForTimeout(450);

    await marquee(page, rect, 0.2, 0.15, 0.62, 0.4);   // kotak hanya menutup a (tersembunyi)
    expect(await sel(page)).toEqual([]);

    await page.waitForTimeout(450);
    await marquee(page, rect, 0.2, 0.42, 0.62, 0.62);  // kotak hanya menutup b → c ikut (grup)
    expect(await sel(page)).toEqual([b, c].sort());

    await assertNoPageErrors(page);
  });
});
