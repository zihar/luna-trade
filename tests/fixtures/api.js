// Semua stub jaringan untuk E2E, di satu tempat.
//
// Frontend luna-trade hanya punya SATU gerbang: /api/auth/me (`authGate`,
// js/auth-overlay.js:65). Distub jadi 200 → bootApp() jalan dan layar login dilewati.
// Endpoint lain distub dengan bentuk
// yang meniru handler Go aslinya (api.go / auth.go / main.go) supaya test tak perlu
// server Go, .env, token OANDA, atau luna.db.
//
// Bentuk respons yang ditiru:
//   /api/auth/me      → handleMe (auth.go:171)
//   /api/auth/config  → handleAuthConfig (auth.go:56)
//   /api/candles      → passthrough OANDA (main.go:246) = {candles:[{time,mid,volume,complete}]}
//   /api/alerts       → []alertView (api.go:131)
//   /api/news/calendar→ calResponse (news.go:57)
//   /api/positions    → {positions:[…]}, /api/journal → {trades:[…]} (index.html:2803-2810)

const fs = require('fs');
const path = require('path');

const CANDLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'candles-eurusd-m15.json'), 'utf8'));
const KLINECHARTS = fs.readFileSync(path.join(__dirname, 'klinecharts-9.8.10.min.js'), 'utf8');

const FIXTURE_LAST_TS = Date.parse(CANDLES.candles[CANDLES.candles.length - 1].time);
const FIXTURE_LAST_CLOSE = +CANDLES.candles[CANDLES.candles.length - 1].mid.c;

// State server palsu, per-page. Dikembalikan ke test supaya bisa diperiksa/dimanipulasi.
function newState() {
  return {
    user: { email: 'e2e@luna.local', name: 'Luna E2E', picture: '', is_admin: false },
    account: { balance: 10000, equity: 10000, unrealizedPl: 0, marginUsed: 0, marginAvailable: 10000 },
    positions: [],
    trades: [],
    alerts: [],
    tracked: [], // event analytics yang dikirim FE (POST /api/track)
    nextId: 1,
  };
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

// Kalender news: satu event High USD yang SUDAH rilis + satu yang akan datang, cukup untuk
// smoke (kartu bias, marker on-chart) tanpa bergantung tanggal berjalan.
function calendarFixture(instrument) {
  const at = (offsetMin) => new Date(FIXTURE_LAST_TS + offsetMin * 60000).toISOString();
  return {
    stale: false,
    fetchedAt: at(0),
    instrument: instrument || 'EUR_USD',
    regime: 'risk-on',
    nextRelease: { name: 'Nonfarm Payrolls', currency: 'USD', time: at(90), minsToGo: 90 },
    releases: [
      {
        name: 'CPI y/y',
        time: at(-120),
        currency: 'USD',
        impact: 'High',
        released: true,
        forecast: '3.1%',
        previous: '3.0%',
        actual: '3.4%',
        verdict: {
          surprise: 'hotter',
          usdLean: 'bullish',
          bias: 'bearish',
          label: 'USD bullish',
          playbook: 'Hotter CPI → USD strength.',
        },
      },
      {
        name: 'Nonfarm Payrolls',
        time: at(90),
        currency: 'USD',
        impact: 'High',
        released: false,
        forecast: '180K',
        previous: '175K',
        actual: '',
        verdict: { surprise: '', usdLean: '', bias: '', label: '', playbook: '' },
      },
    ],
  };
}

/**
 * Pasang semua stub pada satu page. Kembalikan state server palsu.
 * @param {import('@playwright/test').Page} page
 */
async function installStubs(page) {
  const state = newState();

  // klinecharts dari unpkg → salinan lokal. Tanpa ini, suite bergantung jaringan dan
  // versi di CDN; dengan ini versinya terkunci (kalau CDN berubah, test yang memberi tahu).
  await page.route('https://unpkg.com/klinecharts@**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: KLINECHARTS })
  );

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    let body = {};
    if (method === 'POST') {
      try {
        body = req.postDataJSON() || {};
      } catch (_) {
        body = {};
      }
    }

    switch (p) {
      case '/api/auth/me':
        return json(route, state.user);
      case '/api/auth/config':
        return json(route, { google: false });
      case '/api/auth/logout':
        return json(route, { ok: true });

      case '/api/candles':
        return json(route, CANDLES);

      case '/api/account':
        return json(route, state.account);
      case '/api/positions':
        return json(route, { positions: state.positions });
      case '/api/journal':
        return json(route, { trades: state.trades });

      case '/api/order': {
        const id = state.nextId++;
        const entry = body.price || FIXTURE_LAST_CLOSE;
        const pos = {
          id,
          instrument: body.instrument || 'EUR_USD',
          dir: body.dir || 'long',
          units: body.units || 1000,
          entry,
          sl: body.sl ?? null,
          tp: body.tp ?? null,
          pnlCcy: 0,
          openedAt: Date.now(),
        };
        state.positions.push(pos);
        return json(route, { ok: true, id, entry, position: pos });
      }
      case '/api/close': {
        const i = state.positions.findIndex((x) => x.id === body.id);
        if (i < 0) return json(route, { error: 'posisi tak ada' }, 404);
        const [p0] = state.positions.splice(i, 1);
        state.trades.push({ ...p0, closedAt: Date.now(), pnlCcy: 0 });
        return json(route, { ok: true, id: body.id, pnlCcy: 0 });
      }
      case '/api/position/sltp': {
        const pos = state.positions.find((x) => x.id === body.id);
        if (!pos) return json(route, { error: 'posisi tak ada' }, 404);
        if ('sl' in body) pos.sl = body.sl;
        if ('tp' in body) pos.tp = body.tp;
        return json(route, { ok: true, position: pos });
      }

      case '/api/alerts': {
        if (method === 'POST') {
          const a = {
            id: state.nextId++,
            instrument: body.instrument || 'EUR_USD',
            price: body.price,
            active: true,
            createdAt: Date.now(),
            triggeredAt: null,
          };
          state.alerts.push(a);
          return json(route, a);
        }
        return json(route, state.alerts);
      }
      case '/api/alerts/delete': {
        state.alerts = state.alerts.filter((a) => a.id !== body.id);
        return json(route, { ok: true });
      }

      case '/api/news/calendar':
        return json(route, calendarFixture(url.searchParams.get('instrument')));
      case '/api/news/headlines':
        return json(route, {
          stale: false,
          fetchedAt: new Date(FIXTURE_LAST_TS).toISOString(),
          instrument: url.searchParams.get('instrument') || 'EUR_USD',
          articles: [
            {
              headline: 'Dollar steadies after hotter CPI print',
              source: 'E2E Wire',
              url: 'https://example.invalid/a',
              datetime: Math.floor(FIXTURE_LAST_TS / 1000) - 3600,
              summary: 'Fixture article.',
              currencies: ['USD'],
            },
          ],
        });

      case '/api/track':
        state.tracked.push(body);
        return json(route, { ok: true });
      case '/api/analytics':
        return json(route, { events: [] });

      // SSE harga: EventSource sudah di-stub di initScript (lihat installPageHarness),
      // jadi jalur ini praktis tak terpakai. Tetap dilayani supaya tak ada request menggantung.
      case '/api/prices':
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': stub\n\n' });

      default:
        return json(route, { error: 'stub tak dikenal: ' + p }, 501);
    }
  });

  return state;
}

module.exports = {
  installStubs,
  CANDLES,
  FIXTURE_LAST_TS,
  FIXTURE_LAST_CLOSE,
  calendarFixture,
};
