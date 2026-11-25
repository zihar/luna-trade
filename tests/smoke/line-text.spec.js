// Teks pada garis (js/draw-text-style.js lineTextFigs): Horizontal/Vertical/Ray/Extended/
// Horizontal Ray/Price Line (+ Arrow) punya tab Text. Empat yang bawaan klinecharts didaftarkan ulang
// (overlays-custom.js) dgn template asli dibungkus — kalau pembungkus itu rusak, garis bawaan
// berhenti tergambar sama sekali, jadi ini layak di smoke.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { TOOL_SPEC } = require('../helpers/spec');

const LINES = TOOL_SPEC.filter((t) => t.text === 'line').map((t) => t.name);

test.describe('teks pada garis', () => {
  test('TOOL_SPEC sepakat dgn LINE_TEXT aplikasi', async ({ page }) => {
    await gotoApp(page);
    const app = await page.evaluate(() => Object.keys(LINE_TEXT).sort());
    expect(app).toEqual([...LINES].sort());
  });

  for (const name of LINES) {
    test(`${name}: teks tergambar di canvas`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      // lepas hover/seleksi supaya satu-satunya beda antar-shot adalah teksnya
      await page.mouse.move(2, 2);
      const chartEl = page.locator('#chart');
      const before = await chartEl.screenshot();
      await page.evaluate((id) => { chart.overrideOverlay({ id, extendData: 'Key level\nsecond' }); setObjStyle(id, { fontSize: 18, textBold: true }); }, obj.id);
      await page.waitForTimeout(100);
      const after = await chartEl.screenshot();
      expect(Buffer.compare(before, after), 'canvas harus berubah setelah teks diisi').not.toBe(0);
      assertNoPageErrors(page);
    });
  }

  test('posisi: horizontal di atas ujung kanan; vertikal di kanan garis, di atas pane', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => {
      const mk = (name) => ({ name, id: 'x', extendData: 'ab\ncd' });
      objStyle.x = { textAlign: 'right', textValign: 'top', fontSize: 12 };
      const h = lineTextFigs(mk('horizontalStraightLine'), [{ x: 0, y: 100 }, { x: 500, y: 100 }]);
      objStyle.x = { textAlign: 'right', textValign: 'top', fontSize: 12 };
      const v = lineTextFigs(mk('verticalStraightLine'), [{ x: 200, y: 0 }, { x: 200, y: 400 }]);
      objStyle.x = { textAlign: 'center', textValign: 'bottom', fontSize: 12 };
      const s = lineTextFigs(mk('rayLine'), [{ x: 300, y: 50 }, { x: 100, y: 250 }]);   // ujung terbalik
      delete objStyle.x;
      return { h: h.map((f) => f.attrs), v: v.map((f) => f.attrs), s: s.map((f) => f.attrs) };
    });
    // 2 baris, lh = 15 @12px → blok 30px, berakhir 4px di atas garis, rata kanan 6px dari tepi
    expect(r.h).toEqual([
      { x: 494, y: 66, text: 'ab', align: 'right', baseline: 'top' },
      { x: 494, y: 81, text: 'cd', align: 'right', baseline: 'top' },
    ]);
    expect(r.v[0]).toMatchObject({ x: 204, y: 6, align: 'left' });
    // tengah ruas (200,150), di bawah garis
    expect(r.s[0]).toMatchObject({ x: 200, y: 154, align: 'center' });
    assertNoPageErrors(page);
  });

  test('modal: double-click → Style dulu; tab Text menulis teks & alignment', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'horizontalStraightLine');
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 10, 10, 'style'), obj.id);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal.locator('.dm-tab')).toHaveText(['Style', 'Text', 'Coordinates', 'Alert']);
    await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', 'style');
    await modal.locator('.dm-tab[data-tab="text"]').click();
    const pane = modal.locator('.dm-pane[data-pane="text"]');
    await pane.locator('textarea').fill('Resistance');
    await pane.locator('[data-ha="left"]').click();
    await pane.locator('[data-va="bottom"]').click();
    const got = await page.evaluate((id) => ({ t: chart.getOverlayById(id).extendData, st: Object.assign({}, objStyle[id]) }), obj.id);
    expect(got.t).toBe('Resistance');
    expect(got.st).toMatchObject({ textAlign: 'left', textValign: 'bottom' });
    expect(got.st.size, 'teks tak boleh menyentuh ketebalan garis').toBeUndefined();
    assertNoPageErrors(page);
  });
});
