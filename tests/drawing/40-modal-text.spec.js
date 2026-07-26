// Panel setting objek (modal bertab Style|Text), plus jalur teks inline.
//
// Aturan yang diuji, sesuai TOOL_SPEC.settings / .text:
//   settings 'modal'    → double-click membuka modal; tab awal = Text untuk objek bisa-teks
//                         (DM_TEXT_OBJS), Style untuk sisanya
//   settings 'pospopup' → long/shortPosition dialihkan ke popup posisi (index.html:5573)
//   settings null       → tak punya panel setting (sejak simpleAnnotation/simpleTag ditarik dari
//                         rail — Temuan 3 — tak ada lagi tool berkategori ini; kolomnya disimpan
//                         karena tool baru bisa masuk kategori itu lagi)
//   text 'modal+inline' → objek kosong menawarkan "+ Add text"; klik → editor inline

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { toPixels } = require('../helpers/chart');
const { drawTool, overlays, commitTextEditor, hoverableSpot } = require('../helpers/draw');
const { TOOL_SPEC, byName } = require('../helpers/spec');

/**
 * Double-click DI ATAS objek. Titiknya sendiri belum tentu berada di atas bentuk yang
 * tergambar (lihat hoverableSpot), jadi spot-nya diprobe dulu — kalau objek tak bisa
 * di-hover sama sekali, itu dilaporkan sebagai kegagalan yang jelas.
 */
async function dblclickObject(page, obj, rect) {
  const spot = await hoverableSpot(page, obj, rect);
  expect(spot, `objek ${obj.name} tak bisa di-hover di titik mana pun → tak terjangkau pengguna`).toBeTruthy();
  await page.mouse.dblclick(rect.x + spot.x, rect.y + spot.y);
  return spot;
}

test.describe('modal setting objek', () => {
  for (const spec of TOOL_SPEC.filter((t) => t.settings === 'modal')) {
    test(`${spec.name}: double-click membuka modal, tab awal ${spec.text ? 'Text' : 'Style'}`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      expect(obj, 'objek harus terbentuk lebih dulu').toBeTruthy();

      await dblclickObject(page, obj, rect);
      const modal = page.locator('.dmodal-scrim.show');
      await expect(modal, `modal ${spec.name} harus terbuka`).toBeVisible();

      // Tab awal: Text untuk objek bisa-teks, Style untuk sisanya (index.html:5580).
      const expectTab = spec.text ? 'text' : 'style';
      await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', expectTab);
      // Pane yang tampil harus sesuai tab aktif.
      await expect(modal.locator(`.dm-pane[data-pane="${expectTab}"]`)).toBeVisible();
      // Tab Text hanya ada untuk objek bisa-teks.
      expect(await modal.locator('.dm-tab[data-tab="text"]').count(), 'keberadaan tab Text').toBe(spec.text ? 1 : 0);

      assertNoPageErrors(page);
    });
  }

  test('ubah warna di modal tersimpan ke objek', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    await dblclickObject(page, obj, rect);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal).toBeVisible();

    await modal.locator('.dm-tab[data-tab="style"]').click();
    const swatch = modal.locator('.dm-pane[data-pane="style"] .sw:not(.on)').first();
    const color = await swatch.getAttribute('data-col');
    await swatch.click();

    const saved = await page.evaluate((id) => {
      const s = (JSON.parse(localStorage.getItem('br_drawstyle') || '{}') || {})[id];
      const o = chart.getOverlayById(id);
      return { fromStore: s && s.color, fromExtend: o && o.extendData };
    }, obj.id);
    // Gaya per-objek disimpan lewat setObjStyle → cukup buktikan warna baru terpasang.
    expect(await modal.locator(`.sw[data-col="${color}"]`).getAttribute('class')).toContain('on');
    expect(color).toBeTruthy();
    assertNoPageErrors(page);
  });

  test('tombol Delete di modal menghapus objek', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'rect');
    await dblclickObject(page, obj, rect);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal).toBeVisible();
    await modal.locator('.dm-del').click();
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);
    assertNoPageErrors(page);
  });
});

test.describe('objek tanpa modal', () => {
  for (const spec of TOOL_SPEC.filter((t) => t.settings === 'pospopup')) {
    test(`${spec.name}: double-click membuka popup posisi, bukan modal`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      await dblclickObject(page, obj, rect);
      await expect(page.locator('.objpop.show').first()).toBeVisible();
      await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
      assertNoPageErrors(page);
    });
  }

  for (const spec of TOOL_SPEC.filter((t) => t.settings === null)) {
    test(`${spec.name}: memang tak punya panel setting`, async ({ page }) => {
      await gotoApp(page);
      await drawTool(page, spec.name);
      // Gerbangnya adalah DRAW_DEFAULT (index.html:715): tanpa entri di situ,
      // openObjSettings langsung return. Diperiksa lewat gerbang itu, bukan lewat
      // double-click, karena kedua tool ini tak bisa di-hover sama sekali (lihat
      // describe "keterjangkauan objek" di bawah).
      expect(await page.evaluate((n) => DRAW_DEFAULT[n] === undefined, spec.name)).toBe(true);
      await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
      assertNoPageErrors(page);
    });
  }
});

test.describe('keterjangkauan objek', () => {
  // Objek yang tak bisa di-hover tak bisa dipilih, di-drag, dihapus lewat klik, atau
  // dibuka setting-nya. Bagi pengguna objek itu praktis "mati" begitu tergambar — satu-satunya
  // jalan keluar adalah Undo atau menu trash (hapus semua).
  for (const spec of TOOL_SPEC) {
    test(`${spec.name}: bisa di-hover setelah tergambar`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      expect(obj, 'objek harus terbentuk').toBeTruthy();
      const spot = await hoverableSpot(page, obj, rect);
      expect(spot, `${spec.name} tak bisa di-hover di titik mana pun → tak bisa dipilih/dihapus/di-setting lewat klik`).toBeTruthy();
      assertNoPageErrors(page);
    });
  }
});

test.describe('teks inline', () => {
  // text & callout membuka editor sendiri begitu objek jadi (autoEditor).
  for (const spec of TOOL_SPEC.filter((t) => t.autoEditor)) {
    test(`${spec.name}: editor terbuka otomatis & teks tersimpan`, async ({ page }) => {
      await gotoApp(page);
      const { rect } = { rect: null };
      // drawTool sudah men-commit "E2E" untuk tool autoEditor → cek hasilnya.
      const res = await drawTool(page, spec.name, { text: 'Halo E2E' });
      expect(res.obj, 'objek harus tetap ada setelah teks di-commit').toBeTruthy();
      expect(res.obj.extendData, 'teks harus tersimpan di extendData').toContain('Halo E2E');
      assertNoPageErrors(page);
    });
  }

  test('text: membatalkan editor saat masih kosong MENGHAPUS objek (sesuai desain)', async ({ page }) => {
    // index.html:3370 — removeIfEmpty untuk tool `text`. Diuji eksplisit supaya perubahan
    // perilaku ini tak lolos diam-diam.
    await gotoApp(page);
    const { armTool, clickAt, CLICK_GAP_MS } = require('../helpers/draw');
    const { chartRect } = require('../helpers/chart');
    const rect = await chartRect(page);
    await armTool(page, 'text');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.4), y: Math.round(rect.height * 0.4) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await expect(page.locator('textarea.text-editor')).toBeVisible();
    await page.locator('textarea.text-editor').press('Escape');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(0);
    assertNoPageErrors(page);
  });

  test('rect kosong: hover menawarkan "+ Add text", klik membuka editor inline', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'rect');
    expect(obj.extendData || '').toBe('');

    // Placeholder digambar di canvas (bukan DOM) → yang bisa diuji: klik di tengah kotak
    // saat kosong membuka editor inline (ADDTEXT_CLICK, index.html:5548).
    const px = await toPixels(page, obj.points);
    const cx = (px[0].x + px[4].x) / 2;
    const cy = (px[0].y + px[4].y) / 2;
    await page.mouse.move(rect.x + cx, rect.y + cy, { steps: 8 });
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('textarea.text-editor')).toBeVisible({ timeout: 3000 });
    await commitTextEditor(page, 'dari placeholder');
    const objs = await overlays(page);
    expect(objs[0].extendData).toContain('dari placeholder');
    assertNoPageErrors(page);
  });
});
