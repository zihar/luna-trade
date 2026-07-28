// Konversi koordinat: satu-satunya sumber posisi klik di seluruh suite.
//
// Tak ada pixel yang di-hardcode. Semua target klik dihitung lewat converter chart
// (`chart.convertToPixel` dengan paneId 'candle_pane' + absolute:true — sama seperti
// idxToPx/tsToPx di index.html pra-Fase-2:525-526), lalu digeser dengan bounding box #chart untuk jadi
// koordinat viewport. Konsekuensinya: test tahan terhadap perubahan ukuran window, barSpace,
// padding kanan, atau lebar sumbu harga.

/** Bounding box elemen #chart di viewport. */
async function chartRect(page) {
  const box = await page.locator('#chart').boundingBox();
  if (!box) throw new Error('#chart tak ditemukan');
  return box;
}

/** Titik chart ({timestamp|dataIndex, value}) → pixel container-relative {x,y}. */
async function toPixel(page, point) {
  return page.evaluate((pt) => {
    const q = pt.timestamp != null ? { timestamp: pt.timestamp, value: pt.value } : { dataIndex: pt.dataIndex, value: pt.value };
    let p = chart.convertToPixel(q, { paneId: 'candle_pane', absolute: true });
    if (Array.isArray(p)) p = p[0];
    return p ? { x: p.x, y: p.y } : null;
  }, point);
}

/** Beberapa titik sekaligus (hemat round-trip). */
async function toPixels(page, points) {
  return page.evaluate((pts) => {
    const conv = (pt) => {
      if (!pt) return null;
      const q = pt.timestamp != null ? { timestamp: pt.timestamp, value: pt.value } : { dataIndex: pt.dataIndex, value: pt.value };
      let p = chart.convertToPixel(q, { paneId: 'candle_pane', absolute: true });
      if (Array.isArray(p)) p = p[0];
      return p ? { x: p.x, y: p.y } : null;
    };
    return pts.map(conv);
  }, points);
}

/** Pixel container-relative → {dataIndex, timestamp, value} menurut chart. */
async function fromPixel(page, x, y) {
  return page.evaluate(([px, py]) => {
    let c = chart.convertFromPixel({ x: px, y: py }, { paneId: 'candle_pane' });
    if (Array.isArray(c)) c = c[0];
    return c ? { dataIndex: c.dataIndex, timestamp: c.timestamp, value: c.value } : null;
  }, [x, y]);
}

/** Lebar satu bar dalam pixel (mengikuti barSpacePx di index.html pra-Fase-2:527). */
async function barSpace(page) {
  return page.evaluate(() => {
    let a = chart.convertToPixel({ dataIndex: chart.getDataList().length - 1, value: 0 }, { paneId: 'candle_pane', absolute: true });
    let b = chart.convertToPixel({ dataIndex: chart.getDataList().length - 2, value: 0 }, { paneId: 'candle_pane', absolute: true });
    if (Array.isArray(a)) a = a[0];
    if (Array.isArray(b)) b = b[0];
    return a && b ? Math.abs(a.x - b.x) : 8;
  });
}

/**
 * barSpace menurut API klinecharts — bilangan pecahan, bukan proksi pixel.
 *
 * JANGAN pakai `barSpace()` di atas untuk mendeteksi PERUBAHAN kecil level zoom: ia mengurangi
 * dua posisi pixel yang sudah dibulatkan, jadi satu langkah zoom-waktu (8 → 8.8) kadang tampak
 * 9 dan kadang tetap 8, tergantung fase sub-pixel bar terakhir. Fase itu ikut lebar sumbu harga,
 * yang berbeda antar-platform karena metrik font (52px di macOS, 58px di runner Linux) — satu
 * assertion pernah hijau di lokal & merah di CI justru karena itu.
 */
async function barSpaceApi(page) {
  return page.evaluate(() => chart.getBarSpace());
}

/** Data bar yang sedang dirender chart. */
async function dataList(page) {
  return page.evaluate(() => chart.getDataList().map((d) => ({ timestamp: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close })));
}

/** Bar ke-i (negatif = dari belakang). */
async function barAt(page, i) {
  return page.evaluate((idx) => {
    const list = chart.getDataList();
    const d = list[idx < 0 ? list.length + idx : idx];
    return d ? { index: idx < 0 ? list.length + idx : idx, timestamp: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close } : null;
  }, i);
}

/**
 * Lebar AREA PLOT (tanpa sumbu harga), dalam pixel container-relative.
 *
 * klinecharts merender sumbu Y DI DALAM #chart: pada viewport 1600 lebar container 1224 px
 * tetapi plot hanya 1172 px, 52 px sisanya sumbu. Klik di luar batas ini mendarat di sumbu,
 * bukan di chart — jadi semua target klik harus dihitung terhadap angka ini, bukan lebar
 * container. Diukur dari canvas pane (yang bermula di tepi kiri container), bukan ditebak.
 */
async function plotWidth(page) {
  return page.evaluate(() => {
    const el = document.getElementById('chart');
    const left = el.getBoundingClientRect().left;
    let w = 0;
    el.querySelectorAll('canvas').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (Math.abs(r.left - left) <= 1) w = Math.max(w, r.width);
    });
    return w || el.getBoundingClientRect().width;
  });
}

/** Rentang harga yang tampak di pane candle — untuk memilih Y yang pasti kelihatan. */
async function visibleValueRange(page) {
  const rect = await chartRect(page);
  const top = await fromPixel(page, 50, 10);
  const bottom = await fromPixel(page, 50, Math.round(rect.height) - 10);
  return { high: top.value, low: bottom.value };
}

/** Container-relative → koordinat viewport (untuk page.mouse). */
function toViewport(rect, p) {
  return { x: rect.x + p.x, y: rect.y + p.y };
}

module.exports = { chartRect, toPixel, toPixels, fromPixel, barSpace, barSpaceApi, plotWidth, dataList, barAt, visibleValueRange, toViewport };
