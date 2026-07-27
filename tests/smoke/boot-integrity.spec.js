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
// Contoh untuk PR-1 (ekstraksi ekor 6398-6822), tinggal dibuka saat file-nya lahir:
//   'multi-chart.js':  'SEC_DEFAULTS',
//   'boot.js':         'bootApp',
//   'auth-menu.js':    'setAvatar',
//   'analytics.js':    'openAnalyticsDashboard',
//   'auth-overlay.js': 'showAuthOverlay',
//   'timezone.js':     'TZ_LIST',
const SENTINEL = {};

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

  // Node yang DIBUAT JS lalu di-append (index.html:6847-6849) — tak ada di markup sama sekali,
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

test('boot: setiap file js/*.js termuat & punya sentinel', async ({ page }) => {
  const files = fs.existsSync(JS_DIR) ? fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')) : [];

  await gotoApp(page);

  for (const f of files) {
    const name = SENTINEL[f];
    // Penjaga anti-celah-senyap: file baru tanpa sentinel = suite merah, bukan cakupan yang
    // diam-diam berhenti tumbuh. Sama disiplinnya dengan cek byte-identik di PR pemecahan.
    expect(
      name,
      `js/${f} belum punya entri di SENTINEL — tambahkan satu identifier top-level yang hanya file itu deklarasikan`
    ).toBeTruthy();

    expect(
      await typeofGlobal(page, name),
      `js/${f} tak termuat/tak dieksekusi: identifier '${name}' tak terdefinisi di halaman`
    ).not.toBe('undefined');
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
