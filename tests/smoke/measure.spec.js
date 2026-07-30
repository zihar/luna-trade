// Measure tool (ruler) — alat ukur EPHEMERAL. Test ini di smoke (gerbang PR) karena measure
// menyentuh jalur pointer chart: Shift+drag menahan pan klinecharts, jadi kalau intersepsinya
// salah yang rusak bukan cuma measure tapi pan chart itu sendiri.
//
// Angka diuji lewat API resmi di page context (measureStats/fmtMeasure), BUKAN dengan membaca
// teks canvas — canvas tak punya DOM dan OCR bukan assertion.
//
// Rancangan: docs/superpowers/specs/2026-07-31-measure-tool-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { overlays } = require('../helpers/draw');
const { chartRect, barSpaceApi } = require('../helpers/chart');

/** Arm measure lewat hotkey, lalu selesaikan 2 klik (jeda 400ms — jebakan klik canvas, tests/README.md). */
async function drawMeasure(page, rect) {
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
  await page.keyboard.press('Alt+M');
  await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
  await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.55);
  await page.waitForTimeout(400);
  await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
}

test.describe('measure: statistik & format', () => {
  test('Δprice bertanda, %, pips, bar plural, durasi', async ({ page }) => {
    await gotoApp(page);

    const out = await page.evaluate(() => {
      const a = tfData[currentTF];
      const i = a.length - 20, j = a.length - 5; // 15 bar terpisah
      const p0 = { timestamp: a[i].timestamp, value: 1.1 };
      const p1 = { timestamp: a[j].timestamp, value: 1.1012 };
      const st = measureStats(p0, p1);
      return { st, lines: fmtMeasure(st), pip: instSpec().pip };
    });

    expect(out.st.bars, '15 bar terpisah di ruang indeks').toBe(15);
    expect(out.st.dPrice).toBeCloseTo(0.0012, 10);
    expect(out.st.dPct).toBeCloseTo(0.109, 2);
    expect(out.st.dPips).toBeCloseTo(0.0012 / out.pip, 6);
    expect(out.lines[0], 'Δprice harus bertanda + saat naik').toMatch(/^\+/);
    expect(out.lines[0], 'persen ikut di baris pertama').toContain('%');
    expect(out.lines[0], 'pips ada untuk instrumen FX').toContain('pips');
    expect(out.lines[1], 'plural bars').toMatch(/^15 bars · /);
    assertNoPageErrors(page);
  });

  test('turun → tanda minus; 1 bar singular; instrumen tanpa pip → tanpa segmen pips', async ({ page }) => {
    await gotoApp(page);

    const turun = await page.evaluate(() => {
      const a = tfData[currentTF];
      const p0 = { timestamp: a[a.length - 3].timestamp, value: 1.101 };
      const p1 = { timestamp: a[a.length - 2].timestamp, value: 1.1 };
      return fmtMeasure(measureStats(p0, p1));
    });
    expect(turun[0], 'turun → minus').toMatch(/^-/);
    expect(turun[1], 'satu bar → singular').toMatch(/^1 bar · /);

    // Instrumen di luar tabel INSTRUMENT (mis. saham) → pip tak punya arti → dPips null.
    const saham = await page.evaluate(() => {
      const prev = inst;
      inst = 'STOCK:BBCA.JK';
      const a = tfData[currentTF];
      const st = measureStats(
        { timestamp: a[a.length - 3].timestamp, value: 100 },
        { timestamp: a[a.length - 2].timestamp, value: 101 }
      );
      const lines = fmtMeasure(st);
      inst = prev;
      return { dPips: st.dPips, lines };
    });
    expect(saham.dPips, 'saham tak punya pip').toBeNull();
    expect(saham.lines[0], 'baris pertama tanpa segmen pips').not.toContain('pips');
    assertNoPageErrors(page);
  });

  test('fmtDur memakai satuan Inggris', async ({ page }) => {
    await gotoApp(page);
    const d = await page.evaluate(() => [
      fmtDur(45 * 6e4), // 45m
      fmtDur(3 * 36e5 + 45 * 6e4), // 3h 45m
      fmtDur(2 * 864e5 + 4 * 36e5), // 2d 4h
    ]);
    expect(d).toEqual(['45m', '3h 45m', '2d 4h']);
    assertNoPageErrors(page);
  });
});

test.describe('measure: jalur rail & siklus hidup ephemeral', () => {
  test('Alt+M → 2 klik → measure ada; Esc membuangnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.5, { steps: 4 });
    await page.keyboard.press('Alt+M');
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('measure');

    await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.55);
    await page.waitForTimeout(400);
    await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    expect(await page.evaluate(() => measureId), 'measureId dicatat setelah objek jadi').not.toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(true);

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => measureId), 'Esc membuang measure').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);
    assertNoPageErrors(page);
  });

  test('measure tak ikut tersimpan & tak mencemari undo', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawMeasure(page, rect);
    await page.waitForTimeout(500); // lewati debounce saveDraws (350ms)

    expect(await page.evaluate(() => Object.keys(PERSIST_DRAW)), 'measure tak boleh persist').not.toContain('measure');
    expect(await page.evaluate(() => serializeDraws().some((d) => d.name === 'measure'))).toBe(false);
    expect(await page.evaluate(() => drawUndo.length), 'tak ada langkah undo kosong').toBe(0);
    assertNoPageErrors(page);
  });

  test('klik berikutnya di chart membuang measure', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawMeasure(page, rect);
    await page.waitForTimeout(400);

    await page.mouse.click(rect.x + rect.width * 0.75, rect.y + rect.height * 0.6);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => measureId), 'klik lain membuang measure').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);
    assertNoPageErrors(page);
  });

  test('ganti TF membuang measure', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawMeasure(page, rect);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => measureId)).not.toBeNull();

    await page.evaluate(() => switchTF('H1'));
    await page.waitForFunction(() => currentTF === 'H1', null, { timeout: 8000 });
    expect(await page.evaluate(() => measureId), 'ganti TF membuang measure').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);
    assertNoPageErrors(page);
  });
});

test.describe('measure: Shift+drag', () => {
  /** Posisi-x candle terakhir — berubah kalau chart ikut nge-pan. */
  const lastBarX = (page) =>
    page.evaluate(() => {
      const a = tfData[currentTF];
      let c = chart.convertToPixel(
        { timestamp: a[a.length - 1].timestamp, value: 0 },
        { paneId: 'candle_pane', absolute: true }
      );
      if (Array.isArray(c)) c = c[0];
      return c.x;
    });

  test('hidup selama menggeser, hilang saat dilepas, dan chart TIDAK nge-pan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    const bsBefore = await barSpaceApi(page);
    const xBefore = await lastBarX(page);

    await page.keyboard.down('Shift');
    await page.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.6, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.35, { steps: 8 });

    expect(await page.evaluate(() => measureId), 'measure hidup selama menggeser').not.toBeNull();
    expect(await page.evaluate(() => chart.getOverlayById(measureId).points.length), 'dua titik').toBe(2);
    // titik ke-2 mengikuti kursor: harganya harus BEDA dari titik ke-1 (kursor naik 25% tinggi chart)
    const beda = await page.evaluate(() => {
      const p = chart.getOverlayById(measureId).points;
      return Math.abs(p[1].value - p[0].value);
    });
    expect(beda, 'titik ke-2 mengikuti kursor').toBeGreaterThan(0);

    await page.mouse.up();
    await page.keyboard.up('Shift');

    expect(await page.evaluate(() => measureId), 'dilepas → hilang').toBeNull();
    expect((await overlays(page)).some((o) => o.name === 'measure')).toBe(false);

    expect(await barSpaceApi(page), 'barSpace tak berubah').toBe(bsBefore);
    expect(Math.abs((await lastBarX(page)) - xBefore), 'chart tak boleh ikut nge-pan').toBeLessThan(1);
    assertNoPageErrors(page);
  });

  test('drag TANPA Shift tetap nge-pan chart seperti biasa', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const xBefore = await lastBarX(page);

    await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(Math.abs((await lastBarX(page)) - xBefore), 'pan biasa harus tetap jalan').toBeGreaterThan(20);
    expect(await page.evaluate(() => measureId), 'drag biasa tak membuat measure').toBeNull();
    assertNoPageErrors(page);
  });
});
