// Legend OHLC native di chart: `candleTooltipCustom` yang DIPASANG ke styles klinecharts.
//
// Yang dijaga di sini bukan isi fungsinya, tapi WIRING-nya. `candleTooltipCustom` diserahkan
// sebagai NILAI ke `darkStyles`/`lightStyles` (js/chart-styles.js) sementara deklarasinya ada di
// js/chart-legend.js — dulu ~220
// baris di bawahnya. Hari ini jalan karena hoisting berlaku di dalam satu blok inline; begitu
// wilayah ini pindah ke <script src> sendiri (PR-8 di
// docs/superpowers/plans/2026-07-28-split-index-js-chunks-800.md), nilainya jadi `undefined`,
// klinecharts diam-diam kembali ke tooltip bawaannya, dan legend O/H/L/C + change hilang —
// TANPA error, tanpa test lain yang peduli.
//
// Kenapa tak diuji lewat pixel: tooltip ini dirender ke CANVAS oleh klinecharts, jadi
// keberadaannya tak terlihat dari DOM. Yang bisa dibaca balik justru sumbernya —
// `chart.getStyles().candle.tooltip.custom` — dan itu tepat lapisan yang rusak kalau wiring gagal.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('legend candle: custom tooltip benar-benar terpasang di styles klinecharts', async ({ page }) => {
  await gotoApp(page);

  expect(
    await page.evaluate(() => typeof chart.getStyles().candle.tooltip.custom),
    'candle.tooltip.custom bukan fungsi → klinecharts akan pakai tooltip bawaan & legend O/H/L/C hilang'
  ).toBe('function');

  assertNoPageErrors(page);
});

test('legend candle: yang terpasang menghasilkan baris O/H/L/C + change berwarna arah', async ({ page }) => {
  await gotoApp(page);

  // Sengaja memanggil lewat styles (BUKAN global `candleTooltipCustom`): jalur inilah yang dipakai
  // klinecharts, jadi ia juga membuktikan pembungkus penawar meneruskan argumen dengan benar.
  const rows = await page.evaluate(() =>
    chart
      .getStyles()
      .candle.tooltip.custom({ current: { open: 1, high: 2, low: 0.5, close: 1.5 }, prev: { close: 1 } })
      .map((r) => ({ title: r.title.text, value: r.value.text, color: r.value.color }))
  );

  expect(rows.map((r) => r.title), 'urutan baris legend berubah').toEqual(['O', 'H', 'L', 'C', '']);
  expect(rows[3].value, 'nilai C tak diformat sesuai presisi instrumen').toBe('1.50000');
  expect(rows[4].value, 'baris change (absolut + persen) salah bentuk').toBe('+0.50000 (+50.00%)');
  // Bar naik → keempat nilai OHLC dan baris change memakai warna "up" tema gelap.
  expect(new Set(rows.map((r) => r.color)), 'warna tak mengikuti arah bar').toEqual(new Set(['#54c88c']));

  assertNoPageErrors(page);
});
