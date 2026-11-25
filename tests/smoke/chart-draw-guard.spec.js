// Chart beku permanen sesudah SATU error gambar (js/chart-draw-guard.js).
//
// klinecharts 9.8.10 melepas "rAF sedang berjalan" per kanvas hanya di akhir callback; bila
// listener gambar throw sekali, kanvas itu tak pernah digambar ulang lagi (Reset chart pun tak
// menolong). Test ini menyuntik satu throw ke kanvas candle, lalu memastikan permintaan gambar
// berikutnya tetap dilayani.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('satu error gambar tak membekukan kanvas candle selamanya', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => {
    const cvs = chart.getAllDrawPanes().find((p) => p.getId() === 'candle_pane').getMainWidget()._mainCanvas;
    const orig = cvs._listener;
    window.__draws = 0;
    let thrown = false;
    cvs._listener = function () {
      window.__draws++;
      if (!thrown) { thrown = true; throw new Error('injected draw failure'); }
      return orig.apply(this, arguments);
    };
    window.__cvs = cvs;
  });

  const kick = () => page.evaluate(() => { chart.scrollByDistance(-20); });

  // Frame pertama: listener throw.
  await kick();
  await expect.poll(() => page.evaluate(() => window.__draws)).toBeGreaterThanOrEqual(1);

  // Frame berikutnya HARUS tetap digambar (dulu: id rAF nyangkut → diabaikan selamanya).
  await kick();
  await expect.poll(() => page.evaluate(() => window.__draws)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__cvs._requestAnimationId)).toBe(-1);

  // Error ditelan penjaga (dicatat ke konsol), bukan uncaught.
  assertNoPageErrors(page);
});
