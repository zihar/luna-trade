// Fib Retracement: tab Style PER OBJEK ala TradingView (menggantikan popup global "Fibonacci levels").
// Level & background di-snapshot ke objek saat dibuat → mengedit satu Fib tak mengubah Fib lain;
// Fib lama tanpa snapshot tetap mengikuti default global (br_fibLevels / br_fibBg).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');

/** Figur hasil createPointFigures fib3 untuk overlay sungguhan (koordinat piksel dari titiknya). */
const figs = (page, id) => page.evaluate((i) => {
  const o = chart.getOverlayById(i), C = klinecharts.getOverlayClass('fib3');
  const coords = chart.convertToPixel(o.points, { paneId: 'candle_pane' });
  return new C({}).createPointFigures({ overlay: o, coordinates: coords, bounding: { width: 800, height: 400 } })
    .map((f) => ({ type: f.type, text: f.attrs.text, c: f.attrs.coordinates, color: f.styles && f.styles.color }));
}, id);
const texts = async (page, id) => (await figs(page, id)).filter((f) => f.type === 'text').map((f) => f.text);

async function openStyle(page, id) {
  await page.evaluate((i) => openObjSettings(chart.getOverlayById(i), 10, 10, 'style'), id);
  return page.locator('.dmodal-scrim.show .dm-pane[data-pane="style"]');
}

test('Fib: level per objek — snapshot, Add/hapus/Reset, checkbox, nilai ber-koma; Fib lain tak ikut', async ({ page }) => {
  await gotoApp(page);
  const a = (await drawTool(page, 'fib3')).obj;
  const b = (await drawTool(page, 'fib3')).obj;
  expect(a && b, 'dua Fib harus terbentuk').toBeTruthy();
  const lv = (id) => page.evaluate((i) => objStyle[i] && objStyle[i].fibLevels, id);
  expect(await lv(a.id), 'snapshot default saat dibuat').toEqual(await page.evaluate(() => fibLevels));
  expect([...(await texts(page, a.id))].sort()).toEqual(['0.00%', '100.00%', '50.00%']);

  const pane = await openStyle(page, a.id);
  await expect(page.locator('.fib-modal')).toHaveCount(0);
  const rows = pane.locator('.fp-row');
  await expect(rows).toHaveCount(3);
  await pane.locator('#fpAdd').click();
  await expect(rows).toHaveCount(4);
  const val = rows.last().locator('.fp-val');
  await val.fill('0,382');
  await val.press('Enter');
  expect((await lv(a.id))[3].value).toBe(0.382);
  expect(await texts(page, a.id)).toContain('38.20%');
  // checkbox mati = level tersimpan tapi tak digambar
  await rows.nth(1).locator('.fp-on').uncheck();
  expect((await lv(a.id))[1].on).toBe(false);
  expect(await texts(page, a.id)).not.toContain('50.00%');
  await rows.last().locator('.fp-x').click();
  await expect(rows).toHaveCount(3);
  // Fib B punya snapshot sendiri → tak berubah
  expect((await lv(b.id)).length).toBe(3);
  expect(await texts(page, b.id)).toContain('50.00%');
  // default global ikut setelan terakhir (Fib berikutnya mewarisi)
  expect((await page.evaluate(() => fibLevels))[1].on).toBe(false);
  await pane.locator('#fpReset').click();
  expect(await lv(a.id)).toEqual(await page.evaluate(() => defaultFibLevels()));
  // nilai tak valid ditolak & dikembalikan
  await rows.first().locator('.fp-val').fill('abc');
  await expect(rows.first().locator('.fp-val')).toHaveClass(/bad/);
  await rows.first().locator('.fp-val').press('Enter');
  await expect(rows.first().locator('.fp-val')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
  assertNoPageErrors(page);
});

test('Fib lama tanpa snapshot mengikuti default global', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'fib3');
  await page.evaluate((id) => {
    delete objStyle[id].fibLevels; delete objStyle[id].fibBg; delete objStyle[id].fibBgAlpha;
    fibLevels = [{ value: 0.618, color: '#089981', on: true }];
  }, obj.id);
  expect(await texts(page, obj.id)).toEqual(['61.80%']);
});

test('Fib: opsi Style — extend, reverse, label (prices/values/posisi), one color, background, trend line', async ({ page }) => {
  await gotoApp(page);
  const { obj } = await drawTool(page, 'fib3');
  const id = obj.id;
  const lines0 = (await figs(page, id)).filter((f) => f.type === 'line');
  const pane = await openStyle(page, id);

  // Extend Right: garis level memanjang ke tepi kanan pane (bounding.width=800)
  await pane.locator('[data-fext="fibExtendRight"]').click();
  const ext = (await figs(page, id)).filter((f) => f.type === 'line');
  expect(Math.max(...ext.map((l) => l.c[1].x))).toBe(800);

  // Reverse: posisi 0% ↔ 100% bertukar
  const yOf = async (t) => { const F = await figs(page, id), i = F.findIndex((f) => f.text === t); return F[i - 1].c[0].y; };
  const y0 = await yOf('0.00%'), y100 = await yOf('100.00%');
  await pane.locator('[data-fflag="fibReverse"]').click();
  expect(await yOf('0.00%')).toBeCloseTo(y100, 5);
  expect(await yOf('100.00%')).toBeCloseTo(y0, 5);

  // Labels: Values + Prices; Levels off → hanya harga
  await pane.locator('[data-fmode="value"]').click();
  await pane.locator('[data-fflag="fibShowPrices"]').click();
  expect((await texts(page, id)).some((t) => /^0\.5 \(.+\)$/.test(t))).toBe(true);
  await pane.locator('[data-fflag="fibShowLevels"]').click();
  expect((await texts(page, id)).every((t) => !t.includes('('))).toBe(true);
  // posisi label kanan → align left di sisi kanan kotak
  await pane.locator('[data-flh="right"]').click();
  await pane.locator('[data-flv="top"]').click();
  await pane.locator('[data-ffs]').selectOption('14');
  expect(await page.evaluate((i) => {
    const s = objStyle[i]; return [s.fibLabelH, s.fibLabelV, s.fibFontSize];
  }, id)).toEqual(['right', 'top', 14]);

  // Use one color: semua garis level satu warna
  await pane.locator('[data-fone]').click();
  const oneCol = await page.evaluate((i) => objStyle[i].fibOneColor, id);
  expect(oneCol).toBeTruthy();
  expect(new Set((await figs(page, id)).filter((f) => f.type === 'line').map((f) => f.color))).toEqual(new Set([oneCol]));

  // Background: rect antar level
  expect((await figs(page, id)).filter((f) => f.type === 'rect')).toHaveLength(0);
  await pane.locator('[data-fbg]').click();
  expect((await figs(page, id)).filter((f) => f.type === 'rect').length).toBe(2);

  // Trend line: satu garis diagonal tambahan
  await pane.locator('[data-ftrend]').click();
  const diag = (await figs(page, id)).filter((f) => f.type === 'line' && f.c[0].y !== f.c[1].y);
  expect(diag).toHaveLength(1);
  expect(lines0.length).toBe(3);
  assertNoPageErrors(page);
});
