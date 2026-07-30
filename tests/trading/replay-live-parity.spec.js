// Matriks parity order Bar Replay ↔ Live. Bukan bagian gerbang PR (smoke) — ia jalan di
// suite penuh saat push ke main. Yang diuji di sini adalah keputusan yang tak terlihat dari
// tampilan: spread dibayar dua kali, SL/TP divalidasi & dibulatkan, dan grace pasca-entry.
// Spec: docs/superpowers/specs/2026-07-29-replay-live-order-parity-design.md

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
  // setTicket() kedua dalam satu test harus melewatinya.
  if (!(await page.evaluate(() => document.querySelector('#orderForm .op2').classList.contains('expanded')))) {
    await page.click('#op2Expand');
  }
  await page.fill('#lotInput', lots);
  await page.fill('#slPips', slTicks);
  await page.fill('#tpPips', tpTicks);
  if (sl !== (await page.isChecked('#slOn'))) await page.click('#slCard');
  if (tp !== (await page.isChecked('#tpOn'))) await page.click('#tpCard');
}

test('spread dibayar dua kali: P&L tepat setelah buka = -(spread x units)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page);
  await page.click('#execBtn');

  const m = await page.evaluate(() => {
    const p = currentPositions()[0];
    const mid = currentCandle().close;
    return { pnl: p.unrealizedPl, entry: p.entry, price: p.price, mid, half: synthHalfSpread(), units: p.units, dir: p.dir };
  });

  // sell → masuk di bid (mid-½s), dinilai di ask (mid+½s) → jarak = satu spread penuh
  expect(m.dir).toBe('short');
  expect(m.entry).toBeCloseTo(m.mid - m.half, 10);
  expect(m.price).toBeCloseTo(m.mid + m.half, 10);
  expect(m.pnl, 'posisi baru harus minus sebesar spread').toBeLessThan(0);
  expect(Math.abs(m.pnl)).toBeCloseTo(2 * m.half * m.units, 6);

  assertNoPageErrors(page);
});

test('pemicu SL memakai bid untuk long (bukan low mid)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);

  // Fixture candle (tests/fixtures/candles-eurusd-m15.json) berhenti tepat di T saat ini —
  // ArrowRight yang barusan masuk Bar Replay TIDAK memajukan cursor (arr sudah di ujung, tak ada
  // bar berikutnya utk diungkap; step(1) hanya coba autoExtend & berhenti). Supaya ada "bar
  // berikutnya" yang bisa diungkap oleh SATU ArrowRight lagi, mundurkan cursor+frontier satu bar
  // langsung ke state (bukan lewat ArrowLeft/step(-1): itu lempar `ReferenceError: dur is not
  // defined` di js/replay-control.js — bug pra-ada, di luar cakupan task ini; lihat laporan).
  //
  // Posisi long dengan SL PERSIS di (low bar berikutnya − ½ spread): kena kalau pemicunya bid,
  // tak kena kalau pemicunya low mid. Dipasang langsung ke state (bukan lewat tiket UI) supaya
  // harga bisa dipatok tepat relatif ke low bar berikutnya — tiket order tak bisa menyatakan itu.
  // JANGAN "diperbaiki" jadi test berbasis UI: presisi ini hilang begitu SL dihitung dari pips.
  const hit = await page.evaluate(() => {
    const arr = tfData[currentTF];
    const idxLast = arr.length - 1;
    const prevEnd = barEndAt(currentTF, idxLast - 1, arr);
    T = prevEnd; fillT = prevEnd;                // mundur cursor & frontier satu bar (lihat komentar di atas)
    const next = arr[idxLast];                   // bar yang akan diungkap oleh step(1) berikutnya
    const half = synthHalfSpread();
    trades.length = 0;
    trades.push({ id: -99, no: 99, dir: 'long', entry: next.high + 10 * half, sl: next.low - half,
      tp: null, risk: 1, units: 1000, trail: 0, instrument: inst, time: T, fillFrom: T });
    return { sl: trades[0].sl, low: next.low, half };
  });
  expect(hit.sl).toBeCloseTo(hit.low - hit.half, 10);

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => trades.length === 0, null, { timeout: 5000 });

  const j = await page.evaluate(() => journal[journal.length - 1]);
  expect(j.exit, 'exit harus tepat di level SL').toBeCloseTo(hit.sl, 10);

  assertNoPageErrors(page);
});

test('SL ON dengan ticks 0 → posisi terbuka TANPA SL (bukan SL di entry)', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  // Order panel & op2 tersembunyi by default (lihat setTicket() di atas) → buka dulu.
  if (await page.evaluate(() => getComputedStyle(document.getElementById('orderpanel')).display === 'none')) {
    await page.click('#toggleOrder');
  }
  await page.click('#op2Expand');
  await page.fill('#lotInput', '0.10');
  if (!(await page.isChecked('#slOn'))) await page.click('#slCard');
  await page.fill('#slPips', '0');
  await page.click('#execBtn');

  const t = await page.evaluate(() => trades[0]);
  expect(t, 'posisi harus terbuka').toBeTruthy();
  expect(t.sl, 'SL tak boleh diletakkan di entry').toBeNull();
});

test('SL/TP dibulatkan ke desimal instrumen', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { slTicks: '37', tpTicks: '91' });
  await page.click('#execBtn');

  const r = await page.evaluate(() => {
    const t = trades[0], d = priceDecimals();
    return { sl: t.sl, tp: t.tp, slR: +t.sl.toFixed(d), tpR: +t.tp.toFixed(d) };
  });
  expect(r.sl).toBe(r.slR);
  expect(r.tp).toBe(r.tpR);
});

test('SL di dalam spread ditolak dengan pesan yang sama seperti Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await setTicket(page, { tp: false });

  // Arah default tiket = sell. Untuk sell, "di dalam spread" berarti SL <= ask.
  await page.evaluate(() => { window.__badSL = curBidAsk().ask - synthHalfSpread() / 2; });
  const msg = await page.evaluate(() =>
    validateSLTPReplay('short', window.__badSL, null, curBidAsk().bid, curBidAsk().ask)
  );
  expect(msg).toBe('Stop Loss is inside the spread — place it above the Ask price.');

  // Jalur nyata: ubah SL posisi terbuka ke dalam spread → toast error & nilai lama bertahan.
  await page.click('#execBtn');
  const before = await page.evaluate(() => trades[0].sl);
  await page.evaluate(() => savePosLevel(trades[0].id, 'sl', window.__badSL));
  await expect(page.locator('#toast')).toHaveClass(/\bt-error\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText(
    'Stop Loss is inside the spread — place it above the Ask price.'
  );
  expect(await page.evaluate(() => trades[0].sl), 'SL lama harus bertahan').toBeCloseTo(before, 10);
});

test('lot 0 ditolak dengan pesan yang sama seperti Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  // Order panel & op2 tersembunyi by default (lihat setTicket() di atas) → buka dulu.
  if (await page.evaluate(() => getComputedStyle(document.getElementById('orderpanel')).display === 'none')) {
    await page.click('#toggleOrder');
  }
  await page.click('#op2Expand');
  await page.fill('#lotInput', '0');
  await page.click('#execBtn');

  expect(await page.evaluate(() => trades.length)).toBe(0);
  // setStatus(msg, true) tak menulis ke elemen mana pun — ia memanggil toast(msg,'error')
  // (js/load-chart.js). Jadi yang diperiksa toast-nya, bukan bilah status.
  await expect(page.locator('#toast')).toHaveClass(/\bt-error\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText('Lot must be greater than 0.');
});

test('toast buka & tutup memakai format Live', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  // Panel Trades collapsed by default → buka dulu supaya tombol Close di #tpBody "visible".
  if (await page.evaluate(() => document.getElementById('bottompanel').classList.contains('collapsed'))) {
    await page.click('#toggleTrades');
  }
  await setTicket(page);
  await page.click('#execBtn');

  await expect(page.locator('#toast')).toHaveClass(/\bt-success\b/);
  await expect(page.locator('#toast .toast-msg')).toHaveText(/^SELL 0\.10 lot .+ @ /);

  await page.click('#tpBody button[data-act="close"]');
  await expect(page.locator('#toast .toast-msg')).toHaveText(/^Closed #1 {2}[-+]\$/);
});
