// Reticle preview (#chart .mag-dot, index.html:3275) adalah bidikan: ia menjanjikan "titik akan
// mendarat DI SINI". Janji itu hanya benar bila ia memakai anchor yang IDENTIK dengan yang
// di-commit onDrawEnd. Sebelum anchor sub-bar digeneralisasi, reticle memakai xAnchorFromPx
// (timestamp → snap ke pusat bar) untuk semua tool kecuali trendline → meleset ½ bar.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, setCursor, CLICK_GAP_MS } = require('../helpers/draw');

// Satu per geometri: garis 2-titik custom, kotak yang mengembang, dan overlay BUILT-IN
// klinecharts (jalur hook per-instance).
const SAMPLES = ['trendline', 'rect', 'rayLine'];

/** Posisi tengah dot reticle, relatif terhadap #chart. null bila tersembunyi. */
async function dotAt(page) {
  return page.evaluate(() => {
    const d = document.querySelector('#chart .mag-dot');
    // display kosong = belum pernah diposisikan (bukan hanya 'none'); tanpa cek ini
    // parseFloat('') → NaN dan assertion gagal dengan pesan yang menyesatkan.
    if (!d || d.style.display !== 'block' || !d.style.left) return null;
    return { x: parseFloat(d.style.left), y: parseFloat(d.style.top) };
  });
}

test.describe('reticle preview', () => {
  for (const name of SAMPLES) {
    test(`${name}: dot mendarat tepat di kursor (bukan di pusat bar)`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);

      // Reticle hanya tampil pada mode cursor 'dot' (index.html:3282).
      await setCursor(page, 'dot');
      await armTool(page, name);

      // Sengaja membidik posisi yang JELAS bukan pusat bar: offset ganjil dari titik acuan.
      const target = { x: Math.round(rect.width * 0.45) + 3, y: Math.round(rect.height * 0.4) + 3 };
      await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 6 });
      await page.waitForTimeout(CLICK_GAP_MS);

      const dot = await dotAt(page);
      expect(dot, `${name}: reticle harus tampil saat menggambar di mode cursor 'dot'`).not.toBeNull();
      expect(Math.abs(dot.x - target.x), `${name}: reticle X harus di kursor, bukan pusat bar`).toBeLessThanOrEqual(1);
      expect(Math.abs(dot.y - target.y), `${name}: reticle Y harus di kursor`).toBeLessThanOrEqual(1);

      await page.keyboard.press('Escape');
      assertNoPageErrors(page);
    });
  }
});
