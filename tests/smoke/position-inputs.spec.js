// Long/Short Position — setelan akun/risiko per objek (tab Inputs ala TradingView).
// Hitungan murni (posCalc, applyPosEntry, applyPosTicks, …) di js/draw-position-inputs.js;
// setelan disimpan di objStyle[id] supaya ikut persist/sync/clone.
// Di smoke karena ia MENULIS ke points objek posisi & ke objStyle.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool, overlays } = require('../helpers/draw');

async function place(page, name = 'longPosition') {
  await gotoApp(page);
  const { obj } = await drawTool(page, name);
  expect(obj, `${name} tak tergambar`).toBeTruthy();
  return obj;
}
const vals = async (page) => (await overlays(page))[0].points.map((p) => p.value);

test('posCalc: qty dari risk 1% akun 10000', async ({ page }) => {
  const obj = await place(page);
  const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
    setPosSettings(o, { account: 10000, risk: 1, riskUnit: '%', lot: 100000 }); return posCalc(o); }, obj.id);
  expect(r.riskUsd).toBeCloseTo(100, 6);
  expect(r.qtyUnits).toBeCloseTo(100 / Math.abs(r.entry - r.sl), 3);
  expect(r.qtyLots).toBeCloseTo(r.qtyUnits / 100000, 9);
  expect(r.pnlSl).toBeCloseTo(-100, 4);
  expect(r.pnlTp).toBeCloseTo(r.qtyUnits * Math.abs(r.tp - r.entry), 4);
  expect(r.rr).toBeCloseTo(Math.abs(r.tp - r.entry) / Math.abs(r.entry - r.sl), 6);
  assertNoPageErrors(page);
});

test('setPosSettings menolak account/risk ≤0 & NaN, qtyPrec di luar 0–8', async ({ page }) => {
  const obj = await place(page);
  const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
    setPosSettings(o, { account: 10000, risk: 1 });
    const res = [{ account: 0 }, { account: -5 }, { account: NaN }, { risk: 0 }, { risk: 'x' }, { lot: 0 },
      { riskUnit: 'EUR' }, { qtyPrec: 9 }, { qtyPrec: 1.5 }].map((p) => setPosSettings(o, p));
    return { res, s: posSettings(o) }; }, obj.id);
  expect(r.res.every((x) => x === false)).toBe(true);
  expect(r.s.account).toBe(10000); expect(r.s.risk).toBe(1); expect(r.s.riskUnit).toBe('%');
  assertNoPageErrors(page);
});

test('convertRisk: 1% dari 10000 = 100 USD dan balik', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => [convertRisk(1, '%', 'USD', 10000), convertRisk(100, 'USD', '%', 10000), convertRisk(2, '%', '%', 10000)]);
  expect(r[0]).toBeCloseTo(100, 9); expect(r[1]).toBeCloseTo(1, 9); expect(r[2]).toBe(2);
});

for (const name of ['longPosition', 'shortPosition']) {
  test(`${name}: applyPosEntry menggeser TP/SL dengan jarak tetap`, async ({ page }) => {
    const obj = await place(page, name);
    const b = await vals(page);
    const ok = await page.evaluate(({ id, v }) => applyPosEntry(chart.getOverlayById(id), v), { id: obj.id, v: b[0] + 0.001 });
    expect(ok).toBe(true);
    const a = await vals(page);
    for (let i = 0; i < 6; i++) expect(a[i]).toBeCloseTo(b[i] + 0.001, 6);
    assertNoPageErrors(page);
  });

  test(`${name}: applyPosTicks — 50 tick = entry ± 50·tick; 0/1.5/-3 ditolak`, async ({ page }) => {
    const obj = await place(page, name);
    const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
      const bad = [0, 1.5, -3, NaN].map((n) => applyPosTicks(o, 'tp', n));
      const ok = [applyPosTicks(o, 'tp', 50), applyPosTicks(o, 'sl', 20)];
      return { bad, ok, tick: posTickSize(), lv: posLevels(o) }; }, obj.id);
    const long = name === 'longPosition';
    expect(r.bad.every((x) => x === false)).toBe(true);
    expect(r.ok).toEqual([true, true]);
    expect(r.lv.tp).toBeCloseTo(r.lv.entry + (long ? 1 : -1) * 50 * r.tick, 8);
    expect(r.lv.sl).toBeCloseTo(r.lv.entry - (long ? 1 : -1) * 20 * r.tick, 8);
    assertNoPageErrors(page);
  });
}

test('applyPosEntry menolak hasil level ≤ 0 & bukan angka', async ({ page }) => {
  const obj = await place(page, 'longPosition');
  const b = await vals(page);
  const r = await page.evaluate(({ id, e, sl }) => { const o = chart.getOverlayById(id);
    return [applyPosEntry(o, e - sl), applyPosEntry(o, NaN), applyPosEntry(o, -1)]; }, { id: obj.id, e: b[0], sl: b[2] });
  expect(r).toEqual([false, false, false]);
  expect(await vals(page)).toEqual(b);
});

test('default terakhir dipakai: posisi baru mewarisi account & risk', async ({ page }) => {
  const obj = await place(page);
  await page.evaluate((id) => setPosSettings(chart.getOverlayById(id), { account: 5000, risk: 50, riskUnit: 'USD' }), obj.id);
  const { obj: o2 } = await drawTool(page, 'shortPosition');
  const s = await page.evaluate((id) => posSettings(chart.getOverlayById(id)), o2.id);
  expect(s.account).toBe(5000); expect(s.risk).toBe(50); expect(s.riskUnit).toBe('USD');
});

test('posDefaultLot per instrumen', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => ['EUR_USD', 'USD_JPY', 'XAU_USD', 'XAG_USD', 'BTC_USD', 'SPX500_USD', 'BCO_USD'].map((i) => posDefaultLot(i)));
  expect(r).toEqual([100000, 100000, 100, 100, 1, 1, 1]);
});

test('lot terakhir dipakai disimpan per instrumen', async ({ page }) => {
  const obj = await place(page);
  const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
    setPosSettings(o, { lot: 1000 });
    const d = JSON.parse(localStorage.getItem('luna_pos_defaults') || '{}');
    return { lotMap: d.lot, xau: posDefaultLot('XAU_USD') }; }, obj.id);
  expect(r.lotMap).toEqual({ EUR_USD: 1000 });
  expect(r.xau).toBe(100);
});

// ---------- tab Inputs di modal ----------
async function openInputs(page, name = 'longPosition') {
  const obj = await place(page, name);
  await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 200, 'levels'), obj.id);
  await expect(page.locator('.dmodal-scrim.show #ppAcc')).toBeVisible();
  return obj;
}
const commitField = async (page, sel, v) => { const i = page.locator(sel); await i.fill(String(v)); await i.press('Enter'); };

test('tab Inputs: label & default dari #balance/#riskPct', async ({ page }) => {
  await openInputs(page);
  await expect(page.locator('.dm-tab[data-tab="levels"]')).toHaveText('Inputs');
  const d = await page.evaluate(() => ({ bal: $('#balance').value, risk: $('#riskPct').value }));
  expect(+(await page.locator('#ppAcc').inputValue())).toBe(+d.bal);
  expect(+(await page.locator('#ppRisk').inputValue())).toBe(+d.risk);
  await expect(page.locator('#ppRiskUnit')).toHaveValue('%');
  for (const id of ['#ppLot', '#ppEntry', '#ppTpTicks', '#ppTp', '#ppSlTicks', '#ppSl', '#ppQtyPrec', '#ppQty'])
    await expect(page.locator(id)).toHaveCount(1);
  assertNoPageErrors(page);
});

test('tab Inputs: TP ticks ↔ price saling menyegarkan', async ({ page }) => {
  await openInputs(page);
  const { tick, dec } = await page.evaluate(() => ({ tick: posTickSize(), dec: priceDecimals() }));
  const entry = (await vals(page))[0];
  await commitField(page, '#ppTpTicks', 50);
  const p = await vals(page);
  expect(p[1]).toBeCloseTo(entry + 50 * tick, 8); expect(p[3]).toBeCloseTo(entry + 50 * tick, 8);
  await expect(page.locator('#ppTp')).toHaveValue((entry + 50 * tick).toFixed(dec));
  const tp = +(entry + 80 * tick).toFixed(dec);
  await commitField(page, '#ppTp', tp);
  await expect(page.locator('#ppTpTicks')).toHaveValue(String(Math.round(Math.abs(tp - entry) / tick)));
  assertNoPageErrors(page);
});

test('tab Inputs: Entry menggeser semua titik, ticks tetap', async ({ page }) => {
  await openInputs(page);
  const b = await vals(page);
  const tpT = await page.locator('#ppTpTicks').inputValue(), slT = await page.locator('#ppSlTicks').inputValue();
  await commitField(page, '#ppEntry', +(b[0] + 0.001).toFixed(6));
  const a = await vals(page), d = a[0] - b[0];
  expect(d).toBeCloseTo(0.001, 5);
  for (let i = 0; i < 6; i++) expect(a[i] - b[i]).toBeCloseTo(d, 9);
  await expect(page.locator('#ppTpTicks')).toHaveValue(tpT);
  await expect(page.locator('#ppSlTicks')).toHaveValue(slT);
});

test('tab Inputs: ganti unit risk mengonversi angka; account 0 ditolak', async ({ page }) => {
  await openInputs(page);
  await commitField(page, '#ppAcc', 10000);
  await commitField(page, '#ppRisk', 1);
  await page.locator('#ppRiskUnit').selectOption('USD');
  await expect(page.locator('#ppRisk')).toHaveValue('100');
  await commitField(page, '#ppAcc', 0);
  await expect(page.locator('#ppAcc')).toHaveClass(/bad/);
  await expect(page.locator('#ppAcc')).toHaveValue('10000');
  assertNoPageErrors(page);
});

test('tab Inputs: Qty precision mengubah readout Qty', async ({ page }) => {
  await openInputs(page);
  await commitField(page, '#ppQtyPrec', 4);
  await expect(page.locator('#ppQty')).toHaveText(/^Qty \d+\.\d{4} lot$/);
  assertNoPageErrors(page);
});

// ---------- label pill di chart ----------
for (const name of ['longPosition', 'shortPosition']) {
  test(`${name}: posPillTexts memuat Qty, P&L nominal & RR`, async ({ page }) => {
    const obj = await place(page, name);
    const r = await page.evaluate((id) => { const o = chart.getOverlayById(id);
      setPosSettings(o, { account: 10000, risk: 1, riskUnit: '%', lot: 100000, qtyPrec: 2 });
      return { t: posPillTexts(o), c: posCalc(o) }; }, obj.id);
    expect(r.t.stop).toContain('-$100.00');
    expect(r.t.target).toContain('+$' + r.c.pnlTp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(r.t.center).toContain('Qty ' + r.c.qtyLots.toFixed(2) + ' lot');
    expect(r.t.center).toContain('RR 1:' + r.c.rr.toFixed(2));
    expect(r.t.center).toContain(name === 'longPosition' ? 'LONG' : 'SHORT');
    assertNoPageErrors(page);
  });
}
