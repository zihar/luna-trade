// Konfigurasi E2E luna-trade.
//
// Dua project:
//   hermetic    (default) — static server + SEMUA /api distub. Tanpa .env, token OANDA,
//                           luna.db, atau binary Go. Deterministik & jalan offline.
//   integration (@integration) — butuh server Go asli di :8765 (PORT=8765 ./luna-trade).
//                           Dijalankan manual: npm run test:integration
//
// Viewport dipatok supaya geometri chart konsisten; koordinat klik tetap dihitung lewat
// converter chart (tests/helpers/chart.js), bukan dari angka viewport ini.

const { defineConfig, devices } = require('@playwright/test');

const E2E_PORT = Number(process.env.E2E_PORT || 8799);

module.exports = defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: require.resolve('./tests/global-setup.js'),
  globalTeardown: require.resolve('./tests/global-teardown.js'),
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Zona waktu & locale dipatok: label sumbu waktu & format angka ikut ini.
    timezoneId: 'UTC',
    locale: 'en-US',
  },

  projects: [
    {
      name: 'hermetic',
      testIgnore: /integration\//,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${E2E_PORT}` },
    },
    {
      name: 'integration',
      testMatch: /integration\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.LUNA_URL || 'http://localhost:8765' },
    },
    // live — spec UI yang SAMA seperti hermetic, tapi terhadap server Go asli + akun sungguhan
    // (tanpa stub /api). Opt-in penuh: butuh `LUNA_LIVE=1` supaya gotoApp melewati stub & login
    // dulu, plus server jalan di :8765. Dipakai untuk memastikan sebuah temuan bukan artefak
    // fixture; hasilnya TAK deterministik (data pasar bergerak), jadi bukan gerbang CI.
    {
      name: 'live',
      testIgnore: /integration\//,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.LUNA_URL || 'http://localhost:8765' },
    },
  ],

  webServer: {
    command: `node tests/static-server.js`,
    url: `http://localhost:${E2E_PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
    env: { E2E_PORT: String(E2E_PORT) },
  },
});
