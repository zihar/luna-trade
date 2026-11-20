// Lebar sumbu harga (Y) tak boleh menyusut-mengembang saat zoom/geser.
//
// KLineCharts menghitung ulang lebar sumbu tiap layout dari label TERLEBAR yang sedang tampak
// (font proporsional Inter Tight + jumlah desimal tick yang ikut interval). Tiap zoom/geser
// mengubah label → lebar meloncat ±1–6px → seluruh area plot (candle + gambar) ikut bergeser ke
// samping. Itulah "layar bergetar" yang dilaporkan. Kontraknya kini: dalam satu instrumen lebar
// sumbu hanya boleh MEMBESAR (grow-only), tak pernah mengecil.
const { test, expect } = require('@playwright/test');
const { gotoApp } = require('../helpers/app');

test('lebar sumbu harga tidak mengecil selama zoom & geser', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await gotoApp(page);
  await page.evaluate(() => {
    const log = (window.__axw = []);
    const tick = () => {
      try { log.push(chart.getSize('candle_pane', 'yAxis').width); } catch (e) {}
      if (!window.__axStop) requestAnimationFrame(tick);
    };
    tick();
  });
  const box = await page.locator('#chart').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); }
  for (let i = 0; i < 35; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); }
  await page.mouse.down();
  for (let i = 0; i < 50; i++) {
    await page.mouse.move(cx + Math.sin(i / 5) * 300, cy + Math.cos(i / 7) * 120);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const widths = await page.evaluate(() => { window.__axStop = true; return window.__axw; });
  const shrinks = [];
  for (let i = 1; i < widths.length; i++) if (widths[i] < widths[i - 1]) shrinks.push(`${widths[i - 1]}→${widths[i]}`);
  expect(shrinks, 'sumbu harga menyusut (plot bergeser ke samping)').toEqual([]);
});

test('lebar sumbu harga dihitung ulang saat ganti instrumen', async ({ page }) => {
  await gotoApp(page);
  // Lebar grow-only adalah memo per sumbu; reset harus mengosongkannya supaya instrumen lain
  // (mis. digit harga lebih sedikit) tak mewarisi lebar sumbu instrumen sebelumnya.
  const r = await page.evaluate(() => {
    const ax = chart.getAllDrawPanes().find((p) => p.getId() === 'candle_pane').getAxisComponent();
    ax.__lunaMaxW = 999;
    resetPriceAxisWidth(chart);
    return ax.__lunaMaxW;
  });
  expect(r).toBeNull();
});
