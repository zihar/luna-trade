// Shift = kunci sudut ke kelipatan 45° saat menggambar / menyeret ujung garis.
// Spec: docs/superpowers/specs/2026-08-07-shift-angle-lock-design.md
//
// Sudut dihitung di RUANG PIKSEL (lihat spec), jadi assertion-nya juga pixel: jarak tegak lurus
// titik yang mendarat dari sinar 45° ideal. Itu ukuran yang langsung berarti bagi mata pengguna,
// dan sejalan dgn kebijakan toleransi ≤1px suite ini — beda dgn toleransi sudut, yang di garis
// pendek longgar dan di garis panjang ketat untuk penyimpangan piksel yang sama.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, dragPoint, CLICK_GAP_MS } = require('../helpers/draw');

const TOL_PX = 1.5;

/** Jarak tegak lurus titik p dari sinar bersudut `deg` yang berpangkal di a. */
function distFromRay(a, p, deg) {
  const r = (deg * Math.PI) / 180;
  const ux = Math.cos(r), uy = Math.sin(r);
  const vx = p.x - a.x, vy = p.y - a.y;
  return Math.abs(vx * uy - vy * ux); // |v × u|
}

/** Kelipatan 45° terdekat dari arah a→p. */
function nearest45(a, p) {
  const deg = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
  return Math.round(deg / 45) * 45;
}

test.describe('Shift: kunci sudut 45°', () => {
  // Empat arah kursor yang sengaja MELESET dari kelipatan 45 — tanpa penguncian, titiknya
  // mendarat persis di kursor dan assertion di bawah gagal.
  const ARAH = [
    { nama: 'hampir horizontal', dx: 260, dy: 40, want: 0 },
    { nama: 'hampir diagonal turun', dx: 220, dy: 160, want: 45 },
    { nama: 'hampir vertikal', dx: 30, dy: -200, want: -90 },
    { nama: 'hampir diagonal naik', dx: -210, dy: -150, want: -135 },
  ];

  for (const a of ARAH) {
    test(`menggambar trendline dgn Shift → ${a.nama} dikunci ke ${a.want}°`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      const p1 = { x: Math.round(rect.width * 0.42), y: Math.round(rect.height * 0.5) };

      await armTool(page, 'trendline');
      await clickAt(page, rect, p1);
      await page.waitForTimeout(CLICK_GAP_MS);

      await page.keyboard.down('Shift');
      const p2 = { x: p1.x + a.dx, y: p1.y + a.dy };
      await page.mouse.move(rect.x + p2.x, rect.y + p2.y, { steps: 8 });
      await page.waitForTimeout(80);
      await clickAt(page, rect, p2);
      await page.waitForTimeout(CLICK_GAP_MS);
      await page.keyboard.up('Shift');

      await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
      const obj = (await overlays(page))[0];
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      const px = await toPixels(page, obj.points);

      expect(nearest45(px[0], px[1]), `arah garis tak dikunci ke ${a.want}°`).toBe(a.want);
      expect(
        distFromRay(px[0], px[1], a.want),
        `titik #2 melenceng dari sinar ${a.want}° (kursor sengaja meleset ${a.dx},${a.dy})`
      ).toBeLessThanOrEqual(TOL_PX);
      assertNoPageErrors(page);
    });
  }

  test('Shift dilepas di tengah gerakan → titik kembali mengikuti kursor', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const p1 = { x: Math.round(rect.width * 0.42), y: Math.round(rect.height * 0.5) };
    const p2 = { x: p1.x + 260, y: p1.y + 40 }; // ~9°, jauh dari kelipatan 45

    await armTool(page, 'trendline');
    await clickAt(page, rect, p1);
    await page.waitForTimeout(CLICK_GAP_MS);

    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + p2.x, rect.y + p2.y, { steps: 6 });
    await page.waitForTimeout(80);
    await page.keyboard.up('Shift');
    await page.mouse.move(rect.x + p2.x, rect.y + p2.y - 1, { steps: 2 }); // gerak kecil setelah dilepas
    await page.mouse.move(rect.x + p2.x, rect.y + p2.y, { steps: 2 });
    await page.waitForTimeout(80);
    await clickAt(page, rect, p2);
    await page.waitForTimeout(CLICK_GAP_MS);

    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    const px = await toPixels(page, (await overlays(page))[0].points);
    expect(Math.abs(px[1].y - (rect.y + p2.y - rect.y)), 'titik tak kembali ke kursor setelah Shift dilepas').toBeLessThanOrEqual(TOL_PX);
    expect(Math.abs(px[1].y - p2.y), 'titik masih terkunci horizontal padahal Shift sudah dilepas').toBeLessThanOrEqual(TOL_PX);
    assertNoPageErrors(page);
  });

  test('menyeret ujung objek jadi dgn Shift → sudut terkunci (measure tak merebut)', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const p1 = { x: Math.round(rect.width * 0.4), y: Math.round(rect.height * 0.42) };
    const p2 = { x: Math.round(rect.width * 0.62), y: Math.round(rect.height * 0.62) };

    await armTool(page, 'trendline');
    await clickAt(page, rect, p1);
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, p2);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const before = await toPixels(page, (await overlays(page))[0].points);
    const target = { x: before[0].x + 250, y: before[0].y + 35 }; // ~8° → harus dikunci ke 0°

    await page.keyboard.down('Shift');
    await dragPoint(page, rect, before[1], target);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);

    const after = await toPixels(page, (await overlays(page))[0].points);
    expect(await page.evaluate(() => measureId), 'measure merebut drag di atas objek').toBeNull();
    expect(nearest45(after[0], after[1]), 'ujung yang diseret tak dikunci ke 0°').toBe(0);
    expect(distFromRay(after[0], after[1], 0), 'ujung yang diseret melenceng dari sinar 0°').toBeLessThanOrEqual(TOL_PX);
    assertNoPageErrors(page);
  });

  test('magnet ON + Shift: sudut persis, titik #1 tetap nempel OHLC', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();

    const p1 = { x: Math.round(rect.width * 0.42), y: Math.round(rect.height * 0.5) };
    const p2 = { x: p1.x + 240, y: p1.y + 175 }; // ~36° → dikunci ke 45°

    await armTool(page, 'trendline');
    await clickAt(page, rect, p1);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + p2.x, rect.y + p2.y, { steps: 8 });
    await page.waitForTimeout(80);
    await clickAt(page, rect, p2);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    const px = await toPixels(page, obj.points);
    expect(distFromRay(px[0], px[1], 45), 'sudut tak persis 45° saat magnet ON').toBeLessThanOrEqual(TOL_PX);

    const p1OnOhlc = await page.evaluate((p) => {
      const list = chart.getDataList();
      return list.some((d) => [d.open, d.high, d.low, d.close].some((v) => Math.abs(v - p.value) < 1e-9));
    }, obj.points[0]);
    expect(p1OnOhlc, 'titik #1 harus tetap hasil magnet (nempel OHLC)').toBe(true);
    assertNoPageErrors(page);
  });

  test('regresi: Shift+drag di ruang KOSONG tetap memunculkan measure', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const from = { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.4) };

    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + from.x, rect.y + from.y);
    await page.mouse.down();
    await page.mouse.move(rect.x + from.x + 140, rect.y + from.y + 90, { steps: 8 });
    const idSaatDrag = await page.evaluate(() => measureId);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    expect(idSaatDrag, 'Shift+drag di ruang kosong tak lagi memunculkan penggaris').not.toBeNull();
    assertNoPageErrors(page);
  });

  test('tool di luar daftar (rect) tak terpengaruh Shift', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const p1 = { x: Math.round(rect.width * 0.4), y: Math.round(rect.height * 0.45) };
    const p2 = { x: p1.x + 200, y: p1.y + 60 }; // rasio sengaja bukan 1:1 & bukan kelipatan 45

    await armTool(page, 'rect');
    await clickAt(page, rect, p1);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + p2.x, rect.y + p2.y, { steps: 6 });
    await page.waitForTimeout(80);
    await clickAt(page, rect, p2);
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const px = await toPixels(page, (await overlays(page))[0].points);
    const xs = px.filter(Boolean).map((p) => p.x), ys = px.filter(Boolean).map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    expect(Math.abs(w - 200), 'lebar rect berubah karena Shift').toBeLessThanOrEqual(3);
    expect(Math.abs(h - 60), 'tinggi rect berubah karena Shift (rect tak boleh jadi persegi)').toBeLessThanOrEqual(3);
    assertNoPageErrors(page);
  });
});
