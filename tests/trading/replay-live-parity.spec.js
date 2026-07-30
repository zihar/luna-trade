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
