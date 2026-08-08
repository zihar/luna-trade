// Sync drawings ke server — memuat, fallback, dan adopsi localStorage.
// Spec: docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { overlays } = require('../helpers/draw');

/** Satu objek tersimpan, dalam format serializeDraws (vt = wall-clock ms). */
function seedObject(ts) {
  return [{ name: 'trendline', points: [{ vt: ts - 3600000, value: 1.1 }, { vt: ts, value: 1.12 }], lock: 0, extendData: null, style: null }];
}

test.describe('draw-sync: memuat', () => {
  test('gambar dimuat DARI SERVER, bukan dari localStorage', async ({ page }) => {
    const { state } = await gotoApp(page, {
      beforeGoto: async (p) => {
        await p.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
      },
    });
    // state.drawings di-seed lewat stub: lihat helper di bawah
    expect(state.drawings, 'stub harus punya wadah drawings').toBeTruthy();

    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate((rows) => { window.__seedDrawings('EUR_USD', rows, 3); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => drawVer[inst]), 'versi server harus tercatat').toBe(3);
    assertNoPageErrors(page);
  });

  test('GET gagal → pakai localStorage, dan versi ditandai TIDAK diketahui', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => __setFailDrawings(true));   // stub membalas 500 selama flag ini menyala
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // null = "tak tahu baseVersion" → Task 4 menolak mendorong dalam keadaan ini.
    expect(await page.evaluate(() => drawVer[inst]), 'versi harus null saat GET gagal').toBeNull();
    assertNoPageErrors(page);
  });

  test('adopsi: server kosong + localStorage berisi → lokal diunggah sekali', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // Terunggah → server kini punya versi 1 untuk simbol ini.
    await expect.poll(async () => page.evaluate(() => window.__drawingsVersion(inst)), { timeout: 8000 }).toBe(1);
    assertNoPageErrors(page);
  });

  // Ronde review 1: 200 dgn bodi tak terbaca (mis. null) HARUS diperlakukan sbg gagal, bukan
  // "server kosong utk simbol ini" — kalau tidak, adopsi keliru menganggap belum ada apa2 di
  // server lalu menimpa/mengunggah tanpa dasar yang benar.
  test('GET 200 tapi bodi bukan objek → diperlakukan gagal: pakai localStorage, versi null, TANPA POST adopsi', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    const posts = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/drawings' && r.method() === 'POST') posts.push(r.url());
    });

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => __setMalformedDrawings(true));   // stub membalas 200 dgn bodi `null`
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => drawVer[inst]), 'versi harus null saat bodi 200 tak terduga').toBeNull();
    expect(posts, 'tak boleh ada POST adopsi saat bentuk respons tak diketahui').toHaveLength(0);
    assertNoPageErrors(page);
  });

  // Bug yang ditemukan review: restoreDraws() melempar (mis. TypeError akses properti d.version)
  // → suppressDrawSave nyangkut true selamanya krn baris resetnya tak pernah tercapai. Sejak fix,
  // js/load-chart.js membungkus restoreDraws() dgn try/finally.
  test('setelah bodi 200 tak terduga, suppressDrawSave tetap dilepas → simpan lokal tetap jalan', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => __setMalformedDrawings(true));
    await page.evaluate(() => loadInit(true));

    expect(await page.evaluate(() => suppressDrawSave), 'suppressDrawSave harus lepas walau load gagal-bentuk').toBe(false);
    assertNoPageErrors(page);
  });
});
