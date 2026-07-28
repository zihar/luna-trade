// Gerbang VISUAL undangan "+ Add text" pada rect (index.html pra-Fase-2:881), diuji lewat diff screenshot.
//
// tests/drawing/40-modal-text.spec.js hanya membuktikan AKIBAT hit-area lewat onClick
// (editor inline terbuka/tidak) — tak ada test yang benar-benar MELIHAT figure canvasnya. Kalau
// syarat `w>=ADDTEXT_MIN_W && h>=ADDTEXT_MIN_H` di createPointFigures rusak ke arah mana pun
// (label tak pernah tergambar sama sekali, ATAU tetap tergambar pada kotak kecil), test onClick
// tak akan pernah menangkapnya. Berkas ini melengkapi itu — precedent diff-based: 20-parity.spec.js.
//
// Baseline WAJIB bukan hover maupun selected: showAddTextHint (index.html pra-Fase-2:841) menyalakan label
// pada KEDUANYA, jadi baseline yg masih ke-hover/ke-select sudah berisi labelnya sendiri dan diff
// jadi tak berarti. Diverifikasi lewat page.evaluate(() => [hoverId, selectedId]) — bukan
// diasumsikan dari Escape + mouse-move-nya drawTool.
//
// Cursor DIPAKSA 'arrow' (tanpa crosshair) sebelum memotret, persis seperti 20-parity.spec.js:
// mode default 'cross' menggambar garis reticle tepat di posisi kursor — yaitu PERSIS titik
// tengah kotak yang mau diukur di sini — dan itu akan mendominasi diff, menyamarkan sinyal
// label sungguhan (ketahuan lewat percobaan: tanpa ini, diff pixel count juga tak nol pada
// kode yang BENAR karena reticle, bukan karena label).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { toPixels } = require('../helpers/chart');
const { drawTool, diffShots, setCursor } = require('../helpers/draw');

async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Bounding box kotak rect (8 titik setelah expandBox: [0]=TL, [4]=BR) dalam pixel container-relative. */
async function boxOf(page, obj) {
  const px = await toPixels(page, obj.points);
  const x = Math.min(px[0].x, px[4].x), y = Math.min(px[0].y, px[4].y);
  return { x, y, w: Math.abs(px[4].x - px[0].x), h: Math.abs(px[4].y - px[0].y) };
}

test.describe('rect "+ Add text" — gerbang visual (diff screenshot)', () => {
  test('rect besar: hover mengubah pixel di region TENGAH kotak (label), bukan cuma di tepi/handle', async ({ page }) => {
    await gotoApp(page);
    await setCursor(page, 'arrow');   // matikan crosshair → diff hanya berisi objek, bukan reticle
    const { obj, rect } = await drawTool(page, 'rect');   // defaultTargets → jauh di atas ADDTEXT_MIN_W/H
    expect(obj, 'objek harus terbentuk lebih dulu').toBeTruthy();

    let state = await page.evaluate(() => [hoverId, selectedId]);
    expect(state, 'baseline harus TANPA hover & TANPA seleksi').toEqual([null, null]);

    const box = await boxOf(page, obj);
    // Region tengah: cukup jauh dari tepi supaya handle titik (OVERLAY_POINT, index.html pra-Fase-2:1309 —
    // radius 3.5 + border 1.5 ≈ 5px dari titiknya, yg persis duduk DI tepi/sudut kotak) tak ikut
    // masuk crop, tapi cukup lebar untuk menangkap label "+ Add text" (~66px, dipusatkan di
    // tengah kotak persis di titik yg sama dgn crop ini).
    const MARGIN = 30;
    expect(box.w, 'kotak default harus jauh di atas 2×MARGIN supaya region tengah tak kosong').toBeGreaterThan(MARGIN * 2 + 60);
    expect(box.h, 'kotak default harus jauh di atas 2×MARGIN supaya region tengah tak kosong').toBeGreaterThan(MARGIN * 2 + 20);

    const clip = { x: rect.x + box.x + MARGIN, y: rect.y + box.y + MARGIN, width: box.w - MARGIN * 2, height: box.h - MARGIN * 2 };
    const baseline = await page.screenshot({ clip });

    const cx = rect.x + box.x + box.w / 2, cy = rect.y + box.y + box.h / 2;
    await page.mouse.move(cx, cy, { steps: 8 });
    state = await page.evaluate(() => [hoverId, selectedId]);
    expect(state[0], 'hover harus benar-benar kena objeknya').toBe(obj.id);
    await settle(page);

    const hovered = await page.screenshot({ clip });
    const diff = await diffShots(page, baseline, hovered);
    expect(diff, 'diff harus terhitung').toBeTruthy();
    expect(diff.diffPixels, 'label "+ Add text" harus tergambar di region tengah kotak saat hover').toBeGreaterThan(0);

    assertNoPageErrors(page);
  });

  test('rect kecil (55×20, di bawah ADDTEXT_MIN_W/H): hover TIDAK mengubah pixel tepat di tengah kotak', async ({ page }) => {
    await gotoApp(page);
    await setCursor(page, 'arrow');   // matikan crosshair → diff hanya berisi objek, bukan reticle
    const { obj, rect } = await drawTool(page, 'rect', {
      targets: [{ x: 200, y: 200 }, { x: 255, y: 220 }],   // 55×20 px → di bawah kedua ambang
    });
    expect(obj, 'objek harus terbentuk lebih dulu').toBeTruthy();

    const [MINW, MINH] = await page.evaluate(() => [ADDTEXT_MIN_W, ADDTEXT_MIN_H]);
    const box = await boxOf(page, obj);
    // Ukuran nyata diperiksa, bukan diasumsikan (expandBox punya lebar minimum 1 bar,
    // index.html pra-Fase-2:832) — kalau kotak ini ternyata jatuh DI ATAS ambang, test harus GAGAL
    // berisik di sini, bukan lolos diam-diam karena mengukur kotak yg salah ukuran.
    expect(box.w, 'kotak uji harus lebih sempit dari ADDTEXT_MIN_W').toBeLessThan(MINW);
    expect(box.h, 'kotak uji harus lebih pendek dari ADDTEXT_MIN_H').toBeLessThan(MINH);

    let state = await page.evaluate(() => [hoverId, selectedId]);
    expect(state, 'baseline harus TANPA hover & TANPA seleksi').toEqual([null, null]);

    // Crop KECIL dipusatkan tepat di titik tengah kotak (tempat label akan digambar bila gerbang
    // ukuran rusak) — sengaja JAUH dari tepi kotak supaya handle titik (yg selalu tergambar saat
    // hover, terlepas dari gerbang ini) tak ikut masuk & tak menyamarkan sinyalnya. Setengah-lebar/
    // tinggi crop dipilih kecil (8×3px) supaya tetap comfortably di dalam kotak 55×20 dgn margin ke
    // tepi > radius+border handle titik (≈5px, OVERLAY_POINT index.html pra-Fase-2:1309).
    const half = { x: 8, y: 3 };
    const clip = {
      x: rect.x + box.x + box.w / 2 - half.x,
      y: rect.y + box.y + box.h / 2 - half.y,
      width: half.x * 2,
      height: half.y * 2,
    };
    const baseline = await page.screenshot({ clip });

    const cx = rect.x + box.x + box.w / 2, cy = rect.y + box.y + box.h / 2;
    await page.mouse.move(cx, cy, { steps: 8 });
    state = await page.evaluate(() => [hoverId, selectedId]);
    expect(state[0], 'hover harus benar-benar kena objeknya').toBe(obj.id);
    await settle(page);

    const hovered = await page.screenshot({ clip });
    const diff = await diffShots(page, baseline, hovered);
    expect(diff, 'diff harus terhitung').toBeTruthy();
    // Ini sinyal utama test ini: kalau gerbang ukuran (index.html pra-Fase-2:881) rusak sehingga label tetap
    // tergambar pada kotak kecil, glyph tepat di tengah kotak inilah yg akan berubah. Kalau
    // gerbangnya benar, kotak kecil dibiarkan bersih dan titik tengah ini tak tersentuh apa pun.
    expect(diff.diffPixels, 'titik tengah kotak kecil TIDAK boleh berubah saat hover (label harus tetap mati)').toBe(0);

    assertNoPageErrors(page);
  });
});
