// Gerbang auth, cabang TAK-AUTHED — satu-satunya jalur boot yang tak pernah dieksekusi suite
// lain. Semua test menstub `/api/auth/me` → 200 (`tests/fixtures/api.js`), jadi
// `showAuthOverlay()` tak pernah dipanggil sekali pun; `tests/drawing/00-harness.spec.js`
// justru memastikan overlaynya ABSEN. Artinya seluruh isi `js/auth-overlay.js` bisa rusak dan
// suite tetap hijau.
//
// Kenapa baru sekarang: sebelum JS dipecah, throw di wilayah ini membatalkan sisa script → gagal
// keras dan tertangkap guard `pageerror` di test mana pun. Setelah dipecah jadi `<script src>`
// terpisah, kegagalan satu file TIDAK menghentikan file berikutnya — jalurnya jadi bisa mati
// senyap, jadi ia butuh testnya sendiri.
//
// `gotoApp()` tak bisa dipakai di sini: 401 berarti `bootApp()` tak dipanggil → chart tak pernah
// punya data → `waitForFunction` di `tests/helpers/app.js` timeout. Stub + navigasi dipasang manual.

const { test, expect } = require('@playwright/test');
const { installStubs } = require('../fixtures/api');
const { harnessInit } = require('../helpers/app');

const UNAUTHORIZED = {
  status: 401,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ error: 'unauthorized' }),
};

/**
 * Buka aplikasi dalam keadaan tak-authed. Mengembalikan pengait untuk membalik keadaan itu
 * (`authed()`), daftar error JS, dan daftar path `/api` yang benar-benar diminta halaman.
 */
async function gotoUnauthed(page) {
  const errors = [];
  const apiCalls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/')) apiCalls.push(p);
  });

  await page.addInitScript(harnessInit);
  await installStubs(page);

  // Didaftarkan SESUDAH installStubs supaya MENANG: Playwright memeriksa handler dalam urutan
  // terbalik pendaftaran, jadi `**/api/**` dari installStubs kalah di sini (lihat catatan
  // `opts.beforeGoto` di tests/helpers/app.js).
  let isAuthed = false;
  await page.route('**/api/auth/me', (route) =>
    isAuthed ? route.fallback() : route.fulfill(UNAUTHORIZED)
  );
  // Login sukses: stub sendiri karena installStubs membalas 501 untuk path tak dikenal.
  await page.route('**/api/auth/login', (route) => {
    isAuthed = true;
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: '{"ok":true}' });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  return { errors, apiCalls, authed: () => isAuthed };
}

test('auth gate: /api/auth/me 401 → overlay login tampil & tak ada error JS', async ({ page }) => {
  const { errors } = await gotoUnauthed(page);

  const ov = page.locator('#authOverlay');
  await expect(ov, 'overlay login tak dibuat padahal sesi 401').toHaveCount(1);
  await expect(ov).toBeVisible();

  // Bentuk minimal yang membuat overlay berguna — kalau salah satunya hilang, pengguna tak
  // punya jalan masuk sama sekali.
  await expect(page.locator('#authForm #authEmail')).toBeVisible();
  await expect(page.locator('#authForm #authPass')).toBeVisible();
  await expect(page.locator('#authSubmit')).toBeVisible();
  // Tab Daftar mengubah form jadi mode register (tombol Google tetap tersembunyi: stub
  // /api/auth/config membalas {google:false}).
  await page.locator('.auth-tab[data-mode="register"]').click();
  await expect(page.locator('#authForm .auth-name')).toBeVisible();
  await expect(page.locator('#authSubmit')).toHaveText('Daftar');
  await expect(page.locator('#googleWrap')).toBeHidden();

  expect(errors, 'error JS di halaman pada jalur tak-authed').toEqual([]);
});

test('auth gate: 401 tak menjalankan bootApp — nol permintaan data server', async ({ page }) => {
  const { apiCalls, errors } = await gotoUnauthed(page);
  await expect(page.locator('#authOverlay')).toHaveCount(1);

  // Inti gerbangnya: tanpa sesi valid, TAK ADA satu pun panggilan data. Kalau salah satu muncul,
  // berarti bootApp() (atau bagiannya) lolos ke halaman tak-authed.
  const forbidden = ['/api/candles', '/api/account', '/api/positions', '/api/journal', '/api/alerts'];
  expect(
    apiCalls.filter((p) => forbidden.includes(p)),
    'ada permintaan data server padahal sesi 401 → gerbang authGate tak menahan bootApp'
  ).toEqual([]);

  expect(errors).toEqual([]);
});

test('auth gate: login sukses → reload → bootApp jalan & overlay hilang', async ({ page }) => {
  const { errors } = await gotoUnauthed(page);
  await expect(page.locator('#authOverlay')).toHaveCount(1);

  await page.locator('#authEmail').fill('e2e@luna.local');
  await page.locator('#authPass').fill('LunaTest123!');
  // Submit → POST /api/auth/login → location.reload() (js/auth-overlay.js), dan `/api/auth/me`
  // kini membalas 200 lewat stub default → cabang authed: onAuthed() + bootApp().
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#authSubmit').click()]);

  // Chart benar-benar boot = data termuat (identifier polos: classic script, bukan properti window).
  await page.waitForFunction(
    () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0,
    null,
    { timeout: 20000 }
  );
  await expect(page.locator('#authOverlay'), 'overlay masih ada setelah login sukses').toHaveCount(0);

  expect(errors, 'error JS saat transisi tak-authed → authed').toEqual([]);
});
