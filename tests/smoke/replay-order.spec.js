// Order di Bar Replay: sampai sekarang TAK ada satu pun test yang menyentuh jalur ini,
// padahal ia jalur eksekusi lengkap (buka posisi → garis+pill on-chart → tabel → close).
// Test ini gerbang PR untuk parity replay↔Live; matriks dalamnya ada di
// tests/trading/replay-live-parity.spec.js (suite penuh, jalan saat push main).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

/** Masuk Bar Replay lewat jalur UI nyata: ArrowRight → step(1) (js/keyboard.js). */
async function enterReplay(page) {
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => typeof replayMode !== 'undefined' && replayMode === true);
}

/**
 * Isi tiket order lewat kontrol nyata. #slPips/#tpPips/#slOn/#tpOn hidup di blok
 * `.op-expand` yang tersembunyi di mode simple → panel harus di-expand dulu.
 * Order panel sendiri hidden by default (localStorage br_orderHidden belum di-set) → buka
 * lewat rail #toggleOrder dulu, kalau tidak #op2Expand tak pernah "visible" bagi Playwright.
 */
async function setTicket(page, { lots = '0.10', slTicks = '100', tpTicks = '200', sl = true, tp = true } = {}) {
  if (await page.evaluate(() => getComputedStyle(document.getElementById('orderpanel')).display === 'none')) {
    await page.click('#toggleOrder');
  }
  // #op2Expand hidup di .op-simple, yang disembunyikan begitu .op2 sudah "expanded" — panggilan
  // setTicket() kedua dalam satu test (mis. ganti lot utk posisi berikutnya) harus melewatinya.
  if (!(await page.evaluate(() => document.querySelector('#orderForm .op2').classList.contains('expanded')))) {
    await page.click('#op2Expand');
  }
  await page.fill('#lotInput', lots);
  await page.fill('#slPips', slTicks);
  await page.fill('#tpPips', tpTicks);
  if (sl !== (await page.isChecked('#slOn'))) await page.click('#slCard');
  if (tp !== (await page.isChecked('#tpOn'))) await page.click('#tpCard');
}

/** Jumlah posisi replay menurut state aplikasi sendiri. */
const posCount = (page) => page.evaluate(() => trades.length);

test('replay order: buka satu posisi → garis+pill on-chart, satu baris tabel', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  // Panel Trades (tabel Positions) collapsed by default (localStorage br_bottomHidden belum
  // di-set) → buka dulu supaya tombol Close di dalamnya "visible" bagi Playwright.
  if (await page.evaluate(() => document.getElementById('bottompanel').classList.contains('collapsed'))) {
    await page.click('#toggleTrades');
  }
  await setTicket(page);

  await page.click('#execBtn');

  expect(await posCount(page), 'posisi replay tak terbuka').toBe(1);
  await expect(page.locator('#tpNPos')).toHaveText('1');
  await expect(page.locator('#tpBody tr'), 'tabel Positions harus 1 baris').toHaveCount(1);

  // Pill P&L + garis SL & TP milik posisi itu ada di layer on-chart.
  await expect(page.locator('#posLayer .pos-node.entry .pos-pill')).toHaveCount(1);
  await expect(page.locator('#posLayer .pos-node.sl')).toHaveCount(1);
  await expect(page.locator('#posLayer .pos-node.tp')).toHaveCount(1);

  // Tutup dari tabel → posisi hilang, jurnal bertambah.
  await page.click('#tpBody button[data-act="close"]');
  expect(await posCount(page)).toBe(0);
  expect(await page.evaluate(() => journal.length)).toBe(1);

  assertNoPageErrors(page);
});

test('replay order: dua posisi hidup bersamaan, masing-masing bisa ditutup', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  // Panel Trades collapsed by default → buka dulu supaya tombol Close di baris kedua "visible".
  if (await page.evaluate(() => document.getElementById('bottompanel').classList.contains('collapsed'))) {
    await page.click('#toggleTrades');
  }
  await setTicket(page, { lots: '0.10' });

  await page.click('#execBtn');
  await setTicket(page, { lots: '0.20' });
  await page.click('#execBtn');   // dulu ditolak diam-diam oleh guard 1-posisi

  expect(await posCount(page), 'posisi kedua tak terbuka').toBe(2);
  await expect(page.locator('#tpNPos')).toHaveText('2');
  await expect(page.locator('#tpBody tr')).toHaveCount(2);
  // dua pill P&L terpisah di chart
  await expect(page.locator('#posLayer .pos-node.entry .pos-pill')).toHaveCount(2);

  // Tutup baris pertama saja → sisa satu, dan yang tersisa adalah posisi 0.20 lot.
  const firstId = await page.evaluate(() => trades[0].id);
  await page.click(`#tpBody button[data-act="close"][data-id="${firstId}"]`);
  expect(await posCount(page)).toBe(1);
  expect(await page.evaluate(() => trades[0].units)).toBe(0.2 * 100000);

  assertNoPageErrors(page);
});

test('replay order: header tabel Positions sama dengan Live (8 kolom, SL / TP gabung)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  const head = page.locator('#tpHead th');
  await expect(head).toHaveCount(8);
  await expect(head.nth(4)).toHaveText('SL / TP');

  assertNoPageErrors(page);
});
