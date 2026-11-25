// Bentuk tertutup (rect/circle/ellipse/callout): Background (warna + opacity) per objek di tab Style
// (shapeFill, js/overlays-custom.js), dan teks DI DALAM circle/ellipse (boxTextFigs, pola rect) +
// Arrow ikut LINE_TEXT (diuji di line-text.spec.js). Fill dulu hardcode biru 10% — default-nya harus tetap itu.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { TOOL_SPEC } = require('../helpers/spec');

const FILL = TOOL_SPEC.filter((t) => t.fill).map((t) => t.name);

test.describe('fill & teks bentuk', () => {
  test('TOOL_SPEC sepakat dgn FILL_OBJS / DM_TEXT_OBJS aplikasi; default fill = nilai lama', async ({ page }) => {
    await gotoApp(page);
    const app = await page.evaluate(() => ({
      fill: [...FILL_OBJS].sort(),
      text: [...DM_TEXT_OBJS].sort(),
      def: shapeFill(dstyle({ name: 'rect', id: 'none' })),
    }));
    expect(app.fill).toEqual([...FILL].sort());
    expect(app.text).toEqual(TOOL_SPEC.filter((t) => t.text).map((t) => t.name).sort());
    expect(app.def).toBe('#4a71ff1a');   // ≈ rgba(74,113,255,0.10) yang dulu di-hardcode
  });

  for (const name of FILL) {
    test(`${name}: Background di tab Style mengubah canvas`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 10, 10, 'style'), obj.id);
      const pane = page.locator('.dmodal-scrim.show .dm-pane[data-pane="style"]');
      await expect(pane.locator('.pp-lbl', { hasText: 'Background' })).toBeVisible();
      await page.mouse.move(2, 2);
      const chartEl = page.locator('#chart');
      const before = await chartEl.screenshot();
      await pane.locator('[data-fcol="#54c88c"]').click();
      await pane.locator('[data-falpha]').fill('60');
      const st = await page.evaluate((id) => Object.assign({}, objStyle[id]), obj.id);
      expect(st).toMatchObject({ fillColor: '#54c88c', fillAlpha: 60 });
      expect(st.color, 'fill tak boleh menyentuh warna garis').toBeUndefined();
      await page.waitForTimeout(100);
      expect(Buffer.compare(before, await chartEl.screenshot()), 'canvas harus berubah').not.toBe(0);
      assertNoPageErrors(page);
    });
  }

  for (const name of ['circle', 'ellipse']) {
    test(`${name}: teks tergambar di canvas`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      await page.mouse.move(2, 2);
      const chartEl = page.locator('#chart');
      const before = await chartEl.screenshot();
      await page.evaluate((id) => { chart.overrideOverlay({ id, extendData: 'Zone\nsecond' }); setObjStyle(id, { fontSize: 18, textBold: true }); }, obj.id);
      await page.waitForTimeout(100);
      expect(Buffer.compare(before, await chartEl.screenshot()), 'canvas harus berubah setelah teks diisi').not.toBe(0);
      assertNoPageErrors(page);
    });
  }

  test('boxTextFigs: posisi di dalam kotak pembatas', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => {
      objStyle.x = { textAlign: 'left', textValign: 'top', fontSize: 12 };
      const tl = boxTextFigs({ name: 'circle', id: 'x', extendData: 'a\nb' }, { x: 100, y: 50, w: 200, h: 200 });
      objStyle.x = {};
      const mid = boxTextFigs({ name: 'ellipse', id: 'x', extendData: 'a\nb' }, { x: 100, y: 50, w: 200, h: 100 });
      delete objStyle.x;
      return { tl: tl.map((f) => f.attrs), mid: mid.map((f) => f.attrs) };
    });
    expect(r.tl).toEqual([
      { x: 104, y: 54, text: 'a', align: 'left', baseline: 'top' },
      { x: 104, y: 69, text: 'b', align: 'left', baseline: 'top' },
    ]);
    // default center/middle: dua baris lh 15 di tengah (200,100)
    expect(r.mid.map((a) => [a.x, a.y, a.align, a.baseline])).toEqual([[200, 92.5, 'center', 'middle'], [200, 107.5, 'center', 'middle']]);
  });

  test('circle: double-click → tab Text; tulis teks & alignment tanpa menyentuh garis', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'circle');
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 10, 10, 'text'), obj.id);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', 'text');
    const pane = modal.locator('.dm-pane[data-pane="text"]');
    await pane.locator('textarea').fill('Demand');
    await pane.locator('[data-ha="right"]').click();
    await pane.locator('[data-va="bottom"]').click();
    const got = await page.evaluate((id) => ({ t: chart.getOverlayById(id).extendData, st: Object.assign({}, objStyle[id]) }), obj.id);
    expect(got.t).toBe('Demand');
    expect(got.st).toMatchObject({ textAlign: 'right', textValign: 'bottom' });
    expect(got.st.size).toBeUndefined();
    assertNoPageErrors(page);
  });
});
