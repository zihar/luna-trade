// Sanity harness: kalau spec ini merah, tak ada gunanya membaca spec lain.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, barSpace, fromPixel, toPixel, dataList } = require('../helpers/chart');
const { armTool, clickAt, overlays, inProgress, setCursor, CLICK_GAP_MS } = require('../helpers/draw');
const { CANDLES } = require('../fixtures/api');

test.describe('harness', () => {
  test('boot: chart termuat dari fixture, tanpa error JS', async ({ page }) => {
    await gotoApp(page);

    const bars = await dataList(page);
    expect(bars.length).toBe(CANDLES.candles.length);
    expect(bars[bars.length - 1].close).toBeCloseTo(+CANDLES.candles[CANDLES.candles.length - 1].mid.c, 5);

    // Layar login tak boleh muncul (gerbang /api/auth/me distub 200).
    await expect(page.locator('#authOverlay')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  test('konversi pixel↔chart bolak-balik konsisten', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const bs = await barSpace(page);
    expect(bs).toBeGreaterThan(1);

    for (const fy of [0.15, 0.35, 0.55]) {
      const x = Math.round(rect.width * 0.45);
      const y = Math.round(rect.height * fy);
      const at = await fromPixel(page, x, y);
      expect(at, `convertFromPixel gagal di y=${y}`).toBeTruthy();
      const back = await toPixel(page, { timestamp: at.timestamp, value: at.value });
      expect(back, 'convertToPixel gagal').toBeTruthy();
      // Y wajib presisi; X boleh meleset ≤1 bar karena timestamp di-snap ke bar oleh
      // convertToPixel (index.html pra-Fase-2:587) — itu justru yang diukur spec parity.
      expect(Math.abs(back.y - y), `round-trip Y di fy=${fy}`).toBeLessThanOrEqual(1);
      expect(Math.abs(back.x - x)).toBeLessThanOrEqual(bs);
    }
  });

  test('arm tool lewat rail → overlay in-progress hidup, lalu 2 klik jadi objek', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    await armTool(page, 'trendline');
    const prog = await inProgress(page);
    expect(prog, 'overlay in-progress harus ada setelah arm').toBeTruthy();
    expect(prog.name).toBe('trendline');

    // Jeda WAJIB: dua klik berjarak < ~400ms ditelan lapisan synthetic-event klinecharts
    // (lihat 10-click-timing.spec.js). Tanpa ini, harness sendiri yang jadi flaky.
    await clickAt(page, rect, { x: Math.round(rect.width * 0.34), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.25) });
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const objs = await overlays(page);
    expect(objs).toHaveLength(1);
    expect(objs[0].name).toBe('trendline');
    expect(objs[0].points).toHaveLength(2);
    assertNoPageErrors(page);
  });

  test('mode cursor arrow: crosshair mati TAPI menggambar tetap jalan', async ({ page }) => {
    // Prasyarat aspek parity: foto preview/final diambil tanpa crosshair supaya diff-nya
    // hanya berisi objeknya. Kalau menggambar rusak saat crosshair mati, seluruh
    // pengukuran parity harus pakai cara lain — jadi ini diverifikasi eksplisit.
    await gotoApp(page);
    const rect = await chartRect(page);

    await setCursor(page, 'arrow');
    expect(await page.evaluate(() => chart.getStyles().crosshair.show)).toBe(false);

    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.mouse.move(rect.x + Math.round(rect.width * 0.6), rect.y + Math.round(rect.height * 0.3), { steps: 8 });

    const prog = await inProgress(page);
    expect(prog, 'in-progress hilang saat crosshair mati').toBeTruthy();
    expect(prog.points.filter((p) => p && p.value != null).length, 'titik preview tak terisi saat crosshair mati').toBeGreaterThanOrEqual(2);

    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    const objs = await overlays(page);
    expect(objs).toHaveLength(1);
    expect(objs[0].points).toHaveLength(2);
    assertNoPageErrors(page);
  });
});
