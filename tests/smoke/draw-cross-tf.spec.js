// Presisi posisi X objek gambar LINTAS timeframe.
//
// Kenapa file ini ada. Keluhan 2026-11-19: rectangle digambar di Monthly tepat di kiri candle
// bulan B (tak menyentuh candle mana pun), tapi di Daily/Weekly sisi kirinya mundur ke tengah
// bulan A sehingga "nempel" ke candle-candle bulan A. Trendline mengalami hal serupa.
//
// Akar masalahnya pemetaan piksel → waktu. Dulu titik pecahan dipetakan LINEAR antar waktu-BUKA
// dua bar tetangga (pusat bar k = open_k). Akibatnya separuh-KIRI slot candle B berwaktu < open_B,
// yaitu periode bulan A — padahal di layar titik itu jelas "milik" candle B. Di TF kecil waktu itu
// jatuh di tengah bulan A.
//
// Pemetaan SLOT: bar k menempati indeks [k-½, k+½) ↔ waktu [open_k, open_{k+1}). Apa yang tampak di
// bawah kursor pada TF mana pun = periode waktu yang sama di TF lain.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

const ms = (iso) => Date.parse(iso);
// Jangkar bar bulanan OANDA nyata (lihat tests/smoke/monthly-bars.spec.js).
const MN = [
  '2025-07-31T21:00:00Z', '2025-08-31T21:00:00Z', '2025-09-30T21:00:00Z', '2025-10-31T21:00:00Z',
  '2025-11-30T22:00:00Z', '2025-12-31T22:00:00Z', '2026-01-31T22:00:00Z', '2026-02-28T22:00:00Z',
  '2026-03-31T21:00:00Z', '2026-04-30T21:00:00Z', '2026-05-31T21:00:00Z', '2026-06-30T21:00:00Z',
].map((iso) => ({ timestamp: ms(iso) }));
// Bar harian sintetis 22:00Z tiap hari, menutupi seluruh rentang bulanan di atas.
const DAILY = [];
for (let t = ms('2025-07-31T22:00:00Z'); t < ms('2026-07-31T22:00:00Z'); t += 864e5) DAILY.push({ timestamp: t });

test('lintas TF: titik di kiri candle bulan B tetap di bulan B saat dibuka di Daily', async ({ page }) => {
  await gotoApp(page);
  // Kasus screenshot: titik sedikit di kiri pusat candle B (indeks 7 = bar Maret, buka 28 Feb 22:00Z).
  const r = await page.evaluate(
    ([mn, d]) => {
      const vt = slotTs(mn, 'MN', 6.6);
      const fiD = slotIdx(d, 'D', vt);
      return { vt, barOpenD: d[Math.round(fiD)].timestamp };
    },
    [MN, DAILY]
  );
  expect(r.vt, 'waktu titik harus sudah masuk periode bar B').toBeGreaterThanOrEqual(MN[7].timestamp);
  expect(r.vt).toBeLessThan(MN[8].timestamp);
  expect(r.barOpenD, 'di Daily titik harus jatuh di hari-hari awal bulan B, bukan bulan A').toBeGreaterThanOrEqual(
    MN[7].timestamp - 864e5
  );
  assertNoPageErrors(page);
});

test('lintas TF: pusat candle kasar = tengah periodenya di TF halus', async ({ page }) => {
  await gotoApp(page);
  const vt = await page.evaluate((mn) => slotTs(mn, 'MN', 7), MN);
  const mid = (MN[7].timestamp + MN[8].timestamp) / 2;
  expect(Math.abs(vt - mid)).toBeLessThan(1000);
  assertNoPageErrors(page);
});

test('slotTs ↔ slotIdx saling invers: in-data, bar terakhir, area future', async ({ page }) => {
  await gotoApp(page);
  const xs = [0, 0.3, 3.49, 3.5, 3.51, 7, 10.2, 11, 11.4, 11.5, 12, 14.75];
  const back = await page.evaluate(([mn, xs]) => xs.map((x) => slotIdx(mn, 'MN', slotTs(mn, 'MN', x))), [MN, xs]);
  back.forEach((b, i) => expect(b, `indeks ${xs[i]}`).toBeCloseTo(xs[i], 6));
  // Monoton: indeks lebih kanan → waktu lebih akhir.
  const ts = await page.evaluate(([mn, xs]) => xs.map((x) => slotTs(mn, 'MN', x)), [MN, xs]);
  for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  assertNoPageErrors(page);
});

test('persist: format baru (xm) round-trip presisi; gambar lama tanpa xm tetap di posisinya', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const a = revealed(currentTF);
    const clear = () => { drawIds.slice().forEach((id) => chart.removeOverlay(id)); drawIds.length = 0; };
    clear();
    // Gambar LAMA (sebelum pemetaan slot): vt = waktu-buka bar → dulu tampil di pusat bar 10 & 20.
    buildDrawsFromArray([{ name: 'rect', points: [{ vt: a[10].timestamp, value: 1.1 }, { vt: a[20].timestamp, value: 1.2 }] }]);
    const legacy = chart.getOverlayById(drawIds[0]).points.map((p) => p.dataIndex);
    const saved = serializeDraws();
    clear();
    buildDrawsFromArray(saved);
    const again = chart.getOverlayById(drawIds[0]).points.map((p) => p.dataIndex);
    return { legacy, again, xm: saved[0].xm, bc: saved[0].points[0].bc, vt0: saved[0].points[0].vt, open10: a[10].timestamp };
  });
  expect(r.legacy[0]).toBeCloseTo(10, 6);
  expect(r.legacy[1]).toBeCloseTo(20, 6);
  expect(r.xm, 'serialize menandai format slot').toBe(1);
  expect(r.bc, 'pusat candle ditandai bc').toBe(1);
  expect(r.vt0, 'pusat bar 10 disimpan sbg WAKTU-BUKA bar itu').toBe(r.open10);
  expect(r.again[0]).toBeCloseTo(10, 6);
  expect(r.again[1]).toBeCloseTo(20, 6);
  assertNoPageErrors(page);
});

test('persist: titik magnet (timestamp) tetap terkunci di candle setelah reload', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const a = revealed(currentTF);
    drawIds.slice().forEach((id) => chart.removeOverlay(id)); drawIds.length = 0;
    const id = chart.createOverlay({ name: 'rect', points: [{ timestamp: a[5].timestamp, value: 1.1 }, { dataIndex: 12.3, value: 1.2 }] });
    drawIds.push(id);
    const saved = serializeDraws();
    drawIds.slice().forEach((i) => chart.removeOverlay(i)); drawIds.length = 0;
    buildDrawsFromArray(saved);
    const p = chart.getOverlayById(drawIds[0]).points;
    return { ts: saved[0].points[0].ts, p0: p[0].timestamp, open5: a[5].timestamp, i1: p[1].dataIndex };
  });
  expect(r.ts).toBe(1);
  expect(r.p0, 'titik magnet pulih sbg timestamp candle yg sama').toBe(r.open5);
  expect(r.i1).toBeCloseTo(12.3, 6);
  assertNoPageErrors(page);
});

// Keluhan 2026-11-20: "di H1 aku bikin di candle jam 10:00, saat ke M5 harus presisi di jam 10:00".
// Pusat candle dibawa lewat WAKTU-BUKA bar (barOpenTs), bukan tengah periodenya (slotTs → 10:30, yang
// di M5 malah jatuh di batas dua candle).
const H = 36e5;
const T0 = ms('2026-03-02T00:00:00Z');
const H1 = Array.from({ length: 48 }, (_, i) => ({ timestamp: T0 + i * H }));
const M5 = Array.from({ length: 48 * 12 }, (_, i) => ({ timestamp: T0 + i * 3e5 }));

test('lintas TF: pusat candle H1 10:00 → pusat candle M5 10:00, dan sebaliknya', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(([h1, m5]) => {
    const vt = barOpenTs(h1, 'H1', 10);
    const iM5 = barIdxAt(m5, 'M5', vt);
    // M5 10:35 (indeks 127) kembali ke candle H1 10:00.
    const back = barIdxAt(h1, 'H1', barOpenTs(m5, 'M5', 127));
    // Area future (bar 50 > bar terakhir 47): round-trip tetap bulat di indeks yang sama.
    const fut = barIdxAt(h1, 'H1', barOpenTs(h1, 'H1', 50));
    return { vt, iM5, m5Open: m5[iM5].timestamp, back, fut };
  }, [H1, M5]);
  expect(r.vt).toBe(T0 + 10 * H);
  expect(Number.isInteger(r.iM5), 'di M5 harus tepat di tengah candle (indeks bulat)').toBe(true);
  expect(r.m5Open, 'candle M5 yang dituju = 10:00').toBe(T0 + 10 * H);
  expect(r.back).toBe(10);
  expect(r.fut).toBe(50);
  assertNoPageErrors(page);
});

// Keluhan 2026-11-21: M5 10:10→10:40 dibuka di H1 (keduanya candle 10:00) lalu balik ke M5 tak boleh
// jadi 10:00→10:00. Waktu asli titik diingat (rememberCenterTs) selama candle yang tampak masih
// memuatnya; digeser ke candle lain → ingatan gugur, waktu-buka candle baru yang berlaku.
test('waktu asli titik pusat candle tak hilang saat disimpan dari TF kasar', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const a = revealed(currentTF);
    const clear = () => { drawIds.slice().forEach((id) => chart.removeOverlay(id)); drawIds.length = 0; };
    clear();
    const inside = (k) => a[k].timestamp + Math.floor((a[k + 1].timestamp - a[k].timestamp) / 3);   // "10:10" di dalam candle k
    // Muatan dari TF halus: kedua titik jatuh DI DALAM candle 10 dan 20, bukan di waktu-bukanya.
    buildDrawsFromArray([{ name: 'rect', xm: 1, points: [{ vt: inside(10), value: 1.1, bc: 1 }, { vt: inside(20), value: 1.2, bc: 1 }] }]);
    const id = drawIds[0];
    const shown = chart.getOverlayById(id).points.map((p) => p.dataIndex);
    const saved = serializeDraws()[0].points.map((p) => p.vt);
    // Geser titik-1 ke candle 12 → ingatannya gugur, yang tersimpan waktu-buka candle 12.
    const pts = chart.getOverlayById(id).points.map((p) => ({ ...p }));
    pts[0].dataIndex = 12;
    chart.overrideOverlay({ id, points: pts });
    const moved = serializeDraws()[0].points.map((p) => p.vt);
    return { shown, saved, moved, want: [inside(10), inside(20)], open12: a[12].timestamp };
  });
  expect(r.shown, 'tampil di tengah candle yang memuat waktunya').toEqual([10, 20]);
  expect(r.saved, 'tersimpan dgn waktu ASLI, bukan waktu-buka candle').toEqual(r.want);
  expect(r.moved[0], 'digeser ke candle lain → waktu-buka candle itu').toBe(r.open12);
  expect(r.moved[1], 'titik yg tak disentuh tetap waktu aslinya').toBe(r.want[1]);
  assertNoPageErrors(page);
});
