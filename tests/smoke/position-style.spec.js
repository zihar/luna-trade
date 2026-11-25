// Tab Style Long/Short Position ala TradingView (PR5b): Lines, zona, Text, Stats.
// Semua per objek (objStyle) → posisi lain tak ikut berubah.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');

/** Figur posisi sungguhan; sel = id yang dianggap terpilih (null = tak ada yang dipilih/di-hover). */
const figs = (page, id, sel) => page.evaluate(([i, s]) => {
  selectedId = s; hoverId = null;
  const o = chart.getOverlayById(i), C = klinecharts.getOverlayClass(o.name), inst = new C({});
  const coords = chart.convertToPixel(o.points, { paneId: 'candle_pane' });
  const arg = { overlay: o, coordinates: coords, bounding: { width: 800, height: 400 }, yAxis: null };
  const map = (f) => ({ type: f.type, text: f.attrs.text, color: f.styles && f.styles.color, size: f.styles && f.styles.size });
  return { main: inst.createPointFigures(arg).map(map), y: inst.createYAxisFigures(arg).map(map) };
}, [id, sel]);

async function openStyle(page, id) {
  await page.evaluate((i) => openObjSettings(chart.getOverlayById(i), 10, 10, 'style'), id);
  return page.locator('.dmodal-scrim.show .dm-pane[data-pane="style"]');
}
const setColor = (loc, v) => loc.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);

test('Long/Short: tab Style — Lines, Text, Compact, Always show, Price labels (per objek)', async ({ page }) => {
  await gotoApp(page);
  const a = (await drawTool(page, 'longPosition')).obj;
  const b = (await drawTool(page, 'shortPosition')).obj;
  expect(a && b, 'dua posisi harus terbentuk').toBeTruthy();

  // default: stats hanya saat dipilih, price labels di sumbu harga saat dipilih
  expect((await figs(page, a.id, null)).main.filter((f) => f.type === 'text')).toHaveLength(0);
  let f = await figs(page, a.id, a.id);
  expect(f.y).toHaveLength(3);
  expect(f.main.find((x) => x.type === 'text' && /^LONG/.test(x.text))).toBeTruthy();

  const pane = await openStyle(page, a.id);
  await expect(pane.locator('[data-pcol="tgt"]').first()).toBeVisible();   // zona Profit/Stop tetap ada
  await setColor(pane.locator('[data-pslcol]'), '#ff00ff');
  await pane.locator('[data-pslw="3"]').click();
  await setColor(pane.locator('[data-pstcol]'), '#000000');
  await pane.locator('[data-psfs]').selectOption('14');
  await pane.locator('[data-psflag="posCompact"]').click();
  await pane.locator('[data-psflag="posAlwaysStats"]').click();
  await pane.locator('[data-psflag="posPriceLabels"]').click();
  await expect(pane.locator('[data-psflag="posCompact"]')).toHaveAttribute('aria-pressed', 'true');

  // tak dipilih pun stats tampil (Always show), compact, warna/ukuran teks baru
  f = await figs(page, a.id, null);
  const txt = f.main.filter((x) => x.type === 'text');
  expect(txt.length).toBe(3);
  expect(txt.some((x) => /^RR 1:/.test(x.text)), 'compact: tengah cukup RR').toBe(true);
  expect(txt.every((x) => x.color === '#000000' && x.size === 14)).toBe(true);
  expect(txt.some((x) => /p · /.test(x.text)), 'compact: tanpa pips/ticks').toBe(false);
  const ln = f.main.find((x) => x.type === 'line');
  expect(ln).toMatchObject({ color: '#ff00ff', size: 3 });
  expect((await figs(page, a.id, a.id)).y, 'price labels dimatikan').toHaveLength(0);

  // posisi lain tak ikut
  f = await figs(page, b.id, b.id);
  expect(f.y).toHaveLength(3);
  expect(f.main.find((x) => x.type === 'line')).toMatchObject({ color: '#9aa4b2', size: 1 });
  expect(f.main.find((x) => x.type === 'text' && /^SHORT/.test(x.text))).toBeTruthy();
  assertNoPageErrors(page);
});
