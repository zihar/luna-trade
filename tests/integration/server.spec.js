// @integration — BUTUH server Go asli, tidak dijalankan secara default.
//
// Jalankan:
//   PORT=8765 ./luna-trade          (butuh .env: OANDA_TOKEN)
//   npm run test:integration
//
// Gunanya satu: menjaga stub di tests/fixtures/api.js tak melenceng dari respons server
// sungguhan. Kalau bentuk respons berubah di backend, suite hermetik bisa tetap hijau
// sementara aplikasi nyata rusak — spec inilah yang menangkap itu.

const { test, expect } = require('@playwright/test');

const EMAIL = process.env.LUNA_TEST_EMAIL || 'test@luna.local';
const PASSWORD = process.env.LUNA_TEST_PASSWORD || 'LunaTest123!';

test.describe('@integration server asli', () => {
  test('login + bentuk respons /api/* cocok dengan yang distub', async ({ request, baseURL }) => {
    const login = await request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
    expect(login.ok(), `login gagal di ${baseURL} — pastikan server jalan & akun test ada`).toBe(true);

    const me = await (await request.get('/api/auth/me')).json();
    expect(Object.keys(me).sort(), 'field /api/auth/me').toEqual(['email', 'is_admin', 'name', 'picture'].sort());

    const cfg = await (await request.get('/api/auth/config')).json();
    expect(cfg).toHaveProperty('google');

    const candles = await (await request.get('/api/candles?instrument=EUR_USD&granularity=M15&count=5')).json();
    expect(Array.isArray(candles.candles), '/api/candles harus punya array candles').toBe(true);
    const c = candles.candles[0];
    expect(c, 'bentuk candle').toHaveProperty('time');
    expect(c, 'bentuk candle').toHaveProperty('complete');
    expect(c.mid, 'candle.mid harus OHLC').toEqual(expect.objectContaining({ o: expect.anything(), h: expect.anything(), l: expect.anything(), c: expect.anything() }));

    const pos = await (await request.get('/api/positions')).json();
    expect(pos, '/api/positions harus berbentuk {positions:[…]}').toHaveProperty('positions');

    const jr = await (await request.get('/api/journal')).json();
    expect(jr, '/api/journal harus berbentuk {trades:[…]}').toHaveProperty('trades');

    const acct = await (await request.get('/api/account')).json();
    for (const k of ['balance', 'equity', 'unrealizedPl', 'marginUsed', 'marginAvailable']) {
      expect(acct, `field akun ${k} dipakai spRenderAcct (index.html pra-Fase-2:2864)`).toHaveProperty(k);
    }

    const alerts = await (await request.get('/api/alerts')).json();
    expect(Array.isArray(alerts), '/api/alerts harus array (alertView, api.go:131)').toBe(true);

    const cal = await (await request.get('/api/news/calendar?instrument=EUR_USD')).json();
    for (const k of ['stale', 'fetchedAt', 'instrument', 'regime', 'releases']) {
      expect(cal, `field kalender ${k} (news.go:57)`).toHaveProperty(k);
    }
  });

  test('chart benar-benar memuat candle dari server & drawing bisa digambar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Login lewat form bila overlay auth muncul.
    const overlay = page.locator('#authOverlay');
    if ((await overlay.count()) > 0 && (await overlay.isVisible())) {
      await page.fill('#authEmail, input[type="email"]', EMAIL);
      await page.fill('#authPass, input[type="password"]', PASSWORD);
      await page.locator('#authSubmit, button[type="submit"]').first().click();
    }

    await page.waitForFunction(() => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined', null, { timeout: 30000 });
    expect(await page.evaluate(() => chart.getDataList().length), 'candle dari server').toBeGreaterThan(50);

    // Satu gambar saja: membuktikan jalur drawing hidup di lingkungan sungguhan.
    const { armTool, clickAt, CLICK_GAP_MS, overlays } = require('../helpers/draw');
    const { chartRect } = require('../helpers/chart');
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.35), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * 0.3) });
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    expect(await overlays(page)).toHaveLength(1);
  });
});
