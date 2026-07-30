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
