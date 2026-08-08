// Siklus hidup objek gambar: drag titik, drag badan, hapus (3 jalur), undo/redo,
// hide/show, persist setelah reload, dan batal saat menggambar.
//
// Objek uji dipilih mewakili tiga geometri berbeda: garis 2-titik (trendline), kotak yang
// mengembang jadi 8 titik (rect), dan objek 1-titik (horizontalStraightLine).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { drawTool, overlays, dragPoint, armTool, clickAt, setCursor, hoverableSpot, CLICK_GAP_MS } = require('../helpers/draw');
const { byName, TOL_Y_PX } = require('../helpers/spec');

const SAMPLES = ['trendline', 'rect', 'horizontalStraightLine'];

test.describe('drag', () => {
  test('drag satu titik: titik itu ikut kursor, titik lain tak bergeming', async ({ page }) => {
    await gotoApp(page);
    const { obj, targets, rect } = await drawTool(page, 'trendline');
    expect(obj.points).toHaveLength(2);

    const before = await toPixels(page, obj.points);
    const from = before[1];
    const to = { x: from.x + 90, y: from.y + 60 };
    await dragPoint(page, rect, from, to);

    const after = await toPixels(page, (await overlays(page))[0].points);
    expect(Math.abs(after[1].x - to.x), 'titik yang di-drag harus mendarat di kursor (X)').toBeLessThanOrEqual(1);
    expect(Math.abs(after[1].y - to.y), 'titik yang di-drag harus mendarat di kursor (Y)').toBeLessThanOrEqual(1);
    expect(Math.abs(after[0].x - before[0].x), 'titik lain tak boleh bergeser (X)').toBeLessThanOrEqual(1);
    expect(Math.abs(after[0].y - before[0].y), 'titik lain tak boleh bergeser (Y)').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  test('drag badan garis: semua titik bergeser sama besar', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const before = await toPixels(page, obj.points);
    const mid = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
    const to = { x: mid.x + 70, y: mid.y + 40 };
    await dragPoint(page, rect, mid, to);

    const after = await toPixels(page, (await overlays(page))[0].points);
    const d0 = { dx: after[0].x - before[0].x, dy: after[0].y - before[0].y };
    const d1 = { dx: after[1].x - before[1].x, dy: after[1].y - before[1].y };
    expect(Math.abs(d0.dx), 'badan digeser → titik harus ikut pindah').toBeGreaterThan(20);
    expect(Math.abs(d0.dx - d1.dx), 'kedua titik harus bergeser sama besar (X)').toBeLessThanOrEqual(1.5);
    expect(Math.abs(d0.dy - d1.dy), 'kedua titik harus bergeser sama besar (Y)').toBeLessThanOrEqual(1.5);
    assertNoPageErrors(page);
  });
});

test.describe('hapus', () => {
  test('tombol Delete menghapus objek terpilih', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const px = (await toPixels(page, obj.points))[0];
    // Pilih dengan mengklik objeknya (bukan lewat state internal).
    await page.mouse.move(rect.x + px.x, rect.y + px.y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('Delete');
    expect(await overlays(page)).toHaveLength(0);
    assertNoPageErrors(page);
  });

  test('eraser: klik objek langsung menghapusnya', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const px = (await toPixels(page, obj.points))[1];

    await setCursor(page, 'eraser');
    expect(await page.evaluate(() => document.body.classList.contains('eraser-on'))).toBe(true);
    await page.mouse.move(rect.x + px.x, rect.y + px.y, { steps: 8 });
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);
    assertNoPageErrors(page);
  });
});

test.describe('undo / redo', () => {
  test('Ctrl+Z membatalkan gambar, Ctrl+Y mengembalikan', async ({ page }) => {
    await gotoApp(page);
    await drawTool(page, 'trendline');
    expect(await overlays(page)).toHaveLength(1);

    await expect(page.locator('#undoBtn')).toBeEnabled();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);

    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(1);
    assertNoPageErrors(page);
  });
});

test.describe('hide / show', () => {
  test('tombol mata menyembunyikan semua gambar tanpa menghapusnya', async ({ page }) => {
    await gotoApp(page);
    await drawTool(page, 'trendline');

    await page.locator('#hideDrawBtn').click();
    let objs = await overlays(page);
    expect(objs, 'objek tak boleh terhapus, hanya disembunyikan').toHaveLength(1);
    expect(objs[0].visible).toBe(false);

    await page.locator('#hideDrawBtn').click();
    objs = await overlays(page);
    expect(objs[0].visible).toBe(true);
    assertNoPageErrors(page);
  });
});

test.describe('persist setelah reload', () => {
  for (const name of SAMPLES) {
    test(`${name}: bertahan di posisi PIXEL yang sama`, async ({ page }) => {
      const spec = byName(name);
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      const before = await toPixels(page, obj.points);

      // Persist ditulis ber-debounce (scheduleSaveDraws) → tunggu storage benar-benar terisi.
      await page.waitForFunction(() => (localStorage.getItem(drawsKey()) || '').length > 2, null, { timeout: 5000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof chart !== 'undefined' && chart.getDataList().length > 0 && typeof drawIds !== 'undefined' && T !== null, null, { timeout: 20000 });
      await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

      const restored = (await overlays(page))[0];
      expect(restored.name).toBe(name);
      expect(restored.points.length, 'jumlah titik setelah restore').toBe(spec.pointsAfter);

      const after = await toPixels(page, restored.points);
      for (let i = 0; i < before.length; i++) {
        expect(Math.abs(after[i].x - before[i].x), `titik #${i} bergeser X setelah reload`).toBeLessThanOrEqual(1);
        expect(Math.abs(after[i].y - before[i].y), `titik #${i} bergeser Y setelah reload`).toBeLessThanOrEqual(TOL_Y_PX);
      }
      assertNoPageErrors(page);
    });
  }
});

test.describe('batal menggambar', () => {
  test('ESC saat menggambar: overlay in-progress dibuang, tak jadi sampah', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.35), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);
    expect(await page.evaluate(() => inProgressId), 'inProgressId harus dibersihkan').toBeNull();
    assertNoPageErrors(page);
  });

  // Klik kanan saat menggambar = batal (sama seperti ESC), BUKAN buka menu/config.
  // klinecharts 9.8.10 sebenarnya membatalkan sendiri lewat mouseRightClickEvent →
  // removeInstance, tapi onRightClick kita (index.html pra-Fase-2:3256) selalu `return true` demi
  // menjaga klik-kanan objek jadi tetap membuka modal Style — jadi pembatalannya harus
  // kita lakukan sendiri di handler contextmenu.
  test('klik kanan setelah titik pertama: batal menggambar, tanpa menu apa pun', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.35), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);

    await page.mouse.click(rect.x + Math.round(rect.width * 0.45), rect.y + Math.round(rect.height * 0.45), { button: 'right' });

    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);
    expect(await page.evaluate(() => inProgressId), 'inProgressId harus dibersihkan').toBeNull();
    await expect(page.locator('.ctxmenu'), 'menu chart tak boleh muncul').toBeHidden();
    await expect(page.locator('.dmodal-scrim.show'), 'modal Style tak boleh muncul').toHaveCount(0);
    await expect(page.locator('.objpop.show'), 'popup objek tak boleh muncul').toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('.dtool.armed:not(#magBtn)').length), 'tool harus disarm').toBe(0);
    assertNoPageErrors(page);
  });

  test('klik kanan saat tool baru di-arm (belum ada titik): ikut batal', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'rect');

    await page.mouse.click(rect.x + Math.round(rect.width * 0.4), rect.y + Math.round(rect.height * 0.5), { button: 'right' });

    await expect.poll(async () => page.evaluate(() => inProgressId), { timeout: 3000 }).toBeNull();
    expect(await overlays(page), 'tak boleh menyisakan objek').toHaveLength(0);
    await expect(page.locator('.ctxmenu')).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll('.dtool.armed:not(#magBtn)').length), 'tool harus disarm').toBe(0);
    assertNoPageErrors(page);
  });

  test('klik kanan pada objek yang SUDAH jadi tetap membuka config', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const px = await hoverableSpot(page, obj, rect);
    await page.mouse.move(rect.x + px.x, rect.y + px.y, { steps: 6 });
    await expect.poll(async () => page.evaluate(() => hoverId), { timeout: 3000 }).not.toBeNull();

    await page.mouse.click(rect.x + px.x, rect.y + px.y, { button: 'right' });

    await expect(page.locator('.dmodal-scrim.show'), 'modal Style harus terbuka').toHaveCount(1);
    expect(await overlays(page), 'objek tak boleh terhapus').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('ESC pada objek terpilih hanya men-deselect, tidak menghapus', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const px = (await toPixels(page, obj.points))[0];
    await page.mouse.move(rect.x + px.x, rect.y + px.y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('Escape');

    expect(await overlays(page), 'objek tak boleh terhapus oleh ESC').toHaveLength(1);
    expect(await page.evaluate(() => selectedId)).toBeNull();
    assertNoPageErrors(page);
  });
});
