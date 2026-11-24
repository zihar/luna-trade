// Copy/paste & clone untuk SELEKSI GANDA / grup (js/draw-copy-paste.js, cloneSet di js/draw-clone.js):
// semua anggota tersalin sbg satu set dgn posisi relatif utuh; anggota yang sumbernya satu grup
// jadi satu grup BARU; hasil paste terpilih semua. Di smoke karena menyentuh jalur pressed-move
// semua tool (clone) dan clipboard yang dipakai menu klik kanan.
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (follow-up 2)

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

const MOD = 'ControlOrMeta';
const sel = (page) => page.evaluate(() => [...multiSel].sort());

function ptsPx(page, id) {
  return page.evaluate((oid) => chart.getOverlayById(oid).points.map((q) => {
    const a = anchorPx(q); return { x: Math.round(a.x), y: Math.round(a.y) };
  }), id);
}
/** Tiga trendline di pita vertikal 0.25 / 0.5 / 0.75. */
async function drawThree(page) {
  const rect = await chartRect(page);
  const ids = [];
  for (const fy of [0.25, 0.5, 0.75]) {
    const t = await drawTool(page, 'trendline', {
      rect,
      targets: [{ x: Math.round(rect.width * 0.3), y: Math.round(rect.height * fy) },
                { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * (fy + 0.06)) }],
    });
    ids.push(t.obj.id);
  }
  await page.evaluate(() => deselectOverlay());
  await page.waitForTimeout(450);
  return { ids, rect };
}
/** Pilih `ids` sbg seleksi ganda (primer = ids[0]) lewat API seleksi resmi. */
const selectSet = (page, ids) => page.evaluate((xs) => {
  multiSel = new Set(xs); msSetPrimary(xs[0]); msRender();
}, ids);
/** Bentuk relatif: semua titik dikurangi titik ke-1 objek pertama. */
async function shape(page, ids) {
  const all = [];
  for (const id of ids) all.push(await ptsPx(page, id));
  const o = all[0][0];
  return all.map((ps) => ps.map((p) => ({ x: p.x - o.x, y: p.y - o.y })));
}
function expectSameShape(got, want) {
  got.forEach((ps, i) => ps.forEach((p, j) => {
    expect(Math.abs(p.x - want[i][j].x), `objek ${i} titik ${j} X`).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - want[i][j].y), `objek ${i} titik ${j} Y`).toBeLessThanOrEqual(1);
  }));
}

test.describe('multi copy', () => {
  test('Ctrl/⌘+C/V seleksi ganda: semua tersalin, bentuk relatif utuh, grup jadi grup baru, hasil terpilih', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await page.evaluate(([x, y]) => grpCreate([x, y]), [b, c]);
    await selectSet(page, [a, b, c]);
    const want = await shape(page, [a, b, c]);

    await page.evaluate(() => copyOverlay());
    await page.mouse.move(rect.x + rect.width * 0.62, rect.y + rect.height * 0.2);
    await page.keyboard.press(`${MOD}+v`);
    await expect.poll(() => page.evaluate(() => drawIds.length)).toBe(6);

    const fresh = await page.evaluate((old) => drawIds.filter((id) => !old.includes(id)), [a, b, c]);
    expect(await sel(page), 'hasil paste terpilih semua').toEqual([...fresh].sort());
    // urutan salinan = urutan clipboard (primer dulu)
    expectSameShape(await shape(page, fresh), want);
    const p0 = (await ptsPx(page, fresh[0]))[0];
    expect(Math.abs(p0.x - rect.width * 0.62), 'titik ke-1 primer di kursor (X, snap candle)').toBeLessThan(12);

    const g = await page.evaluate((ids) => ids.map(grpOf), fresh);
    expect(g[0], 'a lepas → salinannya lepas').toBeNull();
    expect(g[1]).toBeTruthy();
    expect(g[1], 'b & c satu grup baru').toBe(g[2]);
    expect(g[1], 'bukan grup sumber').not.toBe(await page.evaluate((x) => grpOf(x), b));
    expect(await page.evaluate((x) => grpName[x], g[1])).toBe('Group 2');

    // satu objek: perilaku lama tetap (selectedId = salinan, multiSel hanya dia)
    await page.evaluate((x) => { msClear(); multiSel = new Set([x]); msSetPrimary(x); msRender(); }, a);
    await page.evaluate(() => copyOverlay());
    const one = await page.evaluate(() => pasteOverlayAt(200, 120));
    expect(one).toBeTruthy();
    expect(await page.evaluate(() => drawIds.length)).toBe(7);
    expect(await page.evaluate(() => selectedId)).toBe(one);
    await assertNoPageErrors(page);
  });

  test('Ctrl/⌘+seret anggota seleksi ganda: semua tersalin di tempat, aslinya ikut pindah', async ({ page }) => {
    await gotoApp(page);
    const { ids: [a, b, c], rect } = await drawThree(page);
    await page.evaluate(([x, y]) => grpCreate([x, y]), [a, b]);
    const before = { a: await ptsPx(page, a), b: await ptsPx(page, b), c: await ptsPx(page, c) };

    // klik a → seluruh grup (a,b) terpilih
    const m = before.a;
    const spot = { x: rect.x + m[0].x + (m[1].x - m[0].x) * 0.2, y: rect.y + m[0].y + (m[1].y - m[0].y) * 0.2 };
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await sel(page)).toEqual([a, b].sort());

    await page.waitForTimeout(450);
    await page.keyboard.down(MOD);
    await page.mouse.down();
    await page.mouse.move(spot.x + 80, spot.y + 40, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up(MOD);
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => drawIds.length), 'dua salinan').toBe(5);
    const fresh = await page.evaluate((old) => drawIds.filter((id) => !old.includes(id)), [a, b, c]);
    const shots = [];
    for (const id of fresh) shots.push(await ptsPx(page, id));
    // salinan menempati posisi AWAL a & b (urutan bebas)
    const key = (ps) => JSON.stringify(ps.map((p) => [Math.round(p.x / 2), Math.round(p.y / 2)]));
    expect(shots.map(key).sort()).toEqual([key(before.a), key(before.b)].sort());
    // aslinya pindah, c diam
    expect((await ptsPx(page, a))[0].x - before.a[0].x).toBeGreaterThan(40);
    expect((await ptsPx(page, b))[0].x - before.b[0].x).toBeGreaterThan(40);
    expect(await ptsPx(page, c)).toEqual(before.c);
    // salinan = satu grup baru, berbeda dari grup asli
    const g = await page.evaluate((ids) => ids.map(grpOf), fresh);
    expect(g[0]).toBeTruthy();
    expect(g[0]).toBe(g[1]);
    expect(g[0]).not.toBe(await page.evaluate((x) => grpOf(x), a));
    await assertNoPageErrors(page);
  });
});
