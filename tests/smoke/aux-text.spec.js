// Tab Text untuk objek yang intinya bukan teks: Fib Retracement, Fib Line, Arrow Mark Up/Down
// (AUX_TEXT, js/draw-text-style.js). Dengan ini semua tool gambar ber-modal punya tab Style & Text,
// kecuali 'text' (teks = objeknya, tanpa Style) dan Long/Short (teks = pill statistik di tab Style).
// fibonacciLine bawaan klinecharts didaftarkan ulang (pembungkus) → kalau rusak, Fib Line berhenti
// tergambar sama sekali, jadi layak di smoke.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { TOOL_SPEC } = require('../helpers/spec');

const AUX = TOOL_SPEC.filter((t) => t.text === 'aux').map((t) => t.name);

test.describe('teks pelengkap (Fib, penanda panah)', () => {
  test('TOOL_SPEC sepakat dgn AUX_TEXT aplikasi', async ({ page }) => {
    await gotoApp(page);
    const app = await page.evaluate(() => Object.keys(AUX_TEXT).sort());
    expect(app).toEqual([...AUX].sort());
  });

  test('semua tool ber-modal punya tab Text; Style kecuali objek text', async ({ page }) => {
    await gotoApp(page);
    const app = await page.evaluate(() => ({ text: [...DM_TEXT_OBJS].sort() }));
    const modal = TOOL_SPEC.filter((t) => t.settings === 'modal').map((t) => t.name).sort();
    expect(app.text).toEqual(modal);
  });

  for (const name of AUX) {
    test(`${name}: modal Style dulu, tab Text menulis teks & tergambar di canvas`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      await page.mouse.move(2, 2);
      const chartEl = page.locator('#chart');
      const before = await chartEl.screenshot();

      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 10, 10), obj.id);
      const modal = page.locator('.dmodal-scrim.show');
      await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', 'style');
      await expect(modal.locator('.dm-tab[data-tab="text"]')).toHaveCount(1);
      await modal.locator('.dm-tab[data-tab="text"]').click();
      await modal.locator('.dm-pane[data-pane="text"] textarea').fill('Note\nline 2');
      await modal.locator('.dm-close').click();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(100);

      const t = await page.evaluate((id) => objText(chart.getOverlayById(id)), obj.id);
      expect(t).toBe('Note\nline 2');
      const after = await chartEl.screenshot();
      expect(Buffer.compare(before, after), 'canvas harus berubah setelah teks diisi').not.toBe(0);
      assertNoPageErrors(page);
    });
  }

  test('posisi teks penanda panah: di bawah ekor (Up), di atas ekor (Down)', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => {
      objStyle.x = { fontSize: 12 };
      const up = markTextFigs({ name: 'arrowMarkUp', id: 'x', extendData: 'ab\ncd' }, { x: 100, y: 222 }, -1);
      const dn = markTextFigs({ name: 'arrowMarkDown', id: 'x', extendData: 'ab' }, { x: 100, y: 178 }, +1);
      const none = markTextFigs({ name: 'arrowMarkUp', id: 'x', extendData: '  ' }, { x: 100, y: 222 }, -1);
      delete objStyle.x;
      return { up: up.map((f) => f.attrs), dn: dn.map((f) => f.attrs), none: none.length };
    });
    // lh = 15 @12px; jarak 4px dari ekor
    expect(r.up).toEqual([
      { x: 100, y: 226, text: 'ab', align: 'center', baseline: 'top' },
      { x: 100, y: 241, text: 'cd', align: 'center', baseline: 'top' },
    ]);
    expect(r.dn).toEqual([{ x: 100, y: 159, text: 'ab', align: 'center', baseline: 'top' }]);
    expect(r.none).toBe(0);
    assertNoPageErrors(page);
  });
});
