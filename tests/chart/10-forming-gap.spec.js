// Regresi: candle jadi banyak GAP sesudah tab lama idle.
//
// Gejala (dilaporkan 2026-07-27): tinggalkan tab, buka tab lain, balik — chart penuh bar
// tipis yang tak nyambung, periode di antaranya hilang, dan tak sembuh sampai reload/ganti TF.
//
// Rantai penyebabnya tiga lapis:
//   1. klinecharts `ChartStore.addData` MEMBUANG datum tunggal yang timestamp-nya lebih tua
//      dari bar terakhir — diam-diam, tanpa error (dist/umd, cabang `timestamp > last` /
//      `=== last`; kalau lebih kecil tak ada cabangnya).
//   2. `pushFormingCandle` (index.html) memakai timestamp candle incomplete OANDA sebagai
//      openTs. Saat `tfData` ketinggalan (timer di-throttle/freeze di tab non-aktif),
//      openTs itu beberapa periode di depan bar tutup terakhir → forming bar di-PUSH,
//      MELOMPATI periode di antaranya.
//   3. `render()` menaikkan `lastLen` tanpa memeriksa apakah klinecharts menerima bar-nya,
//      dan `needFull` tak pernah true lagi → candle tutup yang menyusul ditolak sekali lalu
//      tak pernah dicoba ulang. Lubangnya permanen.
//
// Yang dipatok test ini SATU invarian, bukan mekanismenya:
//   isi chart = semua candle tutup yang sudah revealed, plus PALING BANYAK satu forming bar
//   yang jaraknya tak lebih dari satu periode dari candle tutup terakhir.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { installLaggingCandles } = require('../fixtures/lagging-candles');

const LAG_BARS = 3;

/** Buka app dalam keadaan pasca-idle: tfData ketinggalan LAG_BARS bar, seed di periode kini. */
async function gotoLagging(page, fixtureOpts = { lagBars: LAG_BARS }) {
  let timeline;
  await gotoApp(page, {
    beforeGoto: async (p) => {
      timeline = await installLaggingCandles(p, fixtureOpts);
    },
  });
  // Seed (fetchFormingSeed, count=2) menang lomba melawan autoExtend (count=5000) — request-nya
  // jauh lebih ringan. Itulah urutan yang terjadi saat balik ke tab, dan itu yang dipicu di sini.
  await page.waitForFunction(() => typeof formingSeed !== 'undefined' && formingSeed !== null, null, {
    timeout: 10000,
  });
  return timeline;
}

/** Satu tick harga mid di sekitar harga terakhir → jalur nyata queuePriceRender → rAF. */
async function pushTick(page) {
  await page.evaluate(() => {
    const a = tfData[currentTF];
    const mid = a[a.length - 1].close;
    window.__e2e.pushTick({
      instrument: inst,
      bid: mid - 0.00008,
      ask: mid + 0.00008,
      time: new Date().toISOString(),
    });
  });
  // pushFormingCandle jalan di dalam rAF (queuePriceRender) → tunggu dua frame.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * Jalankan liveRefresh (jalur autoExtend) lalu tunggu candle yang terlewat benar-benar masuk.
 * Promise-nya TIDAK di-await lewat evaluate: menunggu promise halaman di sini pernah gagal
 * dengan "Resulting promise was garbage collected". Yang ditunggu keadaannya, bukan promise-nya.
 */
async function catchUp(page, revealedBefore) {
  await page.evaluate(() => {
    liveRefresh();
  });
  await page.waitForFunction((n) => revealed(currentTF).length > n, revealedBefore, { timeout: 10000 });
}

async function series(page) {
  return page.evaluate(() => ({
    dur: DUR[currentTF],
    want: revealed(currentTF).map((c) => c.timestamp), // bar tutup yang seharusnya tampil
    got: chart.getDataList().map((d) => d.timestamp), // yang benar-benar ada di chart
    tfDataLast: tfData[currentTF][tfData[currentTF].length - 1].timestamp,
    forming: typeof formingBar !== 'undefined' && formingBar ? formingBar.timestamp : null,
  }));
}

/** Invarian tunggal: tak ada bar tutup yang hilang, dan forming bar tak melompat periode. */
function expectNoGap(st, when) {
  const iso = (t) => new Date(t).toISOString().slice(11, 16);
  const closed = st.got.slice(0, st.want.length);
  expect(closed.map(iso), `${when}: candle tutup hilang dari chart`).toEqual(st.want.map(iso));
  expect(st.got.length - st.want.length, `${when}: bar ekstra di chart selain 1 forming bar`).toBeLessThanOrEqual(1);
  if (st.got.length > st.want.length) {
    const extra = st.got[st.got.length - 1];
    const lastClosed = st.want[st.want.length - 1];
    expect(
      extra - lastClosed,
      `${when}: forming bar ${iso(extra)} melompat dari bar tutup terakhir ${iso(lastClosed)}`
    ).toBeLessThanOrEqual(st.dur);
  }
}

test.describe('forming candle saat data candle ketinggalan (pasca-idle)', () => {
  test('tick pertama tak boleh mendorong forming bar yang melompati periode', async ({ page }) => {
    await gotoLagging(page);
    const before = await series(page);
    expect(before.want[before.want.length - 1], 'prasyarat: chart memang lahir ketinggalan').toBe(before.tfDataLast);

    await pushTick(page);

    expectNoGap(await series(page), 'sesudah tick pertama');
    assertNoPageErrors(page);
  });

  test('candle tutup yang menyusul tak boleh hilang dari chart', async ({ page }) => {
    await gotoLagging(page);
    const lagged = await series(page);
    await pushTick(page); // forming bar lebih dulu (urutan pasca-idle)
    await catchUp(page, lagged.want.length); // baru candle tutup menyusul (autoExtend)

    const st = await series(page);
    expect(st.want.length, 'prasyarat: candle yang terlewat sudah masuk tfData').toBe(lagged.want.length + LAG_BARS);
    expectNoGap(st, 'sesudah liveRefresh menyusul');
    assertNoPageErrors(page);
  });

  // Sisi lain dari perbaikan: menahan forming bar tak boleh jadi MENGHILANGKANNYA. Begitu data
  // catch-up, tick berikutnya wajib menggambarnya lagi.
  test('forming bar muncul lagi begitu data catch-up', async ({ page }) => {
    const lagged = await gotoLagging(page).then(() => series(page));
    await pushTick(page);
    await catchUp(page, lagged.want.length);
    await pushTick(page);

    const st = await series(page);
    expectNoGap(st, 'sesudah catch-up');
    expect(st.got.length, 'forming bar tak digambar padahal data sudah catch-up').toBe(st.want.length + 1);
    expect(st.forming, 'forming bar tak dicatat').not.toBeNull();
    assertNoPageErrors(page);
  });

  // Lapis ketiga: chart yang SUDAH rusak harus sembuh sendiri. Di sini bar melompat ditanam
  // langsung lewat chart.updateData — bukan meniru bug-nya, tapi mewakili sebab apa pun yang
  // membuat bar terakhir di chart lebih baru dari bar tutup berikutnya (sesi yang sudah rusak
  // sebelum perbaikan ini, atau jalur lain yang belum terpikir). Tanpa jaring pengaman di
  // render(), lubangnya menetap sampai reload.
  test('lubang yang sudah terjadi sembuh pada render berikutnya', async ({ page }) => {
    const lagged = await gotoLagging(page).then(() => series(page));
    await page.evaluate((dur) => {
      const a = tfData[currentTF];
      const last = a[a.length - 1];
      chart.updateData({ ...last, timestamp: last.timestamp + 4 * dur }); // bar melompat 4 periode
    }, lagged.dur);

    await catchUp(page, lagged.want.length); // candle tutup menyusul → render() harus memaksa full

    expectNoGap(await series(page), 'sesudah render pemulihan');
    assertNoPageErrors(page);
  });

  // Penjaga perbaikan sebelumnya (db462d1 "forming candle H4/Daily muncul saat baru open"):
  // openTs yang BUKAN kelipatan grid (align 18:00 NY, gap akhir pekan) itu sah — di situ tak ada
  // bar yang terlewat, jadi forming bar tetap harus digambar. Pembeda antara kasus ini dan kasus
  // pasca-idle adalah bar TUTUP terakhir milik server, bukan jarak openTs ke bar terakhir.
  test('boundary sah non-grid tetap menggambar forming bar', async ({ page }) => {
    await gotoLagging(page, { lagBars: 0, deadBars: 2 });
    const before = await series(page);
    await pushTick(page);

    const st = await series(page);
    expect(st.got.length, 'forming bar hilang di boundary non-grid').toBe(st.want.length + 1);
    expect(st.want, 'tak boleh ada bar tutup baru — zona matinya kosong').toEqual(before.want);
    expect(
      st.got[st.got.length - 1] - st.want[st.want.length - 1],
      'forming bar harus di periode berjalan (beberapa periode di depan bar tutup terakhir)'
    ).toBeGreaterThan(st.dur);
    assertNoPageErrors(page);
  });
});
