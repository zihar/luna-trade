// Ctrl/⌘ ditahan = magnet sementara: MEMBALIK setelan selama modifier ditahan.
// Spec: docs/superpowers/specs/2026-08-08-magnet-sementara-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels, barAt } = require('../helpers/chart');
const { armTool, clickAt, overlays, setCursor, CLICK_GAP_MS } = require('../helpers/draw');

/** Apakah harga `v` persis salah satu O/H/L/C sebuah bar di dataset? */
async function onOhlc(page, v) {
  return page.evaluate(
    (val) => chart.getDataList().some((d) => [d.open, d.high, d.low, d.close].some((x) => Math.abs(x - val) < 1e-9)),
    v
  );
}

/**
 * Titik bidik yang JAUH dari keempat level OHLC.
 *
 * "Tengah wick" tak cukup: di fixture ini titik tengah wick kebetulan berjarak 0,01px dari `close`,
 * jadi test "nempel vs tidak" lolos tanpa membuktikan apa pun. Yang dicari di sini adalah bar
 * dengan CELAH terlebar antar dua level OHLC bersebelahan, lalu dibidik tepat di tengah celah itu
 * — di sana "ditarik magnet" dan "mendarat di kursor" terpisah jelas secara piksel.
 */
async function farFromOhlc(page) {
  const pick = await page.evaluate(() => {
    const arr = revealed(currentTF);
    let best = null;
    for (let i = Math.max(0, arr.length - 40); i < arr.length - 2; i++) {
      const d = arr[i];
      const vs = [d.open, d.high, d.low, d.close].sort((a, b) => a - b);
      for (let k = 0; k < 3; k++) {
        const gap = vs[k + 1] - vs[k];
        if (!best || gap > best.gap) best = { timestamp: d.timestamp, gap, mid: (vs[k] + vs[k + 1]) / 2 };
      }
    }
    return best;
  });
  const [pxMid, pxEdge] = await toPixels(page, [
    { timestamp: pick.timestamp, value: pick.mid },
    { timestamp: pick.timestamp, value: pick.mid + pick.gap / 2 },
  ]);
  const jarakPx = Math.abs(pxEdge.y - pxMid.y);
  expect(jarakPx, 'fixture tak punya celah OHLC yang cukup lebar untuk membedakan nempel vs tidak').toBeGreaterThan(8);
  return { target: { x: pxMid.x, y: pxMid.y }, jarakPx };
}

/**
 * Gambar trendline dengan titik #1 di titik bidik jauh-dari-OHLC, opsional dengan modifier
 * ditahan sepanjang gestur. Mengembalikan objek + posisi pixel target yang diklik.
 */
async function drawWithMod(page, rect, mod) {
  const far = await barAt(page, -4);
  const { target, jarakPx } = await farFromOhlc(page);
  const [pxFar] = await toPixels(page, [{ timestamp: far.timestamp, value: far.close }]);

  await armTool(page, 'trendline');
  if (mod) await page.keyboard.down(mod);
  await clickAt(page, rect, target);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: pxFar.x, y: pxFar.y });
  await page.waitForTimeout(CLICK_GAP_MS);
  if (mod) await page.keyboard.up(mod);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

  const obj = (await overlays(page))[0];
  return { obj, target, jarakPx, px: await toPixels(page, obj.points) };
}

test.describe('magnet sementara (Ctrl/⌘)', () => {
  for (const mod of ['Control', 'Meta']) {
    test(`magnet OFF + ${mod} → titik nempel ke OHLC`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      expect(await page.evaluate(() => magnetOn), 'prasyarat: magnet default mati').toBe(false);

      const { obj } = await drawWithMod(page, rect, mod);
      expect(await onOhlc(page, obj.points[0].value), `${mod} ditahan tapi titik tak nempel ke OHLC mana pun`).toBe(true);
      assertNoPageErrors(page);
    });
  }

  test('magnet ON + Ctrl → titik TIDAK nempel (mendarat di kursor)', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();
    expect(await page.evaluate(() => magnetOn)).toBe(true);

    const { px, target, obj } = await drawWithMod(page, rect, 'Control');
    // Dua sisi bukti: mendarat di kursor (bukan tertarik), DAN harganya memang bukan OHLC mana pun.
    expect(Math.abs(px[0].y - target.y), 'titik masih ditarik magnet padahal Ctrl seharusnya mematikannya').toBeLessThanOrEqual(2);
    expect(await onOhlc(page, obj.points[0].value), 'titik mendarat persis di OHLC padahal magnet seharusnya mati').toBe(false);
    assertNoPageErrors(page);
  });

  test('magnet OFF, Ctrl DILEPAS di tengah → titik ikut kursor lagi', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    const far = await barAt(page, -4);
    const { target } = await farFromOhlc(page);
    const [pxFar] = await toPixels(page, [{ timestamp: far.timestamp, value: far.close }]);

    await armTool(page, 'trendline');
    await page.keyboard.down('Control');
    await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 4 });
    await page.waitForTimeout(80);
    await page.keyboard.up('Control'); // dilepas SEBELUM klik → magnet harus sudah padam lagi
    await clickAt(page, rect, target);
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, { x: pxFar.x, y: pxFar.y });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const px = await toPixels(page, (await overlays(page))[0].points);
    expect(Math.abs(px[0].y - target.y), 'magnet masih aktif padahal Ctrl sudah dilepas').toBeLessThanOrEqual(2);
    assertNoPageErrors(page);
  });

  test('reticle mengikuti keadaan SEMENTARA, bukan setelan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    const { target, jarakPx } = await farFromOhlc(page);

    // Reticle hanya tampil di cursor mode 'dot' (default 'cross' cuma menampilkan garis silang).
    await setCursor(page, 'dot');
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.3) });
    await page.waitForTimeout(CLICK_GAP_MS);

    const dot = async () =>
      page.evaluate(() => {
        const d = document.querySelector('.mag-dot');
        return d && d.style.display !== 'none' ? { x: parseFloat(d.style.left), y: parseFloat(d.style.top) } : null;
      });

    await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 4 });
    await page.waitForTimeout(80);
    const bebas = await dot();

    await page.keyboard.down('Control');
    await page.mouse.move(rect.x + target.x, rect.y + target.y + 1, { steps: 2 });
    await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 2 });
    await page.waitForTimeout(80);
    const nempel = await dot();
    await page.keyboard.up('Control');

    expect(bebas, 'reticle harus tampil (cursor mode dot)').toBeTruthy();
    expect(nempel, 'reticle harus tampil saat Ctrl ditahan').toBeTruthy();
    expect(Math.abs(nempel.y - bebas.y), 'reticle tak pindah ke OHLC saat Ctrl ditahan').toBeGreaterThan(jarakPx * 0.5);
    assertNoPageErrors(page);
  });

  test('tombol rail tak berubah status karena modifier', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.down('Control');
    await page.mouse.move(300, 300);
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => magnetOn), 'setelan magnet ikut berubah karena modifier').toBe(false);
    await expect(page.locator('#magBtn'), 'tombol magnet menyala padahal cuma modifier sesaat').not.toHaveClass(/armed/);
    await page.keyboard.up('Control');
    assertNoPageErrors(page);
  });

  test('regresi: Ctrl + seret BADAN objek jadi tetap meng-clone', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
    const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
    await armTool(page, 'trendline');
    await clickAt(page, rect, p1);
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, p2);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    const px = await toPixels(page, obj.points);
    const spot = { x: px[0].x + (px[1].x - px[0].x) * 0.3, y: px[0].y + (px[1].y - px[0].y) * 0.3 };

    await page.mouse.move(rect.x + spot.x, rect.y + spot.y, { steps: 4 });
    expect(await page.evaluate((id) => hoverId === id, obj.id)).toBe(true);
    await page.keyboard.down('Control');
    await page.mouse.move(rect.x + spot.x, rect.y + spot.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(rect.x + spot.x + 90, rect.y + spot.y + 60, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(250);

    expect(await overlays(page), 'clone (A1) rusak oleh magnet sementara').toHaveLength(2);
    assertNoPageErrors(page);
  });
});
