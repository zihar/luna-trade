// Alert dari objek gambar (garis) — tab Alert, pembuatan, dan label daftar.
// Spec: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

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
});
