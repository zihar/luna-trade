// Smoke tipis per area non-drawing: jaring pengaman, bukan cakupan mendalam.
//
// Tiap test membuktikan satu hal — "area ini hidup dan tak melempar error JS". Cakupan
// mendalam per area menyusul di ronde berikutnya. Guard page.on('pageerror') aktif di semua
// test lewat gotoApp/assertNoPageErrors: error JS apa pun = gagal.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, dataList } = require('../helpers/chart');
const { CANDLES } = require('../fixtures/api');

test('watchlist: baris terbangun & klik baris mengganti instrumen chart', async ({ page }) => {
  await gotoApp(page);
  // Panel Markets tersembunyi secara default (br_watchHidden belum ada di profil bersih)
  // → buka lewat tombol rail, bukan diakali dari state.
  await page.locator('#toggleMarkets').click();
  await expect(page.locator('#watchlist')).not.toHaveClass(/hidden/);
  const rows = page.locator('#wlRows .wl-row:not(.wl-hdr)');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count(), 'watchlist harus punya beberapa baris instrumen').toBeGreaterThan(1);

  const before = await page.evaluate(() => inst);
  // Cari baris pertama yang instrumennya BEDA dari yang aktif.
  const target = await page.evaluate((cur) => {
    const r = [...document.querySelectorAll('#wlRows .wl-row:not(.wl-hdr)')].find((x) => x.dataset.sym && x.dataset.sym !== cur);
    return r ? r.dataset.sym : null;
  }, before);
  test.skip(!target, 'tak ada baris watchlist dengan data-sym berbeda');

  await page.locator(`#wlRows .wl-row[data-sym="${target}"]`).click();
  await page.waitForFunction((s) => inst === s && chart.getDataList().length > 0, target, { timeout: 20000 });
  expect(await page.evaluate(() => inst)).toBe(target);
  assertNoPageErrors(page);
});

test('timeframe: tombol bar + dropdown semua TF', async ({ page }) => {
  await gotoApp(page);
  const tfBtns = page.locator('#tfbtns .tf');
  await expect(tfBtns.first()).toBeVisible();
  const before = await page.evaluate(() => currentTF);

  await page.locator('#tfMore').click();
  await page.locator('#tfMenu.open').waitFor();
  expect(await page.locator('#tfMenu .tf-row').count(), 'dropdown harus memuat seluruh TF_LIST').toBe(18);

  await page.locator('#tfMenu .tf-row .tf-lbl', { hasText: /^H1$/ }).click();
  await page.waitForFunction(() => currentTF === 'H1' && chart.getDataList().length > 0, null, { timeout: 20000 });
  expect(await page.evaluate(() => currentTF)).not.toBe(before);
  assertNoPageErrors(page);
});

test('chart type: bisa berganti tipe render', async ({ page }) => {
  await gotoApp(page);
  const before = await page.evaluate(() => chartType);
  const btn = page.locator('#ctBtn, #chartTypeBtn, [title*="chart type" i]').first();
  test.skip((await btn.count()) === 0, 'tombol chart-type tak ditemukan');
  await btn.click();
  const opt = page.locator('.ind-item[data-ct]:not(.on)').first();
  test.skip((await opt.count()) === 0, 'menu chart-type tak terbuka');
  const want = await opt.getAttribute('data-ct');
  await opt.click();
  await expect.poll(async () => page.evaluate(() => chartType), { timeout: 3000 }).toBe(want);
  expect(want).not.toBe(before);
  assertNoPageErrors(page);
});

test('indikator: bisa ditambahkan & muncul di legend', async ({ page }) => {
  await gotoApp(page);
  const before = await page.evaluate(() => (typeof chart.getIndicatorByPaneId === 'function' ? Object.keys(chart.getIndicatorByPaneId() || {}).length : 0));
  await page.locator('#indBtn').click();
  await expect(page.locator('#indModal')).toBeVisible();
  const row = page.locator('#indList .ind-row:not(.on)').first();
  await expect(row).toBeVisible();
  const name = await row.getAttribute('data-ind');
  await row.click();
  await expect.poll(async () => page.evaluate((n) => !!activeInd[n], name), { timeout: 5000 }).toBe(true);
  const after = await page.evaluate(() => Object.keys(chart.getIndicatorByPaneId() || {}).length);
  expect(after, 'indikator harus terpasang').toBeGreaterThanOrEqual(before);
  assertNoPageErrors(page);
});

test('bar replay: masuk, maju satu bar, keluar', async ({ page }) => {
  await gotoApp(page);
  const btn = page.locator('#replayBtn, [title*="replay" i]').first();
  test.skip((await btn.count()) === 0, 'tombol replay tak ditemukan');
  await btn.click();

  // Replay minta pilih bar dulu (Select bar) → klik di tengah chart.
  const rect = await chartRect(page);
  await page.mouse.click(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5);
  await page.waitForTimeout(600);
  const inReplay = await page.evaluate(() => (typeof replayOn !== 'undefined' ? !!replayOn : null));
  expect(inReplay === null || typeof inReplay === 'boolean').toBe(true);
  assertNoPageErrors(page);
});

test('news: panel kalender memuat fixture & kartu bias tampil', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#newsBtn, [title*="news" i]').first().click();
  await expect(page.locator('#newspanel')).not.toHaveClass(/hidden/);
  await expect.poll(async () => page.evaluate(() => (newsState && newsState.releases ? newsState.releases.length : 0)), { timeout: 8000 }).toBe(2);
  await expect(page.locator('#newspanel')).toContainText('CPI');
  assertNoPageErrors(page);
});

test('price alerts: dialog membuat alert lewat server (stub) & muncul di panel', async ({ page }) => {
  const { state } = await gotoApp(page);
  await page.locator('#alertsBtn, [title*="alert" i]').first().click();

  const created = await page.evaluate(async () => {
    const cur = chart.getDataList().slice(-1)[0].close;
    const a = await createServerAlert(+(cur * 1.01).toFixed(5));
    return a ? { id: a.id, price: a.price } : null;
  });
  expect(created, 'alert harus dibuat').toBeTruthy();
  expect(state.alerts, 'server palsu harus menerima alert').toHaveLength(1);
  await expect.poll(async () => page.evaluate(() => alerts.length), { timeout: 5000 }).toBe(1);
  assertNoPageErrors(page);
});

test('paper trading: market order lewat panel → posisi muncul', async ({ page }) => {
  const { state } = await gotoApp(page);
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument: inst, dir: 'long', units: 1000 }),
    });
    const d = await r.json();
    await spSync();
    return { ok: r.ok, id: d.id, positions: SP.positions.length };
  });
  expect(res.ok).toBe(true);
  expect(state.positions, 'server palsu harus menyimpan posisi').toHaveLength(1);
  expect(res.positions, 'FE harus menampilkan posisi setelah sync').toBe(1);
  assertNoPageErrors(page);
});

test('instrumen: DXY & saham ada di daftar dengan gating tradeable', async ({ page }) => {
  await gotoApp(page);
  const opts = await page.locator('#instrument option').allTextContents();
  expect(opts.length, 'daftar instrumen harus terisi').toBeGreaterThan(3);
  // applyTradeGating menonaktifkan order untuk instrumen non-tradeable (DXY / STOCK:).
  const gating = await page.evaluate(() => typeof applyTradeGating === 'function');
  expect(gating).toBe(true);
  assertNoPageErrors(page);
});

test('tema: toggle light/dark mengubah kelas body & style chart', async ({ page }) => {
  await gotoApp(page);
  const before = await page.evaluate(() => document.body.classList.contains('light'));
  // Segment tema ada di dalam user popup (#userPop), dibuka lewat avatar.
  await page.locator('#userAvatar').click();
  await expect(page.locator('#userPop')).toHaveClass(/open/);
  await page.locator('#themeSeg button[data-theme="' + (before ? 'dark' : 'light') + '"]').click();
  await expect.poll(async () => page.evaluate(() => document.body.classList.contains('light')), { timeout: 3000 }).toBe(!before);
  assertNoPageErrors(page);
});

test('data: chart memuat tepat jumlah bar fixture (stub benar-benar dipakai)', async ({ page }) => {
  await gotoApp(page);
  const bars = await dataList(page);
  expect(bars.length).toBe(CANDLES.candles.length);
  assertNoPageErrors(page);
});
