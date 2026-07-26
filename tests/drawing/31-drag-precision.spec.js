// Presisi DRAG SETELAH OBJEK JADI, untuk semua tool yang bisa di-drag.
//
// Ini menutup titik buta yang diakui di docs/e2e-drawing-findings.md (kualifikasi Temuan 1):
// lapis presisi drag (`onPressedMoveStart`/`onPressedMoving`/`onPressedMoveEnd`) cuma terdaftar
// di registrasi `trendline`, jadi tool lain kemungkinan besar masih snap ke pusat bar saat
// titik/badan objek yang SUDAH jadi digeser — dan itu belum pernah diuji.
// `30-interaction.spec.js` menguji drag hanya atas `trendline`.
//
// Dua metrik, masing-masing menjawab keluhan berbeda:
//   drag titik  → titik yang diseret harus mendarat DI KURSOR (bukan di pusat bar terdekat)
//   drag badan  → seluruh titik harus bergeser SEBESAR gerakan kursor (bukan dibulatkan per bar)
//
// TARGET SENGAJA DITARUH DI TENGAH ANTARA DUA PUSAT BAR (`halfBarOffX`). Tanpa itu, besar
// kesalahan snap tergantung keberuntungan: target yang kebetulan jatuh dekat pusat bar hanya
// meleset ~0-2px dan sebuah tool bisa "lolos" walau jelas men-snap. Di tengah dua bar, tool yang
// men-snap PASTI meleset ½ barSpace — kegagalan jadi deterministik dan sebesar mungkin.
//
// Toleransi mengikuti TOOL_SPEC: ≤1px untuk tool sub-bar, ½ barSpace + 1 untuk tool yang
// snap-per-bar-nya disengaja (verticalStraightLine; long/shortPosition tak diuji di sini —
// lihat DRAG_SKIP).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { toPixels, toPixel, barSpace, plotWidth } = require('../helpers/chart');
const { drawTool, overlays, hoverableSpot, clickAt } = require('../helpers/draw');
const { TOOL_SPEC, tolX, TOL_Y_PX } = require('../helpers/spec');

// Tool yang memang TAK diuji di sini, masing-masing dengan alasannya. Bukan daftar
// "yang gagal" — daftar "yang jalur drag-nya bukan jalur ini".
const DRAG_SKIP = {
  simpleAnnotation: 'Temuan 3: tak bisa di-hover di titik mana pun → tak bisa dipilih/di-drag sama sekali',
  simpleTag: 'Temuan 3: idem simpleAnnotation',
  longPosition: 'drag-nya jalur sendiri (handle SL/TP + panel edit posisi via showPosPopup), bukan drag titik overlay biasa',
  shortPosition: 'idem longPosition',
};
// Tool yang tak punya "badan" terpisah dari handle titiknya: figure-nya begitu kecil sehingga
// SEMUA pixel yang bisa di-hover berada dalam radius handle (terukur lewat probe: tak ada satu
// pun kandidat hoverable berjarak ≥14px dari titik). Untuk tool ini drag badan == drag titik,
// jadi sudah tercakup blok "titik" di atas — menguji ulang cuma menambah test yang menipu.
const BODY_SKIP = {
  arrowMarkUp: 'figure mark kecil: tak ada pixel hoverable ≥14px dari handle → badan == titik',
  arrowMarkDown: 'idem arrowMarkUp',
  text: 'kotak teks kecil: idem — semua pixel hoverable ada di dalam radius handle',
};

const DRAGGABLE = TOOL_SPEC.filter((s) => !DRAG_SKIP[s.name]);
const BODY_DRAGGABLE = DRAGGABLE.filter((s) => !BODY_SKIP[s.name]);

/**
 * X yang berada TEPAT di tengah antara dua pusat bar, sedekat mungkin ke `wantX`.
 * Pusat bar diambil dari converter chart (bukan angka hardcode), jadi ikut barSpace nyata.
 */
async function halfBarOffX(page, wantX, sp) {
  const ref = await toPixel(page, { dataIndex: 40, value: 0 });
  const c = ref ? ref.x : wantX;
  return c + Math.round((wantX - c) / sp) * sp + sp / 2;
}

/**
 * Titik yang layak diseret untuk menilai presisi DUA sumbu: sebuah SUDUT bounding box.
 *
 * Objek yang mengembang jadi 8 titik (`rect`, `fib3`) menaruh handle **tengah-sisi** di antara
 * sudut-sudutnya — terukur lewat probe: indeks 1 & 5 tengah-sisi horizontal, 3 & 7 tengah-sisi
 * vertikal, sisanya sudut. Handle tengah-sisi memang HANYA menggeser satu sumbu (menarik handle
 * kiri-tengah menggeser tepi kiri, bukan tinggi kotak), jadi menuntutnya mendarat di kursor pada
 * kedua sumbu akan menuduh perilaku yang benar: sempat terukur Δy 151px di situ, dan itu bukan
 * cacat. Untuk tool 1-2 titik, ujung-ujungnya sendiri sudah jadi sudut bbox.
 */
function cornerIndex(pts) {
  const P = pts.filter(Boolean);
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const isCorner = (p) =>
    (Math.abs(p.x - minX) < 1 || Math.abs(p.x - maxX) < 1) && (Math.abs(p.y - minY) < 1 || Math.abs(p.y - maxY) < 1);
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i] && isCorner(pts[i])) return i;   // dari belakang: ujung terakhir dulu
  return pts.length - 1;
}

/** Pilih objek dulu: handle titik hanya muncul saat objek di-hover/terpilih. */
async function selectObject(page, obj, rect) {
  const spot = await hoverableSpot(page, obj, rect);
  expect(spot, `objek ${obj.name} tak bisa di-hover di titik mana pun → tak bisa di-drag`).toBeTruthy();
  await clickAt(page, rect, spot);
  await expect.poll(async () => page.evaluate((id) => selectedId === id, obj.id), { timeout: 3000 }).toBe(true);
  return spot;
}

/**
 * Pixel di BADAN objek: bisa di-hover, tapi ≥14px dari SEMUA handle titik — kalau tidak, yang
 * tertarik nanti satu titik, bukan badannya (jebakan ini sempat memerahkan `trendline` sendiri).
 * Kandidat diurut dari yang paling mungkin badan: midpoint antar titik → tepi/pusat bbox →
 * geseran sepanjang garis (untuk tool 1-titik yang garisnya tak terbatas).
 */
async function bodySpot(page, obj, rect, pts) {
  const pw = await plotWidth(page);
  const P = pts.filter(Boolean);
  const cands = [];
  for (let i = 0; i < P.length - 1; i++) cands.push({ x: (P[i].x + P[i + 1].x) / 2, y: (P[i].y + P[i + 1].y) / 2 });
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  cands.push({ x: cx, y: cy }, { x: Math.min(...xs), y: cy }, { x: Math.max(...xs), y: cy }, { x: cx, y: Math.min(...ys) }, { x: cx, y: Math.max(...ys) });
  for (const d of [120, -120, 200, -200]) {
    cands.push({ x: P[0].x + d, y: P[0].y });
    cands.push({ x: P[0].x, y: P[0].y + d });
  }

  for (const c of cands) {
    const far = P.every((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) >= 14);
    const inside = c.x > 6 && c.x < pw - 6 && c.y > 6 && c.y < rect.height - 6;
    if (!far || !inside) continue;
    await page.mouse.move(rect.x + c.x, rect.y + c.y, { steps: 3 });
    if (await page.evaluate((id) => hoverId === id, obj.id)) return c;
  }
  return null;
}

/** Tekan-geser-lepas dari `from` ke `to` (koordinat container-relative). */
async function drag(page, rect, from, to) {
  await page.mouse.move(rect.x + from.x, rect.y + from.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(rect.x + (from.x + to.x) / 2, rect.y + (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('drag setelah objek jadi — titik', () => {
  for (const spec of DRAGGABLE) {
    test(`${spec.name}: titik yang diseret mendarat di kursor`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      expect(obj, `${spec.name} tak tergambar`).toBeTruthy();

      const before = await toPixels(page, obj.points);
      await selectObject(page, obj, rect);

      const from = before[cornerIndex(before)];
      const sp = await barSpace(page);
      const to = { x: await halfBarOffX(page, from.x + 84, sp), y: from.y + 52 };
      await drag(page, rect, from, to);

      const after = await toPixels(page, (await overlays(page))[0].points);
      // Titik mana yang benar-benar diseret: yang paling jauh bergeser dari posisi awal.
      // (Objek yang mengembang — rect/fib3 8 titik — punya titik turunan yang ikut berubah.)
      let moved = 0, best = -1;
      after.forEach((p, k) => {
        if (!p || !before[k]) return;
        const d = Math.abs(p.x - before[k].x) + Math.abs(p.y - before[k].y);
        if (d > best) { best = d; moved = k; }
      });
      expect(best, `${spec.name}: tak ada titik yang bergerak — drag tak tertangkap`).toBeGreaterThan(20);

      const tx = tolX(spec, sp);
      expect(Math.abs(after[moved].x - to.x), `${spec.name}: titik tak mendarat di kursor (X, toleransi ${tx}px, ½bar=${sp / 2}px)`).toBeLessThanOrEqual(tx);
      expect(Math.abs(after[moved].y - to.y), `${spec.name}: titik tak mendarat di kursor (Y)`).toBeLessThanOrEqual(TOL_Y_PX);
      assertNoPageErrors(page);
    });
  }
});

test.describe('drag setelah objek jadi — badan', () => {
  for (const spec of BODY_DRAGGABLE) {
    test(`${spec.name}: badan bergeser sebesar gerakan kursor`, async ({ page }) => {
      await gotoApp(page);
      const { obj, rect } = await drawTool(page, spec.name);
      expect(obj, `${spec.name} tak tergambar`).toBeTruthy();

      const before = await toPixels(page, obj.points);
      await selectObject(page, obj, rect);
      const grab = await bodySpot(page, obj, rect, before);
      expect(grab, `${spec.name}: tak ada pixel badan yang bisa di-hover ≥14px dari handle (masuk BODY_SKIP?)`).toBeTruthy();

      // Untuk drag badan yang menentukan bukan posisi absolut target, tapi BESAR geserannya:
      // translasi yang di-snap membulatkan Δ ke jumlah bar bulat. Jadi Δx dibuat "sejumlah bar
      // bulat + ½ bar" → tool yang men-snap pasti meleset ½ barSpace, tak tergantung di mana
      // titik grab-nya kebetulan berada. (Versi pertama spec ini memakai target absolut
      // setengah-bar; hasilnya beda-beda antara fixture & server nyata semata karena grab.x
      // berbeda — bukan karena aplikasinya berbeda.)
      const sp = await barSpace(page);
      const move = { dx: Math.round(70 / sp) * sp + sp / 2, dy: 44 };
      await drag(page, rect, grab, { x: grab.x + move.dx, y: grab.y + move.dy });

      const after = await toPixels(page, (await overlays(page))[0].points);
      const tx = tolX(spec, sp);
      let anyMoved = false;
      for (let k = 0; k < before.length; k++) {
        if (!before[k] || !after[k]) continue;
        const dx = after[k].x - before[k].x, dy = after[k].y - before[k].y;
        if (Math.abs(dx) + Math.abs(dy) > 20) anyMoved = true;
        expect(Math.abs(dx - move.dx), `${spec.name}: titik #${k} tak bergeser sebesar kursor (X, toleransi ${tx}px)`).toBeLessThanOrEqual(tx);
        expect(Math.abs(dy - move.dy), `${spec.name}: titik #${k} tak bergeser sebesar kursor (Y)`).toBeLessThanOrEqual(TOL_Y_PX);
      }
      expect(anyMoved, `${spec.name}: badan diseret tapi tak ada titik yang pindah`).toBe(true);
      assertNoPageErrors(page);
    });
  }
});

test.describe('cakupan drag', () => {
  test('daftar pengecualian tetap eksplisit & beralasan', async () => {
    // Bukan assertion perilaku — penjaga agar pengecualian tak diam-diam bertambah.
    expect(Object.keys(DRAG_SKIP).sort()).toEqual(['longPosition', 'shortPosition', 'simpleAnnotation', 'simpleTag']);
    expect(Object.keys(BODY_SKIP).sort()).toEqual(['arrowMarkDown', 'arrowMarkUp', 'text']);
    expect(DRAGGABLE.length, 'tool yang diuji drag titik').toBe(TOOL_SPEC.length - 4);
    expect(BODY_DRAGGABLE.length, 'tool yang diuji drag badan').toBe(TOOL_SPEC.length - 7);
    console.log(`  drag titik: ${DRAGGABLE.length} tool · drag badan: ${BODY_DRAGGABLE.length} tool`);
  });
});
