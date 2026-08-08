// Ctrl/⌘+C & Ctrl/⌘+V objek gambar — clipboard aplikasi, paste mendarat di kursor.
// Spec: docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

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

/** Objek selain `id` — yang baru lahir dari paste. */
async function otherThan(page, id) {
  const all = await overlays(page);
  const o = all.find((x) => x.id !== id);
  return o ? { obj: o, px: await toPixels(page, o.points) } : null;
}

test.describe('copy/paste objek: API', () => {
  test('copy lalu paste → 2 objek, bentuk sama, titik-1 mendarat di titik paste', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    expect(await page.evaluate(() => copyOverlay()), 'copyOverlay harus true untuk objek terpilih').toBe(true);

    const target = { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.7) };
    await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'paste harus menambah satu objek').toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - target.x), 'titik-1 tak mendarat di X titik paste').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - target.y), 'titik-1 tak mendarat di Y titik paste').toBeLessThanOrEqual(1);
    // Bentuk = jarak antar titik dalam PIKSEL, persis yang direkam saat copy.
    expect(Math.abs((baru.px[1].x - baru.px[0].x) - (px[1].x - px[0].x)), 'lebar bentuk berubah').toBeLessThanOrEqual(1);
    expect(Math.abs((baru.px[1].y - baru.px[0].y) - (px[1].y - px[0].y)), 'tinggi bentuk berubah').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  test('tanpa objek terpilih: copy gagal & paste tak membuat apa pun', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.keyboard.press('Escape'); // lepas pilihan
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => selectedId), 'prasyarat: tak ada objek terpilih').toBeNull();

    expect(await page.evaluate(() => copyOverlay()), 'copy tanpa seleksi harus false').toBe(false);
    expect(await page.evaluate(() => drawClip), 'clipboard tak boleh terisi').toBeNull();
    expect(await page.evaluate(() => pasteOverlayAt(50, 50)), 'paste dgn clipboard kosong harus null').toBeNull();
    expect(await overlays(page), 'tak boleh ada objek baru').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('salinan mewarisi gaya & teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    await page.evaluate((id) => {
      setObjStyle(id, { color: '#ff00aa', size: 4, style: 'dashed' });
      chart.overrideOverlay({ id, extendData: 'HALO' });
    }, obj.id);
    await page.waitForTimeout(120);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(80, 80); });
    await page.waitForTimeout(150);

    const baru = await otherThan(page, obj.id);
    const salinan = await page.evaluate((id) => {
      const o = chart.getOverlayById(id);
      return { style: objStyle[id] || null, text: o && typeof o.extendData === 'string' ? o.extendData : null };
    }, baru.obj.id);
    expect(salinan.style, 'salinan kehilangan gaya per-objek').toBeTruthy();
    expect(salinan.style.color, 'warna tak tersalin').toBe('#ff00aa');
    expect(salinan.style.size, 'tebal tak tersalin').toBe(4);
    expect(salinan.text, 'teks tak tersalin').toBe('HALO');
    // `lock` sengaja TIDAK ikut tersalin: salinan yang lahir terkunci hanya menjebak.
    expect(await page.evaluate((id) => !!(chart.getOverlayById(id) || {}).lock, baru.obj.id), 'hasil paste tak boleh terkunci').toBe(false);
    assertNoPageErrors(page);
  });

  test('paste dua kali di dua posisi → 3 objek, masing-masing di tempatnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const a = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.25) };
    const b = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.75) };
    const ids = await page.evaluate(([pa, pb]) => {
      copyOverlay();
      return [pasteOverlayAt(pa.x, pa.y), pasteOverlayAt(pb.x, pb.y)];
    }, [a, b]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'dua paste harus menghasilkan 3 objek').toHaveLength(3);
    expect(ids[0], 'paste pertama tak mengembalikan id').toBeTruthy();
    expect(ids[1], 'paste kedua tak mengembalikan id').toBeTruthy();
    expect(ids[0], 'dua paste menghasilkan id yang sama').not.toBe(ids[1]);
    const all = await overlays(page);
    for (const [id, t] of [[ids[0], a], [ids[1], b]]) {
      const p = await toPixels(page, all.find((o) => o.id === id).points);
      expect(Math.abs(p[0].y - t.y), `objek ${id} tak mendarat di Y-nya`).toBeLessThanOrEqual(1);
    }
    assertNoPageErrors(page);
  });

  test('objek hasil paste TERPILIH, tanpa membuka editor teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const nid = await page.evaluate(() => { copyOverlay(); return pasteOverlayAt(90, 90); });
    await page.waitForTimeout(400); // editor teks inline muncul lewat timer 220ms — beri ruang lewat

    expect(await page.evaluate(() => selectedId), 'objek hasil paste harus terpilih').toBe(nid);
    expect(await page.locator('textarea.text-editor').count(), 'paste tak boleh membuka editor teks inline').toBe(0);
    assertNoPageErrors(page);
  });

  test('hasil paste selamat dari reload & bisa di-undo', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(70, 70); });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(2);
    await page.waitForTimeout(600); // scheduleSaveDraws (350ms) harus sempat menulis

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(1);

    await page.keyboard.press('Control+Shift+z'); // redo → kembali 2
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(2);
    await page.waitForTimeout(600);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined',
      null,
      { timeout: 20000 }
    );
    await expect.poll(async () => (await overlays(page)).length, { timeout: 5000 }).toBe(2);
  });
});
