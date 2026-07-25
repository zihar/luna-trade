// Magnet (snap ke OHLC), ganti timeframe, dan titik di area future.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels, barAt, barSpace, plotWidth } = require('../helpers/chart');
const { armTool, clickAt, overlays, drawTool, inProgress, CLICK_GAP_MS } = require('../helpers/draw');

test.describe('magnet', () => {
  test('magnet ON: titik menempel ke salah satu nilai OHLC candle terdekat', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    await page.locator('#magBtn').click();
    await expect(page.locator('#magBtn')).toHaveClass(/armed/);
    expect(await page.evaluate(() => magnetOn)).toBe(true);

    // Klik di antara level OHLC (bukan tepat di salah satunya) → harus tertarik ke OHLC.
    const targets = [
      { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.47) },
      { x: Math.round(rect.width * 0.6), y: Math.round(rect.height * 0.33) },
    ];
    await armTool(page, 'trendline');
    for (const t of targets) {
      await clickAt(page, rect, t);
      await page.waitForTimeout(CLICK_GAP_MS);
    }
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    expect(obj, 'objek harus terbentuk').toBeTruthy();

    // Tiap titik harus persis sama dengan salah satu O/H/L/C dari SEBUAH bar di dataset.
    const snapped = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          const list = chart.getDataList();
          return list.some((d) => [d.open, d.high, d.low, d.close].some((v) => Math.abs(v - p.value) < 1e-9));
        }),
      obj.points
    );
    snapped.forEach((ok, i) => expect(ok, `titik #${i} tak menempel ke nilai OHLC mana pun (magnet ON)`).toBe(true));
    assertNoPageErrors(page);
  });

  test('magnet ON: preview juga sudah menempel (mode strong_magnet), bukan cuma hasil akhir', async ({ page }) => {
    // index.html:3129-3132 — magnet ON menyetel mode overlay ke 'strong_magnet' supaya garis
    // preview langsung nempel. Kalau hanya hasil akhir yang nempel, objek akan "melompat"
    // ke OHLC saat klik terakhir.
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();
    await armTool(page, 'trendline');

    await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.47) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.mouse.move(rect.x + Math.round(rect.width * 0.6), rect.y + Math.round(rect.height * 0.33), { steps: 8 });
    await page.waitForTimeout(120);

    const prog = await inProgress(page);
    expect(prog, 'overlay in-progress harus ada').toBeTruthy();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode), 'mode overlay saat magnet ON').toBe('strong_magnet');

    const onOhlc = await page.evaluate((pts) => {
      const list = chart.getDataList();
      return pts.filter(Boolean).map((p) => list.some((d) => [d.open, d.high, d.low, d.close].some((v) => Math.abs(v - p.value) < 1e-9)));
    }, prog.points);
    expect(onOhlc.some(Boolean), 'setidaknya satu titik preview harus sudah menempel ke OHLC').toBe(true);
    assertNoPageErrors(page);
  });

  test('magnet di-toggle saat menggambar → mode overlay in-progress ikut berubah', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);

    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).not.toBe('strong_magnet');
    await page.locator('#magBtn').click();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).toBe('strong_magnet');
    await page.locator('#magBtn').click();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).toBe('normal');
    assertNoPageErrors(page);
  });
});

test.describe('ganti timeframe', () => {
  test('objek tetap di harga & waktu yang sama setelah TF diganti', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    const before = obj.points.map((p) => ({ value: p.value, timestamp: p.timestamp, dataIndex: p.dataIndex }));

    // Waktu wall-clock tiap titik SEBELUM pindah TF (dataIndex → timestamp via dataset kini).
    const tsBefore = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          if (p.timestamp != null) return p.timestamp;
          const list = chart.getDataList();
          const i = Math.round(p.dataIndex);
          return list[Math.max(0, Math.min(list.length - 1, i))].timestamp;
        }),
      before
    );

    // H1 bukan favorit default (TF_FAV_DEFAULT = M15, D di index.html:1582) → lewat dropdown.
    await page.locator('#tfMore').click();
    await page.locator('#tfMenu.open').waitFor();
    await page.locator('#tfMenu .tf-row', { has: page.locator('.tf-lbl', { hasText: /^H1$/ }) }).locator('.tf-lbl').click();
    await page.waitForFunction(() => currentTF === 'H1' && chart.getDataList().length > 0, null, { timeout: 20000 });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    const after = (await overlays(page))[0];
    expect(after.name).toBe('trendline');
    // Harga wajib identik.
    after.points.forEach((p, i) => {
      expect(p.value, `harga titik #${i} berubah setelah ganti TF`).toBeCloseTo(before[i].value, 9);
    });
    // Waktu wajib sama dalam toleransi satu bar TF baru (H1) — titik dipetakan ulang ke
    // dataset baru, jadi presisi terbatas pada granularitas bar.
    const tsAfter = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          if (p.timestamp != null) return p.timestamp;
          const list = chart.getDataList();
          const i = Math.round(p.dataIndex);
          return list[Math.max(0, Math.min(list.length - 1, i))].timestamp;
        }),
      after.points
    );
    tsAfter.forEach((t, i) => {
      expect(Math.abs(t - tsBefore[i]), `waktu titik #${i} bergeser >1 bar H1 setelah ganti TF`).toBeLessThanOrEqual(60 * 60 * 1000);
    });
    assertNoPageErrors(page);
  });
});

test.describe('area future', () => {
  test('titik di kanan bar terakhir tak "kelempar" ke tepi kiri', async ({ page }) => {
    // Jaring pengaman eksplisit di index.html:3081 — titik tanpa anchor (timestamp & dataIndex
    // null) akan tergambar di x=0. Test menggambar SENGAJA di area kosong kanan.
    await gotoApp(page);
    const rect = await chartRect(page);
    const bs = await barSpace(page);
    const last = await barAt(page, -1);
    const lastPx = await toPixels(page, [{ timestamp: last.timestamp, value: last.close }]);

    // Batas kanan = tepi AREA PLOT, bukan tepi container: 52px terakhir adalah sumbu harga
    // (lihat plotWidth). Klik di sumbu tak masuk ke chart dan akan salah dituduh sebagai bug.
    const pw = await plotWidth(page);
    const room = pw - lastPx[0].x;
    test.skip(room < 3 * bs, `tak ada ruang future di kanan (${Math.round(room)}px) — chart menempel ke tepi plot`);

    const targets = [
      { x: Math.round(lastPx[0].x + bs * 1.5), y: Math.round(rect.height * 0.45) },
      { x: Math.round(Math.min(pw - 4, lastPx[0].x + room * 0.75)), y: Math.round(rect.height * 0.3) },
    ];
    await armTool(page, 'trendline');
    for (const t of targets) {
      await clickAt(page, rect, t);
      await page.waitForTimeout(CLICK_GAP_MS);
    }
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    expect(obj, 'objek di area future harus terbentuk').toBeTruthy();
    const px = await toPixels(page, obj.points);
    px.forEach((p, i) => {
      expect(p, `titik #${i} tak bisa dikonversi ke pixel`).toBeTruthy();
      expect(p.x, `titik #${i} kelempar ke tepi kiri (x=${p && p.x})`).toBeGreaterThan(lastPx[0].x - bs);
      expect(Math.abs(p.x - targets[i].x), `titik #${i} tak mendarat di area future yang diklik`).toBeLessThanOrEqual(bs);
    });
    assertNoPageErrors(page);
  });
});
