// Tab Coordinates di modal objek gambar — harga + NOMOR BAR per titik, seperti TradingView
// ("placement of the trendline's first point (Price 1) using a bar number and price",
// tradingview.com/support/solutions/43000518095-trend-line/).
//
// Yang diuji, sesuai TOOL_SPEC.coords:
//   'points' → Price+Bar per titik   'price' → harga saja   'bar' → nomor bar saja
//   'hray'   → satu harga + 2 nomor bar                     'box'  → 2 sudut dari 8 titik
//   null     → tak punya tab Coordinates
// Rancangan: docs/superpowers/specs/2026-08-10-coordinates-tab-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays, hoverableSpot } = require('../helpers/draw');
const { TOOL_SPEC } = require('../helpers/spec');

async function openCoords(page, obj, rect) {
  const spot = await hoverableSpot(page, obj, rect);
  expect(spot, `objek ${obj.name} tak bisa di-hover di titik mana pun`).toBeTruthy();
  await page.mouse.dblclick(rect.x + spot.x, rect.y + spot.y);
  const modal = page.locator('.dmodal-scrim.show');
  await expect(modal).toBeVisible();
  await modal.locator('.dm-tab[data-tab="coords"]').click();
  await expect(modal.locator('.dm-pane[data-pane="coords"]')).toBeVisible();
  return modal;
}

/** Field yang HARUS ada untuk sebuah bentuk (data-cf, urut). */
function expectedFields(spec) {
  switch (spec.coords) {
    case 'price': return ['p0'];
    case 'bar': return ['b0'];
    case 'hray': return ['p0', 'b0', 'b1'];
    case 'box': return ['p0', 'b0', 'p1', 'b1'];
    case 'points': {
      const out = [];
      for (let i = 0; i < spec.pointsAfter; i++) out.push('p' + i, 'b' + i);
      return out;
    }
    default: return [];
  }
}

/** Isi satu field lalu commit dengan Enter. */
async function setField(modal, cf, value) {
  const inp = modal.locator(`.dm-pane[data-pane="coords"] input[data-cf="${cf}"]`);
  await inp.fill(String(value));
  await inp.press('Enter');
  return inp;
}

test.describe('tab Coordinates: bentuk field per objek', () => {
  for (const spec of TOOL_SPEC.filter((t) => t.settings === 'modal')) {
    test(`${spec.name}: field ${spec.coords || '(tak ada tab)'}`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      expect(obj, 'objek harus terbentuk lebih dulu').toBeTruthy();

      const spot = await hoverableSpot(page, obj, rect);
      await page.mouse.dblclick(rect.x + spot.x, rect.y + spot.y);
      const modal = page.locator('.dmodal-scrim.show');
      await expect(modal).toBeVisible();

      const want = expectedFields(spec);
      expect(
        await modal.locator('.dm-tab[data-tab="coords"]').count(),
        'keberadaan tab Coordinates',
      ).toBe(want.length ? 1 : 0);
      if (!want.length) { assertNoPageErrors(page); return; }

      await modal.locator('.dm-tab[data-tab="coords"]').click();
      const got = await modal.locator('.dm-pane[data-pane="coords"] input[data-cf]').evaluateAll(
        (els) => els.map((e) => e.dataset.cf),
      );
      expect(got, `field tab Coordinates untuk ${spec.name}`).toEqual(want);

      // Setiap field harus terisi angka yang bisa dibaca ulang — bukan kosong / NaN.
      const vals = await modal.locator('.dm-pane[data-pane="coords"] input[data-cf]').evaluateAll(
        (els) => els.map((e) => e.value),
      );
      for (const v of vals) expect(Number.isFinite(parseFloat(v)), `nilai field "${v}"`).toBe(true);

      assertNoPageErrors(page);
    });
  }
});

test.describe('tab Coordinates: menulis balik ke objek', () => {
  test('trendline: ubah harga → titik pindah ke harga itu', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const target = +(before.points[0].value * 1.001).toFixed(5);
    await setField(modal, 'p0', target);

    const after = (await overlays(page))[0];
    expect(after.points[0].value).toBeCloseTo(target, 5);
    // Titik lain tak boleh ikut bergerak — hanya field yang diedit yang ditulis.
    expect(after.points[1].value).toBeCloseTo(before.points[1].value, 6);
    assertNoPageErrors(page);
  });

  test('trendline: ubah nomor bar → titik bergeser di sumbu X', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const barBefore = await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id);
    await setField(modal, 'b0', +(barBefore - 5).toFixed(2));

    const barAfter = await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id);
    expect(barAfter).toBeCloseTo(barBefore - 5, 1);
    assertNoPageErrors(page);
  });

  test('trendline: pecahan nomor bar dipertahankan (presisi sub-bar)', async ({ page }) => {
    // Membulatkan ke integer akan menggeser objek sub-bar hingga ½ lebar bar — persis regresi
    // yang diperbaiki di PR #24. Dijaga di sini supaya tak kembali diam-diam.
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const base = Math.floor(await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id));
    await setField(modal, 'b0', base + 0.37);

    const after = await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id);
    expect(after).toBeCloseTo(base + 0.37, 2);
    assertNoPageErrors(page);
  });

  test('koma diterima sebagai pemisah desimal', async ({ page }) => {
    // Field-nya type=text justru KARENA type=number dilokalkan Chrome (di locale koma-desimal
    // nilainya tampil "1,08900" dan "1.09" ditolak diam-diam). Parser sendiri menerima keduanya.
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const target = +(before.points[0].value * 1.001).toFixed(5);
    await setField(modal, 'p0', String(target).replace('.', ','));

    expect((await overlays(page))[0].points[0].value).toBeCloseTo(target, 5);
    assertNoPageErrors(page);
  });

  test('input tak valid: nilai kembali & objek diam', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const inp = modal.locator('.dm-pane[data-pane="coords"] input[data-cf="p0"]');
    const shown = await inp.inputValue();
    await inp.fill('');
    await inp.press('Enter');

    await expect(inp).toHaveClass(/bad/);
    expect(await inp.inputValue(), 'nilai lama harus dikembalikan').toBe(shown);
    const after = (await overlays(page))[0];
    expect(after.points[0].value).toBeCloseTo(before.points[0].value, 6);
    assertNoPageErrors(page);
  });

  test('rect: ubah harga sudut → tetap 8 titik & tetap persegi', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'rect');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const top = before.points[0].value;
    const target = +(top * 1.002).toFixed(5);
    await setField(modal, 'p0', target);

    const after = (await overlays(page))[0];
    expect(after.points.length, 'invarian 8 titik').toBe(8);
    // Sisi atas = titik 0,1,2 sejajar; sisi bawah = titik 4,5,6 sejajar (urutan writeBox).
    expect(after.points[1].value).toBeCloseTo(after.points[0].value, 6);
    expect(after.points[2].value).toBeCloseTo(after.points[0].value, 6);
    expect(after.points[5].value).toBeCloseTo(after.points[6].value, 6);
    expect(Math.max(after.points[0].value, after.points[6].value)).toBeCloseTo(target, 5);
    assertNoPageErrors(page);
  });

  test('horizontalRayLine: satu harga menggerakkan KEDUA titik', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'horizontalRayLine');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const target = +(before.points[0].value * 1.001).toFixed(5);
    await setField(modal, 'p0', target);

    const after = (await overlays(page))[0];
    expect(after.points[0].value).toBeCloseTo(target, 5);
    expect(after.points[1].value, 'garis harus tetap horizontal').toBeCloseTo(target, 5);
    assertNoPageErrors(page);
  });

  test('stepper: klik ▲ menaikkan satu digit terakhir, Shift = 10×', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);
    const dec = await page.evaluate(() => priceDecimals());
    const step = Math.pow(10, -dec);

    // Stepper melangkah dari nilai yang DITAMPILKAN (sudah dibulatkan ke digit terakhir), jadi
    // langkah pertama sekaligus merapikan harga hasil gambar-bebas ke grid tick. Kalau ia
    // melangkah dari nilai mentah, isi field & nilai objek akan berbeda satu pembulatan.
    const shown = +(await overlays(page))[0].points[0].value.toFixed(dec);
    await modal.locator('.dm-pane[data-pane="coords"] .dm-co-st[data-cf="p0"][data-dir="1"]').click();
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(shown + step, dec + 1);

    await modal.locator('.dm-pane[data-pane="coords"] .dm-co-st[data-cf="p0"][data-dir="-1"]').click({ modifiers: ['Shift'] });
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(shown + step - step * 10, dec + 1);
    assertNoPageErrors(page);
  });

  test('stepper: ↑/↓ di field melangkah sama seperti tombol', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);
    const dec = await page.evaluate(() => priceDecimals());
    const step = Math.pow(10, -dec);

    const shown = +(await overlays(page))[0].points[0].value.toFixed(dec);   // stepper bekerja di grid tick
    const inp = modal.locator('.dm-pane[data-pane="coords"] input[data-cf="p0"]');
    await inp.focus();
    await inp.press('ArrowUp');
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(shown + step, dec + 1);
    await inp.press('Shift+ArrowDown');
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(shown + step - step * 10, dec + 1);
    // Field ikut menampilkan nilai baru, bukan hanya objeknya.
    expect(parseFloat(await inp.inputValue())).toBeCloseTo(shown + step - step * 10, dec + 1);
    assertNoPageErrors(page);
  });

  test('stepper nomor bar: satu bar per langkah, pecahan sub-bar terbawa', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    // Mulai dari pecahan yang jelas supaya "terbawa" benar-benar teruji.
    const base = Math.floor(await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id));
    await setField(modal, 'b0', base + 0.25);
    await modal.locator('.dm-pane[data-pane="coords"] .dm-co-st[data-cf="b0"][data-dir="1"]').click();

    const after = await page.evaluate((id) => fidxOf(chart.getOverlayById(id).points[0]), obj.id);
    expect(after).toBeCloseTo(base + 1.25, 2);
    assertNoPageErrors(page);
  });

  test('stepper tetap jalan walau field berisi ketikan tak valid', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);
    const dec = await page.evaluate(() => priceDecimals());
    const step = Math.pow(10, -dec);

    const shown = +(await overlays(page))[0].points[0].value.toFixed(dec);
    const inp = modal.locator('.dm-pane[data-pane="coords"] input[data-cf="p0"]');
    await inp.fill('abc');
    await modal.locator('.dm-pane[data-pane="coords"] .dm-co-st[data-cf="p0"][data-dir="1"]').click();
    // Melangkah dari nilai objek yang sekarang, bukan dari teks sampah.
    expect((await overlays(page))[0].points[0].value).toBeCloseTo(shown + step, dec + 1);
    assertNoPageErrors(page);
  });

  test('objek terkunci: field koordinat mati', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const spot = await hoverableSpot(page, obj, rect);
    await page.mouse.dblclick(rect.x + spot.x, rect.y + spot.y);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal).toBeVisible();
    await modal.locator('.dm-lock').click();
    await modal.locator('.dm-tab[data-tab="coords"]').click();

    const inputs = modal.locator('.dm-pane[data-pane="coords"] input[data-cf]');
    const n = await inputs.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(inputs.nth(i)).toBeDisabled();
    // Tombol ▲▼ ikut mati — kalau tidak, objek terkunci masih bisa digeser lewat stepper.
    const steppers = modal.locator('.dm-pane[data-pane="coords"] button.dm-co-st');
    const m = await steppers.count();
    expect(m).toBe(n * 2);
    for (let i = 0; i < m; i++) await expect(steppers.nth(i)).toBeDisabled();
    assertNoPageErrors(page);
  });

  test('edit koordinat bertahan setelah reload (ikut jalur simpan)', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await drawTool(page, 'trendline');
    const modal = await openCoords(page, obj, rect);

    const before = (await overlays(page))[0];
    const target = +(before.points[0].value * 1.003).toFixed(5);
    await setField(modal, 'p0', target);
    await modal.locator('.dm-close').click();

    await page.waitForTimeout(600);   // debounce saveDraws 350ms
    await page.reload();              // gotoApp lagi = exposeFunction dobel → reload biasa
    await page.waitForFunction(() => typeof drawIds !== 'undefined' && drawIds.length === 1, null, { timeout: 8000 });
    const restored = (await overlays(page))[0];
    expect(restored, 'objek harus kembali setelah reload').toBeTruthy();
    const values = restored.points.map((p) => p.value);
    expect(Math.min(...values.map((v) => Math.abs(v - target)))).toBeLessThan(Math.abs(target) * 1e-4);
    assertNoPageErrors(page);
  });
});
