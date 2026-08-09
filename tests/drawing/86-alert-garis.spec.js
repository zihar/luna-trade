// Alert dari objek gambar (garis) — tab Alert, pembuatan, dan label daftar.
// Spec: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, overlays, drawTool, CLICK_GAP_MS } = require('../helpers/draw');

async function drawTrendline(page, rect) {
  await armTool(page, 'trendline');
  await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  return (await overlays(page))[0];
}

async function drawRect(page, rect) {
  await armTool(page, 'rect');
  await clickAt(page, rect, { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.2) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.35) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  return (await overlays(page))[0];
}

test.describe('alert garis: tab & pembuatan', () => {
  test('tab Alert muncul untuk trendline, TIDAK untuk rect', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), o.id);
    await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => { drawIds.slice().forEach((i) => chart.removeOverlay(i)); });
    const r = await drawRect(page, rect);
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), r.id);
    await expect(page.locator('.dm-tab[data-tab="alert"]')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  test('membuat alert mengirim cond + did + empat anchor', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);
    const did = await page.evaluate((id) => objDid[id], o.id);

    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.postDataJSON()); });

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.selectOption('.dm-pane[data-pane="alert"] select', 'up');
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);

    const body = posts[0];
    expect(body.cond).toBe('up');
    expect(body.drawId).toBe(did);
    for (const k of ['t1', 'p1', 't2', 'p2']) {
      expect(body[k], `anchor ${k} harus terkirim`).not.toBeUndefined();
      expect(body[k], `anchor ${k} tak boleh null`).not.toBeNull();
    }
    expect(body.t1, 't1 dan t2 harus beda — garis vertikal ditolak server').not.toBe(body.t2);
    assertNoPageErrors(page);
  });

  test('daftar alert menampilkan kondisi & asal, bukan "Crossing" hardcoded', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.selectOption('.dm-pane[data-pane="alert"] select', 'down');
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    const teks = await page.locator('#alertList .al-item .al-main').first().textContent();
    expect(teks, 'harus menyebut kondisi arah').toMatch(/Crossing down/i);
    expect(teks, 'harus menyebut asal objeknya').toMatch(/Trend/i);
    assertNoPageErrors(page);
  });

  test('objek yang sudah punya alert: tab menampilkannya + bisa dihapus', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toBeVisible();
    await page.click('.dm-pane[data-pane="alert"] .da-del');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(0);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: horizontalStraightLine & priceLine cuma 1 titik, jadi
  // lineAnchorsOf lama (yg mensyaratkan points.length>=2) SELALU gagal utknya walau keduanya
  // anggota ALERTABLE_LINE. Pakai horizontalStraightLine (drawTool sudah menanganinya sbg
  // objek 1-klik, lihat tests/drawing/30-interaction.spec.js).
  test('horizontalStraightLine (objek 1-titik): alert tetap mengirim empat anchor, t1 !== t2', async ({ page }) => {
    await gotoApp(page);
    const { obj: o } = await drawTool(page, 'horizontalStraightLine');

    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.postDataJSON()); });

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);

    const body = posts[0];
    for (const k of ['t1', 'p1', 't2', 'p2']) {
      expect(body[k], `anchor ${k} harus terkirim`).not.toBeUndefined();
      expect(body[k], `anchor ${k} tak boleh null`).not.toBeNull();
    }
    expect(body.p1).toBe(body.p2);   // level konstan: satu-satunya harga objek dipakai dua kali
    expect(body.t1, 'objek 1-titik harus tetap dapat t1 !== t2 (server menolak vertikal)').not.toBe(body.t2);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: modal yg masih terbuka sesudah Create tetap menampilkan
  // form Create (bukan Delete), jadi klik kedua mengirim POST /api/alerts KEDUA. Test ini
  // SENGAJA tidak reopen modal — itulah yg bikin gagal lama luput ketahuan.
  test('sesudah Create, pane yg masih terbuka (TANPA reopen) langsung tampil Delete', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    // TANPA openObjSettings lagi: pane yg sudah terbuka harus sudah berganti sendiri.
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toBeVisible();
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-create')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: gerbang !a.drawId di drawAlertLines() ada tapi tak pernah
  // diuji siapa pun; regresi di situ menggambar garis datar di harga 0 utk tiap alert garis.
  test('drawAlertLines() tak membuat overlay alertLine untuk alert garis', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    const created = await page.evaluate(() => {
      const calls = [];
      const orig = chart.createOverlay;
      chart.createOverlay = (opts) => { if (opts && opts.name === 'alertLine') calls.push(opts); return orig.call(chart, opts); };
      try { drawAlertLines(); } finally { chart.createOverlay = orig; }
      return calls;
    });
    expect(created, 'alert garis tak boleh menghasilkan overlay alertLine — garisnya sudah ADA sbg objek gambar').toHaveLength(0);
    assertNoPageErrors(page);
  });

  // Fix round 2 — review menemukan: `await flushPendingPushFor(inst)` polos bisa menggantung
  // SELAMANYA kalau koneksi ke /api/drawings STALL (server diam, bukan menolak) — fetch di
  // codebase ini tak pernah punya timeout sendiri. __setStallDrawings membuat stub MENAHAN
  // route tanpa fulfill sama sekali, meniru itu. Race timer (ALERT_FLUSH_TIMEOUT_MS, ~2dtk di
  // js/draw-alert.js) harus tetap membiarkan alert terbentuk dlm batas waktu wajar.
  test('flush gambar yang STALL tak menyandera Create — alert tetap terbentuk dlm batas waktu', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate(() => __setStallDrawings(true));   // /api/drawings kini digantung stub, tak pernah fulfill

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');

    // Timeout di sini (6dtk) sengaja jauh di atas ALERT_FLUSH_TIMEOUT_MS (~2dtk) + overhead —
    // marjin utk CI, bukan utk menutupi kemungkinan menggantung selamanya (kalau race-nya hilang,
    // ini akan timeout 6dtk lalu tetap merah, bukan macet tanpa batas — Playwright sendiri yang
    // membatasi expect.poll).
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);
    assertNoPageErrors(page);
  });
});
