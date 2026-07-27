// Boot aplikasi dalam kondisi test yang deterministik.

const { expect } = require('@playwright/test');
const { installStubs } = require('../fixtures/api');

/**
 * Script yang dijalankan SEBELUM script halaman, di setiap dokumen baru.
 *
 * - EventSource di-stub: /api/prices adalah SSE yang tak bisa dilayani route.fulfill tanpa
 *   menutup koneksi → EventSource asli akan onerror lalu reconnect dengan backoff, bikin
 *   timer & request berulang selama test. Stub ini "selalu terhubung" dan diam, plus
 *   window.__e2e.pushTick() supaya test bisa mensimulasikan tick harga dengan sengaja.
 * - Notification di-stub: permission 'denied' → jalur notifikasi news tak memunculkan
 *   prompt OS dan tak melempar.
 */
function harnessInit() {
  const listeners = [];
  class StubEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._named = {};
      listeners.push(this);
      setTimeout(() => {
        if (this.onopen) this.onopen({});
      }, 0);
    }
    addEventListener(name, fn) {
      (this._named[name] = this._named[name] || []).push(fn);
    }
    removeEventListener(name, fn) {
      const a = this._named[name] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
    close() {
      this.readyState = 2;
      const i = listeners.indexOf(this);
      if (i >= 0) listeners.splice(i, 1);
    }
  }
  StubEventSource.CONNECTING = 0;
  StubEventSource.OPEN = 1;
  StubEventSource.CLOSED = 2;
  window.EventSource = StubEventSource;

  window.__e2e = {
    // Kirim tick ke semua EventSource yang terbuka (bentuk: {instrument,bid,ask,time}).
    pushTick(tick) {
      const data = JSON.stringify(tick);
      listeners.forEach((es) => {
        if (es.onmessage) es.onmessage({ data });
      });
    },
    ping() {
      listeners.forEach((es) => (es._named.ping || []).forEach((fn) => fn({})));
    },
  };

  // Notification: jangan pernah minta izin OS saat test.
  window.Notification = function () {};
  window.Notification.permission = 'denied';
  window.Notification.requestPermission = () => Promise.resolve('denied');

  try {
    localStorage.setItem('br_inst', 'EUR_USD');
    localStorage.setItem('br_tz', 'UTC');
    localStorage.setItem('br_cursor', 'cross');
    localStorage.setItem('br_magnet', '');
  } catch (_) {}
}

// Mode LIVE (opt-in, `LUNA_LIVE=1`): jalankan spec yang sama terhadap server Go asli + akun
// sungguhan, bukan stub. Gunanya satu hal yang tak bisa dijawab suite hermetik: memastikan sebuah
// temuan bukan artefak fixture (mis. `barSpace` fixture = 8px, jumlah bar tetap, harga sintetis).
// Bukan pengganti jalur hermetik — di sini data bergerak, jadi hasilnya tak deterministik.
//
// Pakai: PORT=8765 ./luna-trade  lalu
//        LUNA_LIVE=1 npx playwright test <spec> --project=live
// Kredensial dari LUNA_TEST_EMAIL / LUNA_TEST_PASSWORD (default = akun test lokal).
const LIVE = !!process.env.LUNA_LIVE;

/** Login lewat API supaya cookie sesi sudah ada sebelum halaman dibuka (context yg sama). */
async function loginLive(page) {
  const email = process.env.LUNA_TEST_EMAIL || 'test@luna.local';
  const password = process.env.LUNA_TEST_PASSWORD || 'LunaTest123!';
  const res = await page.request.post('/api/auth/login', { data: { email, password } });
  expect(
    res.ok(),
    `LUNA_LIVE: login sebagai ${email} gagal (${res.status()}) — pastikan "PORT=8765 ./luna-trade" jalan & akun test ada`
  ).toBe(true);
}

/**
 * Pasang stub + init script, buka halaman, tunggu chart benar-benar siap.
 * Mengembalikan { state } — state server palsu (lihat fixtures/api.js); null di mode LIVE.
 *
 * `opts.beforeGoto(page)` dipanggil SESUDAH stub default terpasang tapi SEBELUM navigasi.
 * Di situlah tempat memasang `page.route` yang harus MENANG atas stub default: Playwright
 * memeriksa handler dalam urutan terbalik pendaftaran, jadi route apa pun yang didaftarkan
 * sebelum `gotoApp` justru tak akan pernah terpakai (`**\/api\/**` dari installStubs menelannya).
 */
async function gotoApp(page, opts = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.__e2eErrors = errors;

  // harnessInit tetap dipasang di mode LIVE: stub EventSource menahan badai reconnect SSE dan
  // stub Notification menahan prompt OS. Keduanya tak menyentuh /api/candles, jadi candle yang
  // dipakai chart tetap data OANDA sungguhan lewat token di .env.
  await page.addInitScript(harnessInit);
  const state = LIVE ? null : await installStubs(page);
  if (LIVE) await loginLive(page);
  if (opts.beforeGoto) await opts.beforeGoto(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Chart siap = data termuat, cursor waktu terisi, bookkeeping drawing ada.
  // `chart`/`T`/`drawIds` adalah `const`/`let` top-level di classic script → ada di global
  // lexical scope (BUKAN properti window), jadi diakses sebagai identifier polos.
  // loadInit() menunggu font sumbu dulu (index.html:1723) → timeout longgar.
  await page.waitForFunction(
    () =>
      typeof chart !== 'undefined' &&
      chart.getDataList &&
      chart.getDataList().length > 0 &&
      typeof drawIds !== 'undefined' &&
      typeof T !== 'undefined' &&
      T !== null,
    null,
    { timeout: 20000 }
  );

  // Satu frame tenang setelah render pertama (resize observer + font swap).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  if (!opts.allowErrors) assertNoPageErrors(page);
  return { state, errors };
}

/** Gagalkan test bila ada error JS tak tertangkap di halaman. */
function assertNoPageErrors(page) {
  const errs = page.__e2eErrors || [];
  expect(errs, 'error JS di halaman').toEqual([]);
}

module.exports = { gotoApp, assertNoPageErrors, harnessInit };
