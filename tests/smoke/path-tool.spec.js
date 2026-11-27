// Path (polyline N-titik ala TradingView, js/overlays-custom.js): klik titik demi titik, selesai lewat
// double-click atau Esc. Tak masuk TOOL_SPEC karena jumlah kliknya tak tetap — parity/landing generik
// mengandaikan N klik lalu objek selesai sendiri. Yang dijaga di sini justru bagian yang khas Path:
// titik karet & titik kembar double-click dibuang, Esc menyelesaikan (bukan membatalkan) bila ≥2 titik,
// panah ujung (default di akhir) bisa diatur di tab Style, dan objeknya tersimpan.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { CLICK_GAP_MS, overlays, openFlyout, clickAt } = require('../helpers/draw');
const { chartRect, toPixels } = require('../helpers/chart');

async function armPath(page) {
  await openFlyout(page, 'shapes');
  await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Path$/ }) }).click();
  await page.waitForFunction(() => inProgressId != null && chart.getOverlayById(inProgressId).name === 'path', null, { timeout: 3000 });
}

function targets(rect) {
  return [
    { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.55) },
    { x: Math.round(rect.width * 0.42), y: Math.round(rect.height * 0.3) },
    { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * 0.5) },
    { x: Math.round(rect.width * 0.68), y: Math.round(rect.height * 0.25) },
  ];
}

async function lastPath(page) {
  const objs = (await overlays(page)).filter((o) => o.name === 'path');
  return objs[objs.length - 1] || null;
}

test.describe('Path (polyline)', () => {
  test('double-click menyelesaikan: jumlah titik = jumlah klik, tanpa titik kembar/karet', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const T = targets(rect);
    await armPath(page);
    for (const t of T.slice(0, 3)) { await clickAt(page, rect, t); await page.waitForTimeout(CLICK_GAP_MS); }
    expect(await page.evaluate(() => inProgressId != null), 'Path belum selesai setelah 3 klik').toBe(true);
    await page.mouse.move(rect.x + T[3].x, rect.y + T[3].y, { steps: 6 });
    await page.mouse.dblclick(rect.x + T[3].x, rect.y + T[3].y);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    await page.mouse.move(rect.x + 8, rect.y + 8, { steps: 2 });

    const o = await lastPath(page);
    expect(o, 'Path harus terbentuk').toBeTruthy();
    expect(o.points.length).toBe(4);
    const px = await toPixels(page, o.points);
    px.forEach((p, i) => {
      expect(Math.abs(p.y - T[i].y), `Y titik ${i}`).toBeLessThanOrEqual(1);
      expect(Math.abs(p.x - T[i].x), `X titik ${i} (snap tengah candle)`).toBeLessThanOrEqual(12);
    });
    // menyelesaikan gambar bukan permintaan membuka setelan
    await page.waitForTimeout(300);
    await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
    // tersimpan (PERSIST_DRAW) dgn jumlah titik yg sama
    const saved = await page.evaluate(() => serializeDraws().filter((d) => d.name === 'path'));
    expect(saved.length).toBe(1);
    expect(saved[0].points.length).toBe(4);
    assertNoPageErrors(page);
  });

  test('Esc menyelesaikan bila ≥2 titik; dengan 1 titik Esc membatalkan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const T = targets(rect);
    await armPath(page);
    await clickAt(page, rect, T[0]); await page.waitForTimeout(CLICK_GAP_MS);
    await page.mouse.move(rect.x + T[1].x, rect.y + T[1].y, { steps: 6 });   // titik karet ikut kursor
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    expect(await lastPath(page), '1 titik + Esc = batal').toBeNull();

    await armPath(page);
    for (const t of T.slice(0, 3)) { await clickAt(page, rect, t); await page.waitForTimeout(CLICK_GAP_MS); }
    await page.mouse.move(rect.x + T[3].x, rect.y + T[3].y, { steps: 6 });   // karet di T[3], belum diklik
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    const o = await lastPath(page);
    expect(o, 'Esc dgn 3 titik = selesai').toBeTruthy();
    expect(o.points.length).toBe(3);
    assertNoPageErrors(page);
  });

  // Shift = kunci sudut (js/draw-constrain.js). Path: TIAP segmen terkunci terhadap titik
  // SEBELUMNYA (bukan hanya segmen pertama spt trendline/channel). Kursor sengaja meleset dari
  // kelipatan 45° — tanpa penguncian titiknya mendarat di kursor dan assertion gagal.
  test('Shift mengunci tiap segmen ke kelipatan 45° dari titik sebelumnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const p0 = { x: Math.round(rect.width * 0.25), y: Math.round(rect.height * 0.5) };
    const SEG = [ { dx: 200, dy: 30, deg: 0 }, { dx: 25, dy: -150, deg: -90 }, { dx: 160, dy: 125, deg: 45 } ];
    await armPath(page);
    await clickAt(page, rect, p0); await page.waitForTimeout(CLICK_GAP_MS);
    await page.keyboard.down('Shift');
    let cur = p0;
    for (const s of SEG) {
      cur = { x: cur.x + s.dx, y: cur.y + s.dy };
      await page.mouse.move(rect.x + cur.x, rect.y + cur.y, { steps: 8 });
      await page.waitForTimeout(80);
      await clickAt(page, rect, cur); await page.waitForTimeout(CLICK_GAP_MS);
    }
    await page.keyboard.up('Shift');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    const o = await lastPath(page);
    expect(o.points.length).toBe(4);
    const px = await toPixels(page, o.points);
    SEG.forEach((s, i) => {
      const a = px[i], b = px[i + 1], r = (s.deg * Math.PI) / 180;
      const dist = Math.abs((b.x - a.x) * Math.sin(r) - (b.y - a.y) * Math.cos(r));
      const deg = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI / 45) * 45;
      expect(deg, `segmen ${i + 1} tak dikunci ke ${s.deg}°`).toBe(s.deg);
      expect(dist, `segmen ${i + 1} melenceng dari sinar ${s.deg}°`).toBeLessThanOrEqual(1.5);
    });
    assertNoPageErrors(page);
  });

  test('tab Style: panah default di akhir; Line start/end mengubah gambar', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const T = targets(rect);
    await armPath(page);
    for (const t of T.slice(0, 2)) { await clickAt(page, rect, t); await page.waitForTimeout(CLICK_GAP_MS); }
    await page.mouse.dblclick(rect.x + T[2].x, rect.y + T[2].y);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    const o = await lastPath(page);
    const figs = () => page.evaluate((id) => {
      const ov = chart.getOverlayById(id); const st = dstyle(ov);
      return { lineStart: st.lineStart, lineEnd: st.lineEnd };
    }, o.id);
    expect(await figs()).toEqual({ lineStart: 'normal', lineEnd: 'arrow' });

    await page.mouse.move(rect.x + 8, rect.y + 8, { steps: 2 });
    const chartEl = page.locator('#chart');
    const before = await chartEl.screenshot();
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 10, 10), o.id);
    const modal = page.locator('.dmodal-scrim.show');
    await expect(modal.locator('.dm-tab.on')).toHaveAttribute('data-tab', 'style');
    await expect(modal.locator('.dm-tab[data-tab="text"]')).toHaveCount(0);   // TV: Path tanpa tab Text
    await expect(modal.locator('.dm-tab[data-tab="coords"]')).toHaveCount(1);
    await expect(modal.locator('[data-pend="lineEnd"][data-pv="arrow"]')).toHaveClass(/\bon\b/);
    await modal.locator('[data-pend="lineEnd"][data-pv="normal"]').click();
    await modal.locator('[data-pend="lineStart"][data-pv="arrow"]').click();
    await expect(modal.locator('[data-pend="lineEnd"][data-pv="arrow"]')).not.toHaveClass(/\bon\b/);
    await modal.locator('.dm-close').click();
    expect(await figs()).toEqual({ lineStart: 'arrow', lineEnd: 'normal' });
    await page.mouse.move(rect.x + 8, rect.y + 8, { steps: 2 });
    await page.waitForTimeout(100);
    const after = await chartEl.screenshot();
    expect(Buffer.compare(before, after), 'panah pindah ujung → canvas berubah').not.toBe(0);
    const saved = await page.evaluate(() => serializeDraws().find((d) => d.name === 'path').style);
    expect(saved).toMatchObject({ lineStart: 'arrow', lineEnd: 'normal' });
    assertNoPageErrors(page);
  });

  // Klik kanan saat menggambar Path = SELESAI (TV), bukan batal — selama ≥2 titik sudah diklik.
  // Dengan 1 titik tak ada garis untuk disimpan, jadi tetap batal (sama dgn Esc).
  test('klik kanan menyelesaikan bila ≥2 titik; dengan 1 titik membatalkan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const T = targets(rect);
    await armPath(page);
    await clickAt(page, rect, T[0]); await page.waitForTimeout(CLICK_GAP_MS);
    await page.mouse.move(rect.x + T[1].x, rect.y + T[1].y, { steps: 6 });
    await page.mouse.click(rect.x + T[1].x, rect.y + T[1].y, { button: 'right' });
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    expect(await lastPath(page), '1 titik + klik kanan = batal').toBeNull();

    await armPath(page);
    for (const t of T.slice(0, 3)) { await clickAt(page, rect, t); await page.waitForTimeout(CLICK_GAP_MS); }
    await page.mouse.move(rect.x + T[3].x, rect.y + T[3].y, { steps: 6 });   // karet di T[3], belum diklik
    await page.mouse.click(rect.x + T[3].x, rect.y + T[3].y, { button: 'right' });
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 3000 });
    const o = await lastPath(page);
    expect(o, 'klik kanan dgn 3 titik = selesai').toBeTruthy();
    expect(o.points.length).toBe(3);
    // klik kanan yang menyelesaikan tak boleh sekaligus membuka menu konteks / modal Style
    await page.waitForTimeout(200);
    await expect(page.locator('.ctxmenu')).toBeHidden();
    await expect(page.locator('.dmodal-scrim.show')).toHaveCount(0);
    const saved = await page.evaluate(() => serializeDraws().filter((d) => d.name === 'path'));
    expect(saved.length).toBe(1);
    expect(saved[0].points.length).toBe(3);
    assertNoPageErrors(page);
  });

  // Kursor melintas ke sumbu harga saat menggambar: klinecharts mengirim event itu dari widget
  // sumbu-Y dgn e.x RELATIF SUMBU (≈0–60px). Dulu onDrawing membacanya sbg x area chart → titik
  // karet terlempar ke tepi KIRI chart. Kini titik karet menempel di tepi kanan area plot.
  test('kursor di atas sumbu harga: titik karet tetap di tepi kanan, tak loncat ke kiri', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const a = { x: Math.round(rect.width * 0.5), y: Math.round(rect.height * 0.6) };
    const b = { x: Math.round(rect.width * 0.7), y: Math.round(rect.height * 0.3) };
    await armPath(page);
    await clickAt(page, rect, a); await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, b); await page.waitForTimeout(CLICK_GAP_MS);
    const ay = Math.round(rect.height * 0.45);
    // chartRect = seluruh #chart (termasuk sumbu harga); lebar area plot dari klinecharts
    const plotW = await page.evaluate(() => chart.getSize('candle_pane', 'main').width);
    expect(rect.width - plotW, 'sumbu harga harus ada di kanan plot').toBeGreaterThan(30);
    await page.mouse.move(rect.x + plotW - 40, rect.y + ay, { steps: 4 });
    await page.mouse.move(rect.x + plotW + 20, rect.y + ay, { steps: 6 });   // di atas sumbu harga
    await page.waitForTimeout(80);
    const pts = await page.evaluate(() => chart.getOverlayById(inProgressId).points);
    const px = await toPixels(page, pts);
    const last = px[px.length - 1];
    expect(last.x, `titik karet loncat ke x=${Math.round(last.x)}`).toBeGreaterThanOrEqual(plotW - 12);
    expect(last.x).toBeLessThanOrEqual(plotW);
    expect(Math.abs(last.y - ay), 'Y titik karet ikut kursor').toBeLessThanOrEqual(2);
    // titik yg sudah diklik tak ikut bergeser
    expect(Math.abs(px[0].x - a.x)).toBeLessThanOrEqual(12);
    expect(Math.abs(px[1].x - b.x)).toBeLessThanOrEqual(12);
    await page.keyboard.press('Escape');
    assertNoPageErrors(page);
  });
});
