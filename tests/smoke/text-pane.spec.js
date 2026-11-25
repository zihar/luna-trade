// Tab Text bersama (js/draw-text-style.js): ukuran font, Bold/Italic, warna teks.
//
// Di smoke karena pane ini MENULIS objStyle yang ikut persist/sync: kalau kuncinya salah,
// objek tersimpan bisa kehilangan ketebalan border (rect) atau teksnya jadi mikroskopis (text).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');

const styleOf = (page, id) => page.evaluate((i) => Object.assign({}, objStyle[i] || {}), id);

test.describe('tab Text bersama', () => {
  test('objek Text: tanpa tab Style; ukuran/Bold/warna tertulis ke objek', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'text');
    // permintaan tab 'style' (klik-kanan → Settings) jatuh ke Text, karena Style tak ada lagi
    await page.evaluate((id) => openDrawModal(chart.getOverlayById(id), 'style'), obj.id);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal.locator('.dm-tab')).toHaveText(['Text', 'Coordinates']);
    const pane = modal.locator('.dm-pane[data-pane="text"]');
    await expect(pane).toBeVisible();

    await pane.locator('select[data-tsize]').selectOption('20');
    await pane.locator('[data-tb]').click();
    await pane.locator('[data-tcol="#54c88c"]').click();

    const st = await styleOf(page, obj.id);
    expect(st.size, 'objek text: ukuran font di kunci `size` (kompatibel data lama)').toBe(20);
    expect(st.textBold).toBe(true);
    expect(st.color).toBe('#54c88c');
    const ts = await page.evaluate((id) => textStyle(chart.getOverlayById(id)), obj.id);
    expect(ts).toMatchObject({ size: 20, bold: true, color: '#54c88c', lh: 25 });
    assertNoPageErrors(page);
  });

  test('rect: gaya teks di kunci sendiri, border tak tersentuh; Auto mengosongkan warna', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'rect');
    await page.evaluate((id) => openDrawModal(chart.getOverlayById(id), 'text'), obj.id);
    const pane = page.locator('.dmodal .dm-pane[data-pane="text"]');
    await expect(pane).toBeVisible();

    await pane.locator('select[data-tsize]').selectOption('16');
    await pane.locator('[data-ti]').click();
    await pane.locator('[data-tcol="#ff6f6f"]').click();
    let st = await styleOf(page, obj.id);
    expect(st).toMatchObject({ fontSize: 16, textItalic: true, textColor: '#ff6f6f' });
    expect(st.size, 'ketebalan border rect tak boleh ikut berubah').toBeUndefined();

    await pane.locator('[data-tcol=""]').click();
    st = await styleOf(page, obj.id);
    expect(st.textColor).toBe('');
    const ts = await page.evaluate((id) => ({ ts: textStyle(chart.getOverlayById(id)), theme: drawTextColor }), obj.id);
    expect(ts.ts.color, 'Auto = warna teks tema').toBe(ts.theme);
    assertNoPageErrors(page);
  });

  test('objek Text lama dgn size 1–4 (sisa chip Thickness) dirender ukuran default', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'text');
    const size = await page.evaluate((id) => { setObjStyle(id, { size: 2 }); return textStyle(chart.getOverlayById(id)).size; }, obj.id);
    expect(size).toBe(13);
    assertNoPageErrors(page);
  });
});
