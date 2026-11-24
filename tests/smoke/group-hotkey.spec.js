// Hotkey grup (js/draw-groups.js → grpHotkey, dipanggil js/keyboard.js): Ctrl/⌘+G = Group,
// Ctrl/⌘+Shift+G = Ungroup. Bentrok dgn "find next/previous" browser diatasi dgn hanya mencegat
// saat aksinya berlaku — tanpa seleksi yang bisa dikelompokkan, keystroke dibiarkan ke browser.

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
  return ids;
}
const select = (page, ids) => page.evaluate((xs) => { msSelectOnly(xs[0]); xs.slice(1).forEach((x) => multiSel.add(x)); msRender(); }, ids);
/** Tekan `combo` dan laporkan apakah app mencegat (defaultPrevented) — listener uji dipasang
 *  SESUDAH js/keyboard.js, jadi ia melihat keputusan app. */
async function press(page, combo) {
  await page.evaluate(() => {
    window.__gk = null;
    // bukan {once:true}: keydown pertama adalah tombol modifier itu sendiri
    const f = (e) => { if (e.key.toLowerCase() === 'g') { window.__gk = e.defaultPrevented; removeEventListener('keydown', f); } };
    addEventListener('keydown', f);
  });
  await page.keyboard.press(combo);
  await page.waitForTimeout(450);   // > debounce saveDraws 350ms
  return page.evaluate(() => window.__gk);
}

test('Ctrl/⌘+G mengelompokkan, Ctrl/⌘+Shift+G membubarkan; tanpa seleksi dibiarkan ke browser', async ({ page }) => {
  await gotoApp(page);
  const [a, b, c] = await drawN(page, [0.25, 0.5, 0.75]);

  // tanpa seleksi: tak dicegat (find-next browser tetap jalan), tak ada grup
  expect(await press(page, 'ControlOrMeta+g')).toBe(false);
  expect(await press(page, 'ControlOrMeta+Shift+G')).toBe(false);
  expect(await page.evaluate(() => Object.keys(grpName).length)).toBe(0);

  await select(page, [a, b]);
  expect(await press(page, 'ControlOrMeta+g')).toBe(true);
  const g = await page.evaluate((x) => grpOf(x), a);
  expect(g).toBeTruthy();
  expect(await page.evaluate((x) => grpOf(x), b)).toBe(g);
  // seleksi tetap = grup baru → Ctrl/⌘+G lagi tak berlaku (sudah satu grup) → dibiarkan
  expect(await press(page, 'ControlOrMeta+g')).toBe(false);

  // grup + objek lain → grup bersarang lewat hotkey yang sama
  await select(page, [a, b, c]);
  expect(await press(page, 'ControlOrMeta+g')).toBe(true);
  expect(await page.evaluate((x) => grpParent[x] || null, g)).toBeTruthy();

  // Ungroup membubarkan satu tingkat (grup terluar dari seleksi)
  await select(page, [a]);
  expect(await press(page, 'ControlOrMeta+Shift+G')).toBe(true);
  expect(await page.evaluate((x) => grpParent[x] || null, g)).toBe(null);
  expect(await page.evaluate((x) => grpOf(x), c)).toBe(null);
  await select(page, [a]);
  expect(await press(page, 'ControlOrMeta+Shift+G')).toBe(true);
  expect(await page.evaluate(() => Object.keys(grpName).length)).toBe(0);

  // hint shortcut tampil di menu klik-kanan & tooltip tombol Object Tree
  await select(page, [a, b]);
  const label = await page.evaluate(() => grpKeyLabel(false));
  expect(label).toMatch(/^(⌘G|Ctrl\+G)$/);
  await page.click('#railObjTree');
  await expect(page.locator('#objTreeGroup')).toHaveAttribute('title', new RegExp('\\(' + label.replace('+', '\\+') + '\\)$'));
  const rect = await chartRect(page);
  await page.mouse.click(rect.x + rect.width * 0.15, rect.y + rect.height * 0.1, { button: 'right' });
  await expect(page.locator('.ctxmenu .ctxitem', { hasText: 'Group 2 drawings' }).locator('.ctxkbd')).toHaveText(label);
  assertNoPageErrors(page);
});
