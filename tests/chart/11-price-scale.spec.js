// Skala harga lewat scroll wheel di sumbu Y.
//
// Sebelumnya skala harga cuma bisa lewat klik-drag di sumbu; wheel di sumbu tak melakukan
// apa-apa (KLineCharts `mouseWheelVertEvent` hanya melayani widget MAIN → zoom waktu).
//
// Yang dipatok test ini tiga invarian, bukan mekanismenya:
//   1. wheel di sumbu mengubah rentang harga viewport, dua arah, dan bolak-balik pulang.
//   2. besar langkahnya SAMA di mana pun kursor secara vertikal. Ini regresi utama: KLineCharts
//      menghitung skala drag sumbu dari rasio pageY ABSOLUT (`range × pageY_kini/pageY_awal`),
//      jadi delta pixel tetap berarti ~14% di dekat atas layar tapi ~2% di dekat bawah — itu
//      "loncat" yang dulu bikin jalur ini dicabut (js/theme.js pra-#161).
//   3. wheel di area plot tetap murni zoom-waktu: skala harga yang sudah dikunci pengguna tak
//      boleh ikut bergeser (dulu zona 70px tebakan di kanan diam-diam jadi skala harga).

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, fromPixel, plotWidth, barSpaceApi } = require('../helpers/chart');

/**
 * Rentang harga yang tampak di pane candle.
 *
 * Diukur lewat converter chart di dua ketinggian tetap, jadi nilainya proporsional dengan
 * range sumbu Y — cukup untuk membandingkan RASIO sebelum/sesudah tanpa menyentuh internal.
 */
async function priceSpan(page) {
  const rect = await chartRect(page);
  const top = await fromPixel(page, 40, 20);
  const bottom = await fromPixel(page, 40, Math.round(rect.height) - 20);
  return top.value - bottom.value;
}

/** Titik viewport di tengah SUMBU harga, pada ketinggian y (container-relative). */
async function axisPoint(page, y) {
  const rect = await chartRect(page);
  const pw = await plotWidth(page);
  return { x: rect.x + (pw + rect.width) / 2, y: rect.y + y };
}

/** Titik viewport di dalam area plot. */
async function plotPoint(page, fx, fy) {
  const rect = await chartRect(page);
  const pw = await plotWidth(page);
  return { x: rect.x + pw * fx, y: rect.y + rect.height * fy };
}

/** Satu event wheel di titik tertentu, lalu tunggu chart selesai render. */
async function wheelAt(page, pt, deltaY) {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.wheel(0, deltaY);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('scroll di sumbu harga meregang & memampatkan skala, dan pulang saat dibalik', async ({ page }) => {
  await gotoApp(page);
  const pt = await axisPoint(page, 300);

  const span0 = await priceSpan(page);
  await wheelAt(page, pt, -100); // scroll atas = meregang → rentang harga MENGECIL
  const span1 = await priceSpan(page);
  expect(span1).toBeLessThan(span0 * 0.99);

  await wheelAt(page, pt, 100); // scroll bawah = memampatkan → kembali ke rentang awal
  const span2 = await priceSpan(page);
  expect(Math.abs(span2 / span0 - 1)).toBeLessThan(0.01);

  assertNoPageErrors(page);
});

test('besar langkah skala sama di mana pun kursor secara vertikal', async ({ page }) => {
  await gotoApp(page);
  const rect = await chartRect(page);

  const before1 = await priceSpan(page);
  await wheelAt(page, await axisPoint(page, 120), -100);
  const ratioAtas = (await priceSpan(page)) / before1;

  const before2 = await priceSpan(page);
  await wheelAt(page, await axisPoint(page, Math.round(rect.height) - 120), -100);
  const ratioBawah = (await priceSpan(page)) / before2;

  // Keduanya harus benar-benar berubah (kalau tak ada efek, rasio 1 dan perbandingannya lolos palsu).
  expect(ratioAtas).toBeLessThan(0.99);
  expect(ratioBawah).toBeLessThan(0.99);
  expect(Math.abs(ratioAtas / ratioBawah - 1)).toBeLessThan(0.02);

  assertNoPageErrors(page);
});

// Langkah wheel HALUS (trackpad macOS mengirim deltaY ~2–15 per event, bukan 100). Tiap notch
// disintesis sebagai gesture mousedown→mousemove→mouseup tersendiri, dan KLineCharts membuang
// `pressedMouseMoveEvent` yang jarak manhattan-nya < 5px dari mousedown — jadi langkah kecil dulu
// hilang tanpa efek. Lebih buruk: gesture yang gerakannya dibuang tetap terhitung CLICK, dan dua
// click < 500ms di sumbu = double-click = KLineCharts mengembalikan AUTO-SCALE — zoom yang sudah
// didapat pengguna dibatalkan. Dua test di bawah memaku kedua sisi itu.
test('banyak langkah wheel halus terakumulasi jadi skala, tak hilang', async ({ page }) => {
  await gotoApp(page);
  const pt = await axisPoint(page, 300);

  const span0 = await priceSpan(page);
  for (let i = 0; i < 25; i++) await wheelAt(page, pt, -8); // 25 × 0.08 notch = 2 notch

  const ratio = (await priceSpan(page)) / span0;
  const ideal = Math.pow(1 / 1.05, 2); // 0.907
  expect(ratio).toBeGreaterThan(ideal * 0.98); // tak boleh MELEBIHI niat pengguna
  expect(ratio).toBeLessThan(0.94); // dan harus benar-benar sampai (dulu: ~1.0 atau balik ke auto)

  assertNoPageErrors(page);
});

test('langkah wheel halus tak pernah mengembalikan auto-scale', async ({ page }) => {
  await gotoApp(page);
  const pt = await axisPoint(page, 300);

  const auto = await priceSpan(page);
  await wheelAt(page, pt, -100); // kunci skala manual
  const locked = await priceSpan(page);
  expect(locked).toBeLessThan(auto * 0.99);

  await wheelAt(page, pt, -8); // dua langkah kecil berurutan: dulu = double-click → auto-scale
  await wheelAt(page, pt, -8);

  const after = await priceSpan(page);
  expect(after).toBeLessThan(auto * 0.99); // masih terkunci manual, tidak pulang ke auto-fit
  expect(after).toBeLessThanOrEqual(locked * 1.001); // dan tak melebar balik

  assertNoPageErrors(page);
});

// HALUS, bukan cuma "sampai". Dua test di atas hanya menjamin niat pengguna akhirnya terlayani;
// keduanya diam soal BAGAIMANA jalannya. Jalur lama menyintesis satu gesture drag per notch, dan
// KLineCharts membuang gesture yang jarak manhattan-nya < 5px — jadi langkah trackpad ditahan
// sampai geseran implisitnya ≥ 6px lalu dilepas sekaligus. TERUKUR di jalur lama: hanya 5–20%
// event wheel yang mengubah skala, masing-masing meloncat 1,6–5,4%; zoom-waktu di area plot
// menerapkan 100% event dengan langkah 0,6%. Itulah "bergetar"-nya. Dua test berikut memaku
// selisih itu, bukan mekanismenya.
test('tiap langkah trackpad diterapkan, tanpa loncatan', async ({ page }) => {
  await gotoApp(page);
  const pt = await axisPoint(page, 300);

  const seq = [await priceSpan(page)];
  for (let i = 0; i < 20; i++) {
    await wheelAt(page, pt, -6); // trackpad macOS: deltaY kecil, bukan 100
    seq.push(await priceSpan(page));
  }

  const steps = seq.slice(1).map((v, i) => v / seq[i]);
  const applied = steps.filter((r) => Math.abs(r - 1) > 1e-9).length;
  expect(applied).toBeGreaterThanOrEqual(18); // jalur lama: 4 dari 20

  // 20 × 0,06 notch = 0,29% per langkah. Ambang 2% cuma menolak "ditahan lalu dilepas".
  const worst = Math.max(...steps.map((r) => Math.abs(Math.log(r))));
  expect(worst).toBeLessThan(Math.log(1.02));

  assertNoPageErrors(page);
});

test('total skala sama dengan niat pengguna, di ketinggian kursor mana pun', async ({ page }) => {
  await gotoApp(page);
  const rect = await chartRect(page);

  const run = async (y) => {
    const pt = await axisPoint(page, y);
    const before = await priceSpan(page);
    for (let i = 0; i < 20; i++) await wheelAt(page, pt, -6);
    return (await priceSpan(page)) / before;
  };

  const ideal = Math.pow(1 / 1.05, 20 * 0.06); // 0,9441

  // Dekat ATAS: ambang 6px dulu berarti ~3,5% per langkah di sini, dan sisa notch yang belum
  // sampai ambang DIBUANG — totalnya meleset jauh dari niat (terukur 0,9659 vs 0,9441).
  expect(Math.abs((await run(120)) / ideal - 1)).toBeLessThan(0.005);
  // Dekat BAWAH: ambang yang sama cuma ~1% per langkah, jadi dulu pun sudah dekat.
  expect(Math.abs((await run(Math.round(rect.height) - 120)) / ideal - 1)).toBeLessThan(0.005);

  assertNoPageErrors(page);
});

// Pane mana yang di-skala dulu ditentukan KLineCharts sendiri dari koordinat mousedown palsu.
// Tanpa gesture palsu, pemilihan itu jadi tanggung jawab kode kita (paneAtY) — jadi diuji.
test('wheel di sumbu osilator men-skala osilator, bukan pane candle', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => chart.createIndicator('MACD', false, { id: 'pane_macd' }));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const rect = await chartRect(page);
  const pw = await plotWidth(page);
  const bounds = await page.evaluate(() =>
    chart.getAllDrawPanes().map((p) => ({ id: p.getId(), top: p.getBounding().top, h: p.getBounding().height }))
  );
  const osc = bounds.find((b) => b.id === 'pane_macd');
  expect(osc, 'pane osilator harus ada').toBeTruthy();

  const oscRange = () => page.evaluate(() => chart.getDrawPaneById('pane_macd').getAxisComponent().getRange().range);

  const candle0 = await priceSpan(page);
  const osc0 = await oscRange();

  await wheelAt(page, { x: rect.x + (pw + rect.width) / 2, y: rect.y + osc.top + osc.h / 2 }, -100);

  expect(await oscRange()).toBeLessThan(osc0 * 0.99); // osilator ikut
  expect(Math.abs((await priceSpan(page)) / candle0 - 1)).toBeLessThan(0.005); // candle tidak

  assertNoPageErrors(page);
});

test('Shift+wheel di area plot tetap men-skala harga, bukan zoom waktu', async ({ page }) => {
  await gotoApp(page);
  const pt = await plotPoint(page, 0.5, 0.5);

  const span0 = await priceSpan(page);
  const bs0 = await barSpaceApi(page);

  await page.keyboard.down('Shift');
  await wheelAt(page, pt, -100);
  await page.keyboard.up('Shift');

  expect((await priceSpan(page)) / span0).toBeLessThan(0.99);
  expect(await barSpaceApi(page)).toBe(bs0); // Shift menahan zoom waktu

  assertNoPageErrors(page);
});

test('wheel di area plot tetap zoom-waktu dan tak menggeser skala harga terkunci', async ({ page }) => {
  await gotoApp(page);

  // Kunci skala harga dulu (sekali wheel di sumbu → auto-scale mati), supaya perubahan rentang
  // sesudahnya benar-benar berarti "plot ikut men-skala harga", bukan auto-fit data biasa.
  await wheelAt(page, await axisPoint(page, 300), -100);
  const span0 = await priceSpan(page);
  const bs0 = await barSpaceApi(page);

  await wheelAt(page, await plotPoint(page, 0.5, 0.5), -100);

  expect(await barSpaceApi(page)).toBeGreaterThan(bs0); // zoom waktu tetap jalan
  expect(Math.abs((await priceSpan(page)) / span0 - 1)).toBeLessThan(0.005);

  assertNoPageErrors(page);
});
