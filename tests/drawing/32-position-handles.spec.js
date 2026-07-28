// Handle long/shortPosition: perilaku `posPressedMove` — satu-satunya jalur drag yang punya
// LOGIKA sendiri, dan satu-satunya yang sampai sekarang tak diuji siapa pun.
//
// `31-drag-precision.spec.js` sengaja mengecualikan kedua tool ini (`DRAG_SKIP`) karena yang
// diukur di sana presisi "titik mendarat di kursor". Yang TIDAK terjaga: `posPressedMove`
// menjaga dua invarian yang tak terlihat dari presisi pixel —
//
//   1. titik KEMBAR ikut bergerak (entry di 0&5, pasangan level di 1&3 dan 2&4). Objeknya
//      persegi; menggeser satu pojok tanpa kembarannya menghasilkan bentuk rusak.
//   2. level TAK BOLEH menyeberangi Entry — di-clamp ke Entry (`clamp` di posPressedMove).
//
// Sisi mana yang TP dan mana SL TIDAK diasumsikan di sini: untuk `longPosition` pasangan di ATAS
// Entry adalah TP, untuk `shortPosition` justru SL. Test menurunkannya dari data (pasangan mana
// yang nilainya > Entry), jadi ia menguji invarian handler-nya, bukan pemetaan semantik yang
// kebetulan berlaku di satu arah saja. (Asumsi "indeks 1 selalu TP" sempat memerahkan test ini
// untuk shortPosition — clamp-nya benar, modelnya yang salah.)
//
// Kenapa test ini ada sekarang: `posPressedMove` diserahkan ke `registerOverlay` sebagai NILAI
// (js/overlays-custom.js, registerOverlay long/shortPosition) sementara deklarasinya ada di file
// LAIN yang dimuat belakangan (js/draw-position-tool.js). Dulu keduanya di satu blok & jalan karena
// hoisting satu blok inline; begitu wilayah drawing pindah ke `<script src>` sendiri (PR-6 di
// docs/superpowers/plans/2026-07-28-split-index-js-chunks-800.md), nilainya jadi `undefined` dan
// kedua invarian di atas mati TANPA error — drag posisi berhenti bekerja diam-diam. Penawarnya
// membungkus referensi itu jadi pemanggilan tertunda, dan test inilah yang membuktikan
// pembungkusnya tak mengubah perilaku.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { toPixels } = require('../helpers/chart');
const { drawTool, overlays, hoverableSpot, clickAt } = require('../helpers/draw');

const ENTRY_L = 0, ENTRY_R = 5;

async function drag(page, rect, from, to) {
  await page.mouse.move(rect.x + from.x, rect.y + from.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(rect.x + (from.x + to.x) / 2, rect.y + (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * Buka app, gambar posisi, pilih objeknya. Mengembalikan indeks pojok KANAN yang berada di ATAS
 * Entry beserta kembarannya di kiri (1↔3, 2↔4) — diturunkan dari nilai titik, bukan diasumsikan.
 */
async function placePosition(page, name) {
  await gotoApp(page);
  const { obj, rect } = await drawTool(page, name);
  expect(obj, `${name} tak tergambar`).toBeTruthy();
  expect(obj.points.length, `${name} harus punya 6 titik (entry/level × kiri-kanan)`).toBe(6);

  const spot = await hoverableSpot(page, obj, rect);
  expect(spot, `${name} tak bisa di-hover → tak bisa di-drag`).toBeTruthy();
  await clickAt(page, rect, spot);
  await expect.poll(async () => page.evaluate((id) => selectedId === id, obj.id), { timeout: 3000 }).toBe(true);

  const v = obj.points.map((p) => p.value);
  const entry = v[ENTRY_L];
  const upperR = v[1] > entry ? 1 : 2;   // pojok kanan yang di ATAS entry
  const lowerR = upperR === 1 ? 2 : 1;   // pojok kanan yang di BAWAH entry
  expect(v[upperR], `${name}: tak ada pojok kanan di atas Entry`).toBeGreaterThan(entry);
  expect(v[lowerR], `${name}: tak ada pojok kanan di bawah Entry`).toBeLessThan(entry);

  return { obj, rect, px: await toPixels(page, obj.points), upperR, upperL: upperR + 2, lowerR, lowerL: lowerR + 2, entry };
}

const values = async (page) => (await overlays(page))[0].points.map((p) => p.value);

for (const name of ['longPosition', 'shortPosition']) {
  test(`${name}: menggeser pojok atas menggerakkan titik kembarnya & tak menyentuh Entry`, async ({ page }) => {
    const { rect, px, upperR, upperL, lowerR, entry } = await placePosition(page, name);
    const before = await values(page);

    // Menjauh dari Entry (ke atas) → arah yang sah, tak kena clamp.
    await drag(page, rect, px[upperR], { x: px[upperR].x, y: px[upperR].y - 46 });

    const after = await values(page);
    expect(after[upperR], `${name}: level tak bergerak — drag tak tertangkap handler`).not.toBeCloseTo(before[upperR], 6);
    expect(after[upperR], `${name}: titik kembar (indeks ${upperL}) tak ikut → objek jadi rusak bentuk`).toBeCloseTo(after[upperL], 8);
    expect(after[lowerR], `${name}: level seberang ikut berubah padahal tak digeser`).toBeCloseTo(before[lowerR], 8);
    expect(after[ENTRY_L], `${name}: Entry bergeser padahal yang digeser pojok level`).toBeCloseTo(entry, 8);
    expect(after[ENTRY_R], `${name}: Entry-kanan bergeser padahal yang digeser pojok level`).toBeCloseTo(entry, 8);

    assertNoPageErrors(page);
  });

  // Kedua pojok diuji, bukan cuma satu: kebocoran clamp yang ditemukan test ini bergantung pada
  // slot (`tp` = indeks 1&3, `sl` = 2&4), bukan pada arah geser — jadi tool yang aman untuk satu
  // pojok bisa bocor di pojok seberangnya. Menguji satu sisi saja pernah menyembunyikan setengah
  // dari bug ini.
  for (const side of ['atas', 'bawah']) {
    test(`${name}: level ${side} tak bisa menyeberangi Entry (di-clamp)`, async ({ page }) => {
      const p = await placePosition(page, name);
      const { rect, px, entry } = p;
      const grabR = side === 'atas' ? p.upperR : p.lowerR;
      const grabL = side === 'atas' ? p.upperL : p.lowerL;
      // Diseret melewati Entry ke sisi SEBERANG, bertahap seperti mouse sungguhan — drag satu
      // lompatan besar TIDAK memicu kebocoran (level tak pernah singgah tepat di Entry).
      const target = side === 'atas' ? px[ENTRY_L].y + 92 : px[ENTRY_L].y - 92;

      await drag(page, rect, px[grabR], { x: px[grabR].x, y: target });

      const after = await values(page);
      expect(after[grabR], `${name}: level ${side} menyeberangi Entry — clamp di posPressedMove bocor`).toBeCloseTo(entry, 6);
      expect(after[grabL], `${name}: kembaran level ${side} tak ikut ter-clamp`).toBeCloseTo(entry, 6);
      expect(after[ENTRY_L], `${name}: Entry ikut berpindah saat level di-clamp`).toBeCloseTo(entry, 8);

      assertNoPageErrors(page);
    });
  }
}
