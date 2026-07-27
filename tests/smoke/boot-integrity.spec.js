// Integritas boot: apakah SETIAP potongan JS benar-benar termuat & tiap wilayah UI terbangun.
//
// Kenapa ini ada, dan kenapa bukan sekadar "cek elemen ada":
//
// Selama seluruh JS tinggal di satu blok inline, error saat boot membatalkan sisa script —
// gagal keras & berisik, langsung tertangkap guard pageerror. Begitu JS dipecah ke banyak
// `<script src>` (Fase 2, docs/superpowers/specs/2026-07-27-split-index-js-phase2-design.md),
// mode kegagalannya berubah: satu file yang 404 atau gagal dieksekusi TIDAK menghentikan file
// berikutnya. Yang tersisa cuma deklarasi yang hilang — tanpa error, tanpa test merah, sampai
// ada kode yang memanggilnya. UI separuh jadi, suite tetap hijau.
//
// Verifikasi byte-identik pada PR pemecahan juga tak menolong di sini: ia membuktikan byte-nya
// pindah utuh, bukan bahwa file-nya termuat & dieksekusi di browser.
//
// Maka test ini menegaskan dua hal yang TIDAK bisa dijawab keduanya:
//
//   1. DOM yang DIBANGUN JS — bukan yang ditulis di markup. Memastikan `#rail` atau
//      `#orderpanel` ada tak membuktikan apa pun: keduanya elemen statis di markup
//      (index.html:43-392) yang tetap ada walau semua script gagal dimuat. Yang dipakai di
//      bawah hanya wadah yang ISINYA dibangun JS, plus `#tzClock` yang node-nya sendiri
//      dibuat JS.
//   2. Satu sentinel per file `js/*.js` — identifier yang hanya file itu deklarasikan.
//
// Batasnya, biar tak dianggap lebih dari yang sebenarnya: test ini membuktikan KEHADIRAN,
// bukan kebenaran. Ia tak menangkap nilai yang salah, tampilan yang bergeser, atau drag yang
// rusak. Ia menjawab satu pertanyaan saja — "apakah semuanya termuat dan terbangun".

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

// Sentinel per file hasil pemecahan: nama → satu identifier top-level yang HANYA file itu
// deklarasikan. Tabel ini WAJIB tumbuh bersama tiap PR pemecahan; test di bawah gagal kalau
// ada file js/*.js tanpa entri di sini, jadi cakupannya tak bisa berhenti tumbuh diam-diam.
//
// Sebagian file hasil pemecahan TIDAK mendeklarasikan apa pun di top-level — isinya IIFE atau
// statement efek samping saja (mis. pemasangan handler). Untuk file begitu, identifier bukan
// bukti yang tersedia, jadi entrinya berbentuk `{ probe, why }`: sebuah ekspresi yang dievaluasi
// di halaman dan hanya benar kalau file itu benar-benar dieksekusi. `why` wajib — supaya alasan
// memilih jalur probe (bukan lupa mencari identifier) ikut terbaca saat review.
const SENTINEL = {
  // PR-1 — ekstraksi ekor (425 baris) ke enam file.
  'multi-chart.js': 'SEC_DEFAULTS',
  'boot.js': 'bootApp',
  'auth-menu.js': 'setAvatar',
  'analytics.js': 'openAnalyticsDashboard',
  'auth-overlay.js': 'showAuthOverlay',
  'timezone.js': 'TZ_LIST',

  // PR-7 — potongan 2304-3091 (788 baris) ke empat file.
  'sltp-draft.js': 'draftDom',
  'positions-onchart.js': 'paperLines',
  'replay-intrabar.js': 'evalFills',
  'broker-paper.js': 'ReplayBroker',

  // PR-6 — potongan 3092-3768 (677 baris) ke tiga file. Wilayah drawing: titik potongnya baru
  // bersih SETELAH penawar `posPressedMove` mendarat (#138) — sebelum itu ada 2 bahaya senyap.
  'draw-tools.js': 'hoverName',
  'draw-persist.js': 'PERSIST_DRAW',
  'draw-undo.js': 'DRAW_HISTORY_MAX',

  // PR-5 — potongan 3769-4524 (756 baris) ke lima file.
  'draw-rail.js': 'setCursorMode',
  'stats-journal.js': 'renderStats',
  'trades-panel.js': 'activeTradeTab',
  'watchlist.js': 'WATCH_SYMS',
  'instrument-picker.js': 'IPK_GROUPS',

  // PR-4 — potongan 4525-5315 (791 baris) ke empat file.
  'price-stream.js': 'priceES',
  'countdown.js': 'updatePriceTimer',
  'forming-candle.js': 'pushFormingCandle',
  'order-panel.js': 'setOrderDock',

  // PR-3 — potongan 5316-5698 (383 baris) ke dua file.
  'news-notify.js': 'NEWS_NOTIFY_LEAD',
  'keyboard.js': 'MIN_TO_TF',

  // PR-2 — potongan 5699-6447 (749 baris) ke tujuh file.
  'replay-ui.js': 'pickMode',
  'draw-style-modal.js': 'PALETTE',
  'chart-settings.js': 'CHART_DEFAULT',
  'indicators.js': 'IND_DEFS',
  'context-menu.js': 'ctxMenu',
  'chart-type.js': {
    probe: "$('#ctBtn').title.includes(':')",
    why: 'IIFE tanpa deklarasi top-level. Efek yang hanya bisa datang darinya: title tombol jadi "Chart type: <label>", sementara markup (index.html:121) cuma "Chart type" tanpa titik dua.',
  },
  'order-fields.js': {
    // Isinya murni pemasangan handler `input` — tak ada efek yang terlihat sampai ada input.
    // Jadi probenya memancing perilakunya: isi harga SL jauh dari harga sekarang, kirim event
    // `input`, dan #slPips harus terhitung balik ke nilai lain (markup-nya value="100").
    probe: `(() => {
      const before = $('#slPips').value;
      const el = $('#slPrice');
      el.value = '1.0000';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return $('#slPips').value !== before;
    })()`,
    why: 'IIFE tanpa deklarasi top-level; satu-satunya jejaknya adalah handler input yang harus menghitung #slPips dari #slPrice.',
  },
};

/**
 * `typeof` di dalam eval: aman untuk identifier yang tak dideklarasikan (mengembalikan
 * 'undefined' alih-alih melempar), tapi TETAP melempar untuk `let`/`const` yang masih TDZ —
 * itu justru sinyal yang kita cari, jadi throw ditangkap & dilaporkan apa adanya.
 */
async function typeofGlobal(page, name) {
  return page.evaluate((n) => {
    try {
      // eslint-disable-next-line no-eval
      return eval('typeof ' + n);
    } catch (e) {
      return 'THROW: ' + String(e);
    }
  }, name);
}

test('boot: tiap wilayah UI terbangun oleh JS', async ({ page }) => {
  await gotoApp(page);

  // gotoApp sudah menunggu `chart`/`T`/`drawIds` (tests/helpers/app.js:125-134) — jangan
  // diulang di sini. Yang berikut ini lapisan yang belum dijaga siapa pun.

  // Canvas chart dibuat oleh klinecharts.init (index.html:1475), bukan ada di markup.
  expect(
    await page.locator('#chart canvas').count(),
    'klinecharts.init tak menghasilkan canvas di #chart'
  ).toBeGreaterThan(0);

  // Wadah statis di markup, ISI dibangun JS. Wadah kosong = fungsi pembangunnya tak jalan.
  const built = [
    ['#tfbtns > *', 'tombol timeframe (rebuildTFBar)'],
    ['#drawtools > *', 'tombol rail drawing (buildDrawRail)'],
    ['#wlRows .wl-row', 'baris watchlist (renderWatch)'],
    ['#layoutbtns > *', 'tombol layout multi-chart'],
  ];
  for (const [sel, what] of built) {
    expect(await page.locator(sel).count(), `${what} tak terbangun — ${sel} kosong`).toBeGreaterThan(0);
  }

  // Node yang DIBUAT JS lalu di-append (js/timezone.js:32-34) — tak ada di markup sama sekali,
  // jadi ketiadaannya membuktikan potongan timezone tak dieksekusi.
  await expect(page.locator('#tzClock'), 'jam timezone (#tzClock) tak dibuat JS').toHaveCount(1);
  expect(
    (await page.locator('#tzClock').innerText()).trim(),
    'jam timezone terbuat tapi teksnya kosong → updateTzClock tak jalan'
  ).not.toBe('');

  // Teks yang diisi JS ke elemen markup yang aslinya kosong.
  const filled = [
    ['#ipickTrgPair', 'label instrumen di picker (initIpick)'],
    ['#clInst', 'legend chart (initChartLegend)'],
    ['#acBal', 'saldo akun (renderAcct)'],
    ['#stTrades', 'statistik jumlah trade (renderStats)'],
  ];
  for (const [sel, what] of filled) {
    expect((await page.locator(sel).innerText()).trim(), `${what} kosong → tak terisi JS`).not.toBe('');
  }

  assertNoPageErrors(page);
});

/**
 * `fmtCountdown` dideklarasikan DUA KALI dengan isi berbeda — `js/countdown.js` (mendukung satuan
 * hari) dan `js/order-panel.js` (maksimal jam, mengembalikan 'now' untuk nol). Selama semua JS satu
 * blok inline, yang menang untuk SEMUA pemanggil adalah deklarasi terakhir; setelah dipecah,
 * pemenangnya jadi file yang dimuat terakhir. Keduanya kebetulan menghasilkan pemenang yang sama
 * (order-panel), dan itu aman HANYA karena tak ada satu pun referensi eager ke nama ini — semua
 * pemanggilnya berjalan setelah seluruh script termuat.
 *
 * Test ini memaku fakta itu supaya tak berubah diam-diam: kalau urutan tag tertukar, atau salah
 * satu deklarasi dipindah/di-rename tanpa memikirkan pemenangnya, format countdown di UI berubah
 * tanpa error dan tanpa test lain yang peduli.
 */
test('boot: nama ganda fmtCountdown — pemenangnya tetap varian order-panel', async ({ page }) => {
  await gotoApp(page);

  expect(await page.evaluate(() => fmtCountdown(0)), 'varian order-panel mengembalikan "now" untuk nol').toBe('now');
  expect(
    await page.evaluate(() => fmtCountdown(2 * 86400 * 1000)),
    'dua hari harus jadi 48:00:00 (varian order-panel), bukan "2d 00:00:00" (varian countdown)'
  ).toBe('48:00:00');

  assertNoPageErrors(page);
});

test('boot: setiap file js/*.js termuat & punya sentinel', async ({ page }) => {
  const files = fs.existsSync(JS_DIR) ? fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')) : [];

  await gotoApp(page);

  for (const f of files) {
    const entry = SENTINEL[f];
    // Penjaga anti-celah-senyap: file baru tanpa sentinel = suite merah, bukan cakupan yang
    // diam-diam berhenti tumbuh. Sama disiplinnya dengan cek byte-identik di PR pemecahan.
    expect(
      entry,
      `js/${f} belum punya entri di SENTINEL — tambahkan satu identifier top-level yang hanya file itu deklarasikan, atau { probe, why } kalau file itu memang tak mendeklarasikan apa pun`
    ).toBeTruthy();

    if (typeof entry === 'string') {
      expect(
        await typeofGlobal(page, entry),
        `js/${f} tak termuat/tak dieksekusi: identifier '${entry}' tak terdefinisi di halaman`
      ).not.toBe('undefined');
      continue;
    }

    // Jalur probe (file efek-samping saja). `why` diwajibkan supaya jalur ini tak dipakai
    // sebagai jalan pintas ketika sebenarnya ADA identifier yang bisa dipakai.
    expect(entry.why, `js/${f}: entri probe wajib menyertakan \`why\``).toBeTruthy();
    expect(
      await page.evaluate((src) => {
        try {
          // eslint-disable-next-line no-eval
          return eval(src) === true;
        } catch (e) {
          return 'THROW: ' + String(e);
        }
      }, entry.probe),
      `js/${f} tak termuat/tak dieksekusi: probe gagal — ${entry.why}`
    ).toBe(true);
  }

  // Tiap file harus juga benar-benar direferensikan index.html — file yatim di js/ yang tak
  // pernah dimuat akan lolos semua cek di atas kalau sentinelnya kebetulan dideklarasikan
  // di tempat lain.
  if (files.length) {
    const html = fs.readFileSync(path.join(JS_DIR, '..', 'index.html'), 'utf8');
    for (const f of files) {
      expect(html, `js/${f} ada di disk tapi tak direferensikan <script src> di index.html`).toContain(
        `/js/${f}`
      );
    }
  }

  assertNoPageErrors(page);
});
