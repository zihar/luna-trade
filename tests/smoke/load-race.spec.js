// Ganti TF / instrumen SELAGI loadInit masih memuat. Produksi 2026-11-25 (XAU_USD): switchTF di tengah
// muat memakai cursor T milik instrumen LAMA → TF baru diminta dgn `to` = cursor lama (bisa di masa
// depan → OANDA "Time is in the future"; kalau tidak, datanya terpotong di waktu instrumen lama), dan
// loadInit lalu menyimpan candle TF lama ke slot TF baru.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

const delayCandles = async (page, ms, onReq) =>
  page.route('**/api/candles**', async (route) => {
    if (onReq) onReq(route.request().url());
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });

test('ganti TF saat loadInit memuat → TF baru dimuat tanpa cursor lama', async ({ page }) => {
  await gotoApp(page);
  const urls = [];
  await delayCandles(page, 600, (u) => urls.push(u));
  const r = await page.evaluate(async () => {
    const tf2 = currentTF === 'H1' ? 'M15' : 'H1';
    const done = loadInit(true);
    await new Promise((res) => setTimeout(res, 100));   // fetch loadInit sedang berjalan
    await switchTF(tf2);
    await done;
    const a = tfData[tf2] || [];
    return { tf2, gran: GRAN[tf2] || tf2, cur: currentTF, n: a.length, tOk: T === cursorAtNewest(tf2, a) };
  });
  expect(urls.filter((u) => new URL(u).searchParams.get('to')), 'tak boleh ada `to` dari cursor lama').toEqual([]);
  expect(r.cur).toBe(r.tf2);
  expect(r.n).toBeGreaterThan(0);
  // Fixture hermetik = candle M15 utk semua TF → bukti TF baru dimuat = permintaannya, bukan jarak bar.
  expect(urls.some((u) => new URL(u).searchParams.get('granularity') === r.gran), 'TF baru diminta').toBe(true);
  expect(r.tOk).toBe(true);
  assertNoPageErrors(page);
});

test('dua loadInit beruntun → hasil yang lebih lama tak menimpa yang terbaru', async ({ page }) => {
  await gotoApp(page);
  const last = await page.evaluate(async () => {
    // muat PERTAMA dibuat lambat + bertanda (close=12345); muat kedua normal
    const of = window.fetch; let hit = 0;
    window.fetch = async (u, ...rest) => {
      const r = await of(u, ...rest);
      if (!String(u).includes('/api/candles') || ++hit !== 1) return r;
      const j = await r.json();
      j.candles.forEach((c) => { c.mid.c = '12345'; });
      await new Promise((res) => setTimeout(res, 900));
      return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const a = loadInit(true);
    await new Promise((r) => setTimeout(r, 100));
    const b = loadInit(true);
    await Promise.all([a, b]);
    window.fetch = of;
    const arr = tfData[currentTF];
    return arr[arr.length - 1].close;
  });
  expect(last).not.toBe(12345);
  assertNoPageErrors(page);
});
