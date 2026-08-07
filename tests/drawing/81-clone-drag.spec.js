// Ctrl/⌘ + drag BADAN objek = clone (salinan tertinggal di posisi asal).
// Spec: docs/superpowers/specs/2026-08-07-clone-ctrl-drag-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, dragPoint, CLICK_GAP_MS } = require('../helpers/draw');

/** Gambar satu trendline di posisi yang bisa diprediksi, kembalikan objek + pixel titiknya. */
async function drawLine(page, rect) {
  const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
  const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  const obj = (await overlays(page))[0];
  return { obj, px: await toPixels(page, obj.points) };
}

/**
 * Titik di BADAN garis — sengaja BUKAN hoverableSpot(): helper itu mencoba endpoint lebih dulu,
 * jadi ia mengembalikan handle titik dan gestur yang dihasilkan menyeret UJUNG, bukan badan
 * (terukur: figureKey = overlay_figure_point_0). Perbedaan itu justru inti test ini.
 * 30% panjang, bukan tengah: titik tengah trendline dipakai placeholder "+ Add text".
 */
async function bodySpot(page, rect, obj, px) {
  const s = { x: px[0].x + (px[1].x - px[0].x) * 0.3, y: px[0].y + (px[1].y - px[0].y) * 0.3 };
  await page.mouse.move(rect.x + s.x, rect.y + s.y, { steps: 4 });
  expect(await page.evaluate((id) => hoverId === id, obj.id), 'titik badan yang dipilih tak meng-hover objek').toBe(true);
  return s;
}

/** Seret BADAN objek ke (dx,dy), opsional dengan modifier ditahan. */
async function dragBody(page, rect, obj, px, dx, dy, mod) {
  const spot = await bodySpot(page, rect, obj, px);
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(rect.x + spot.x, rect.y + spot.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(rect.x + spot.x + dx, rect.y + spot.y + dy, { steps: 10 });
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(200); // scheduleSaveDraws 350ms → beri ruang untuk render, bukan untuk save
}

test.describe('clone: Ctrl/⌘ + drag badan', () => {
  for (const mod of ['Control', 'Meta']) {
    test(`${mod}+drag badan → 2 objek, salinan diam di posisi asal`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      const { obj, px } = await drawLine(page, rect);

      await dragBody(page, rect, obj, px, 90, 60, mod);

      const after = await overlays(page);
      expect(after, `${mod}+drag harus meninggalkan salinan (jadi 2 objek)`).toHaveLength(2);

      // Salah satu objek harus persis di posisi semula; satunya lagi tergeser.
      const posisi = await Promise.all(after.map((o) => toPixels(page, o.points)));
      const samaDgnAsal = posisi.filter((p) => p.every((q, i) => q && Math.abs(q.x - px[i].x) <= 1 && Math.abs(q.y - px[i].y) <= 1));
      expect(samaDgnAsal, 'tak ada salinan yang tertinggal di posisi asal').toHaveLength(1);
      const tergeser = posisi.filter((p) => p.some((q, i) => q && (Math.abs(q.x - px[i].x) > 5 || Math.abs(q.y - px[i].y) > 5)));
      expect(tergeser, 'tak ada objek yang benar-benar tergeser').toHaveLength(1);
      assertNoPageErrors(page);
    });
  }

  test('tanpa modifier: drag badan tetap SATU objek', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    await dragBody(page, rect, obj, px, 90, 60, null);

    expect(await overlays(page), 'drag biasa tak boleh meng-clone').toHaveLength(1);
    // KEDUA titik harus bergeser sejauh yang sama — itu yang membedakan "menyeret badan"
    // (translasi) dari "menyeret ujung". Tanpa syarat ini, test lolos walau gesturnya ternyata
    // mengenai handle titik, dan cabang kode yang mau diuji tak pernah tersentuh.
    const after = await toPixels(page, (await overlays(page))[0].points);
    after.forEach((p, i) => {
      expect(Math.abs(p.x - px[i].x - 90), `titik #${i} tak ikut tergeser sejauh drag (bukan translasi badan)`).toBeLessThanOrEqual(3);
      expect(Math.abs(p.y - px[i].y - 60), `titik #${i} tak ikut tergeser sejauh drag (bukan translasi badan)`).toBeLessThanOrEqual(3);
    });
    assertNoPageErrors(page);
  });

  test('Ctrl + drag HANDLE TITIK: tak meng-clone, titiknya yang bergerak', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { px } = await drawLine(page, rect);

    await page.keyboard.down('Control');
    await dragPoint(page, rect, px[1], { x: px[1].x + 80, y: px[1].y - 50 });
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    const after = await overlays(page);
    expect(after, 'drag handle titik tak boleh meng-clone').toHaveLength(1);
    const pxAfter = await toPixels(page, after[0].points);
    expect(Math.abs(pxAfter[0].x - px[0].x), 'titik #0 tak boleh ikut bergerak').toBeLessThanOrEqual(2);
    expect(Math.abs(pxAfter[1].x - px[1].x), 'titik #1 harus bergerak').toBeGreaterThan(5);
    assertNoPageErrors(page);
  });

  test('salinan mewarisi gaya & teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    await page.evaluate((id) => {
      setObjStyle(id, { color: '#ff00aa', size: 4, style: 'dashed' });
      chart.overrideOverlay({ id, extendData: 'HALO' });
    }, obj.id);
    await page.waitForTimeout(120);

    await dragBody(page, rect, obj, px, 90, 60, 'Control');

    const after = await overlays(page);
    expect(after).toHaveLength(2);
    const salinan = await page.evaluate(
      (ids) =>
        ids.map((id) => {
          const o = chart.getOverlayById(id);
          return { style: objStyle[id] || null, text: o && typeof o.extendData === 'string' ? o.extendData : null };
        }),
      after.map((o) => o.id)
    );
    salinan.forEach((s, i) => {
      expect(s.style, `objek #${i} kehilangan gaya per-objek`).toBeTruthy();
      expect(s.style.color, `warna objek #${i} tak tersalin`).toBe('#ff00aa');
      expect(s.style.size, `tebal objek #${i} tak tersalin`).toBe(4);
      expect(s.text, `teks objek #${i} tak tersalin`).toBe('HALO');
    });
    assertNoPageErrors(page);
  });

  test('objek TERKUNCI tak ter-clone & tak bergeser', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    await page.evaluate((id) => chart.overrideOverlay({ id, lock: true }), obj.id);
    await page.waitForTimeout(120);

    await dragBody(page, rect, obj, px, 90, 60, 'Control');

    expect(await overlays(page), 'objek terkunci tak boleh ter-clone').toHaveLength(1);
    const after = await toPixels(page, (await overlays(page))[0].points);
    after.forEach((p, i) => {
      expect(Math.abs(p.x - px[i].x), `objek terkunci bergeser di X (titik #${i})`).toBeLessThanOrEqual(2);
      expect(Math.abs(p.y - px[i].y), `objek terkunci bergeser di Y (titik #${i})`).toBeLessThanOrEqual(2);
    });
    assertNoPageErrors(page);
  });

  test('undo setelah clone → kembali satu objek', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    await dragBody(page, rect, obj, px, 90, 60, 'Control');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(2);
    await page.waitForTimeout(500); // biarkan scheduleSaveDraws (350ms) mencatat state 2-objek

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(1);
    assertNoPageErrors(page);
  });
});
