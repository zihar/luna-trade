// `toast()` — umpan balik ringan yang dipakai tujuh modul (alert berbunyi, pending tereksekusi,
// order gagal, dst), tapi sampai sekarang TAK diuji satu test pun.
//
// Ia baru saja dipindah keluar dari `js/watchlist.js` ke modulnya sendiri. Pemindahan itu aman
// karena tak ada pemanggil eager (dicek lewat AST), tapi "aman menurut analisis" bukan alasan untuk
// membiarkan fungsi sepenting ini tanpa jaring: kalau `js/toast.js` gagal dimuat, tujuh jalur
// umpan balik mati diam-diam — tak ada error, dan tak ada test lain yang peduli.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('toast: tampil dengan pesan & kelas varian, lalu bisa ditutup', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => toast('Order terkirim', 'success'));
  const el = page.locator('#toast');
  await expect(el, 'toast tak muncul').toHaveClass(/\bshow\b/);
  await expect(el).toHaveClass(/\bt-success\b/);
  await expect(el.locator('.toast-msg')).toHaveText('Order terkirim');

  // Varian dipetakan, termasuk alias 'warning' → 'warn' (dipakai pemanggil lama).
  await page.evaluate(() => toast('Hati-hati', 'warning'));
  await expect(el).toHaveClass(/\bt-warn\b/);
  await page.evaluate(() => toast('Gagal', 'error'));
  await expect(el).toHaveClass(/\bt-error\b/);
  await page.evaluate(() => toast('Sekadar info'));
  await expect(el, 'tanpa type harus jatuh ke info').toHaveClass(/\bt-info\b/);

  // Tombol tutup memaksa hilang tanpa menunggu timer.
  await el.locator('.toast-close').click();
  await expect(el, 'tombol tutup tak menyembunyikan toast').not.toHaveClass(/\bshow\b/);

  assertNoPageErrors(page);
});
