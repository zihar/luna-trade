// /api/candles saat penyedia data (OANDA) gangguan. Produksi 2026-11-18: pengguna melihat
// "Failed to load: Unexpected token 'e', "error code: 504" is not valid JSON" karena body teks
// mentah upstream di-parse sbg JSON tanpa cek status.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('504 sekali → dicoba ulang otomatis dan berhasil', async ({ page }) => {
  await gotoApp(page);
  let hits = 0;
  await page.route('**/api/candles**', async (route) => {
    hits++;
    if (hits === 1) return route.fulfill({ status: 504, contentType: 'text/plain', body: 'error code: 504' });
    await route.fallback();
  });
  const n = await page.evaluate(async () => (await fetchCandles(currentTF, { count: 50 })).length);
  expect(hits, 'harus ada satu percobaan ulang').toBe(2);
  expect(n).toBeGreaterThan(0);
  assertNoPageErrors(page);
});

test('504 terus-menerus → pesan Inggris yang ramah, bukan error parse JSON', async ({ page }) => {
  await gotoApp(page);
  await page.route('**/api/candles**', (route) =>
    route.fulfill({ status: 504, contentType: 'text/plain', body: 'error code: 504' }));
  const msg = await page.evaluate(async () => {
    try { await fetchCandles(currentTF, { count: 50 }); return 'no error'; } catch (e) { return e.message; }
  });
  expect(msg).not.toMatch(/JSON|token/i);
  expect(msg).toMatch(/temporarily unavailable/i);
  assertNoPageErrors(page);
});

test('4xx → pesan dari server diteruskan, TANPA percobaan ulang', async ({ page }) => {
  await gotoApp(page);
  let hits = 0;
  await page.route('**/api/candles**', (route) => {
    hits++;
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errorMessage: 'Invalid instrument' }) });
  });
  const msg = await page.evaluate(async () => {
    try { await fetchCandles(currentTF, { count: 50 }); return 'no error'; } catch (e) { return e.message; }
  });
  expect(msg).toBe('Invalid instrument');
  expect(hits).toBe(1);
  assertNoPageErrors(page);
});
