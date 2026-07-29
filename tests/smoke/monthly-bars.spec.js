// Batas & label bar BULANAN (TF `MN`).
//
// Kenapa file ini ada. Sampai 2026-07-29 seluruh aplikasi memakai satu konstanta durasi per TF
// (`DUR` di js/constants.js) sebagai batas tutup bar, dan untuk bulanan nilainya dipatok
// `2.63e9` ms = 30,4398 hari — rata-rata panjang bulan, bukan panjang bulan mana pun. Bulan nyata
// 28–31 hari, jadi anggapan itu selalu salah:
//
//   Jul 2026 (31 hari) → app menganggap tutup 13j 26m LEBIH AWAL
//   Feb 2026 (28 hari) → app menganggap tutup 58j 33m LEBIH LAMBAT
//
// Akibat yang terlihat pengguna: countdown ⏱ melompat ke "30d ..." di jendela antara batas palsu
// dan tutup sebenarnya (31 Jul 07:33Z → 21:00Z), dan `revealed()` — penjaga anti-lookahead Bar
// Replay — menganggap bar Februari masih terbuka 2,4 hari setelah ia benar-benar tutup.
//
// Selain itu OANDA menandai bar bulanan dengan waktu BUKA-nya, yaitu 17:00 New York di hari
// TERAKHIR bulan sebelumnya. Hanya Daily yang punya penawar untuk itu (`CLOSE_LABEL_TF`), jadi bar
// Juli tampil berlabel "30 Jun '26" — TradingView menampilkannya sebagai Juli.
//
// DATA jangkar di bawah bukan karangan: ia diambil dari respons OANDA sungguhan
// (EUR_USD granularity=M), termasuk dua transisi DST. Karena tiap bar buka tepat di tutup bar
// sebelumnya, urutan itu SEKALIGUS tabel kebenaran untuk "batas bar berikutnya".
//
// Rancangan: docs/superpowers/specs/2026-07-29-monthly-bar-boundary-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

// Jangkar bar bulanan EUR_USD dari OANDA (granularity=M, price=M), berurutan.
// 21:00Z = 17:00 NY saat EDT · 22:00Z = 17:00 NY saat EST.
// Perhatikan dua transisi DST: 10-31→11-30 (EDT→EST) dan 03-31 (EST→EDT).
const ANCHOR = [
  '2025-07-31T21:00:00Z',
  '2025-08-31T21:00:00Z',
  '2025-09-30T21:00:00Z',
  '2025-10-31T21:00:00Z',
  '2025-11-30T22:00:00Z', // ← DST berakhir: offset UTC berubah, jam NY tetap 17:00
  '2025-12-31T22:00:00Z',
  '2026-01-31T22:00:00Z',
  '2026-02-28T22:00:00Z', // ← Februari 28 hari
  '2026-03-31T21:00:00Z', // ← DST mulai
  '2026-04-30T21:00:00Z',
  '2026-05-31T21:00:00Z',
  '2026-06-30T21:00:00Z',
];
const ms = (iso) => Date.parse(iso);

test('bulanan: stepBarTs melanjutkan jangkar 17:00 NY, lintas DST & bulan pendek', async ({ page }) => {
  await gotoApp(page);

  const step = (ts, n) => page.evaluate(([t, k]) => stepBarTs('MN', t, k), [ts, n]);

  // Tiap pasangan berurutan dari data OANDA nyata = satu kasus "bar berikutnya".
  for (let i = 0; i + 1 < ANCHOR.length; i++) {
    expect(
      new Date(await step(ms(ANCHOR[i]), 1)).toISOString(),
      `bar sesudah ${ANCHOR[i]} harus ${ANCHOR[i + 1]} (jangkar OANDA nyata)`
    ).toBe(new Date(ms(ANCHOR[i + 1])).toISOString());
  }

  // n > 1 dipakai proyeksi area future (label sumbu-X di kanan bar terakhir).
  expect(new Date(await step(ms('2026-06-30T21:00:00Z'), 3)).toISOString(), '3 bar setelah Juli = Oktober').toBe(
    new Date(ms('2026-09-30T21:00:00Z')).toISOString()
  );

  // Tahun kabisat — 29 Feb, dan Februari selalu EST (UTC-5) → 22:00Z.
  expect(new Date(await step(ms('2028-01-31T22:00:00Z'), 1)).toISOString(), 'Feb 2028 tutup 29 Feb, bukan 28').toBe(
    new Date(ms('2028-02-29T22:00:00Z')).toISOString()
  );

  assertNoPageErrors(page);
});

test('bulanan: stepBarTs TF lain tetap kelipatan DUR', async ({ page }) => {
  await gotoApp(page);

  // Perbaikan bulanan tak boleh mengubah TF yang durasinya memang tetap.
  const BASE = 1_700_000_000_000;
  const cek = async (tf, n) => {
    const [got, dur] = await page.evaluate(
      ([t, k, b]) => [stepBarTs(t, b, k), DUR[t]],
      [tf, n, BASE]
    );
    expect(got, `${tf} × ${n} harus ${n}× DUR[${tf}]`).toBe(BASE + n * dur);
  };
  await cek('M15', 1);
  await cek('H4', 3);
  await cek('D', 1);

  assertNoPageErrors(page);
});

test('bulanan: barEndAt memakai open bar berikutnya bila ada, proyeksi hanya di bar terakhir', async ({ page }) => {
  await gotoApp(page);

  const arr = ANCHOR.slice(-3).map((t) => ({ timestamp: ms(t) })); // Apr, Mei, Jun-anchor(=Juli)
  const end = (i) => page.evaluate(([a, k]) => barEndAt('MN', k, a), [arr, i]);

  // Bar yang punya penerus: batasnya EKSAK dari data, tak ada aritmetika sama sekali.
  expect(await end(0), 'bar ke-0 tutup tepat saat bar ke-1 buka').toBe(arr[1].timestamp);
  expect(await end(1), 'bar ke-1 tutup tepat saat bar ke-2 buka').toBe(arr[2].timestamp);

  // Bar TERAKHIR (bulan berjalan) — satu-satunya yang butuh proyeksi.
  // Ini kasus yang dulu bikin countdown melompat: 30,44 hari, bukan akhir bulan sebenarnya.
  const salah = arr[2].timestamp + 2.63e9; // perilaku LAMA
  expect(await end(2), 'bar berjalan harus tutup 31 Jul 21:00Z (akhir bulan nyata)').toBe(
    ms('2026-07-31T21:00:00Z')
  );
  expect(await end(2), 'jangan pakai DUR.MN (30,44 hari) untuk bar terakhir').not.toBe(salah);

  assertNoPageErrors(page);
});

// Menyetel state global (currentTF/T/tfData/Date.now) memang bukan test unit murni — tapi keempat
// nama itu ADALAH antarmuka nyata fungsi-fungsi ini di aplikasi, jadi memakainya menguji jalur yang
// benar-benar jalan di produksi. Semua dipulihkan di `finally` supaya test lain tak terkontaminasi.
//
// `mode` memilih apa yang diukur; sengaja satu fungsi kecil dengan switch, bukan pembangkit kode.
const probeMonthly = (page, mode, nowMs, bars, arg) =>
  page.evaluate(
    ([m, n, b, v]) => {
      const rn = Date.now, sTF = currentTF, sT = T, sData = tfData.MN, ada = 'MN' in tfData;
      try {
        Date.now = () => n;
        currentTF = 'MN';
        tfData.MN = b;
        T = n;
        if (m === 'revealed') return revealed('MN').map((x) => x.timestamp);
        if (m === 'nextEnd') return nextCandleEnd();
        if (m === 'fidxToTs') return fidxToTs(v);
        if (m === 'tsToFracIndex') return tsToFracIndex(v);
        throw new Error('mode tak dikenal: ' + m);
      } finally {
        Date.now = rn;
        currentTF = sTF;
        T = sT;
        if (ada) tfData.MN = sData; else delete tfData.MN;
      }
    },
    [mode, nowMs, bars, arg]
  );

test('bulanan: revealed() mengungkap bar tepat pada tutup sebenarnya, bukan +30,44 hari', async ({ page }) => {
  await gotoApp(page);

  const bars = ANCHOR.map((t) => ({ timestamp: ms(t) }));
  const revealedAt = (cursor) => probeMonthly(page, 'revealed', cursor, bars);

  const bukaFeb = ms('2026-01-31T22:00:00Z');  // bar Februari 2026
  const tutupFeb = ms('2026-02-28T22:00:00Z'); // = open bar Maret

  const tepat = await revealedAt(tutupFeb);
  expect(tepat, 'bar Feb harus terungkap tepat saat ia tutup (28 hari, bukan 30,44)').toContain(bukaFeb);
  expect(tepat, 'bar Maret belum tutup → jangan terungkap (anti-lookahead)').not.toContain(tutupFeb);

  expect(await revealedAt(tutupFeb - 1000), 'sedetik sebelum tutup, bar Feb belum boleh terungkap').not.toContain(
    bukaFeb
  );

  assertNoPageErrors(page);
});

test('bulanan: countdown pakai akhir bulan nyata & tak melompat sebulan di hari terakhir', async ({ page }) => {
  await gotoApp(page);

  const bars = ANCHOR.map((t) => ({ timestamp: ms(t) }));
  const endAt = (nowMs) => probeMonthly(page, 'nextEnd', nowMs, bars);
  const iso = (ms_) => new Date(ms_).toISOString();
  const TUTUP_JULI = ms('2026-07-31T21:00:00Z');

  expect(iso(await endAt(ms('2026-07-15T12:00:00Z'))), 'pertengahan Juli → tutup 31 Jul 21:00Z').toBe(
    iso(TUTUP_JULI)
  );

  // JENDELA BUG-nya. Pada 31 Jul 07:40Z batas palsu (open + 30,44 hari = 07:33Z) sudah terlewat
  // sementara bar Juli masih terbuka 13 jam lagi — di situ `while(end<=now) end+=dur` dulu
  // melempar countdown ke 30 Agustus, jadi pill ⏱ mendadak menunjukkan "30d ..." bukan "13:20".
  expect(
    iso(await endAt(ms('2026-07-31T07:40:00Z'))),
    'jangan melompat ke bulan berikutnya selagi bar Juli masih terbuka'
  ).toBe(iso(TUTUP_JULI));

  // Sesudah tutup sungguhan → barulah pindah ke bar Agustus (tutup 31 Agu 21:00Z, EDT).
  expect(iso(await endAt(ms('2026-08-01T00:00:00Z'))), 'sesudah tutup Juli → tutup Agustus').toBe(
    iso(ms('2026-08-31T21:00:00Z'))
  );

  assertNoPageErrors(page);
});

test('bulanan: cursor "live" mengungkap bar terbaru', async ({ page }) => {
  await gotoApp(page);

  const bars = ANCHOR.map((t) => ({ timestamp: ms(t) }));
  const jumlah = async (cursor) => (await probeMonthly(page, 'revealed', cursor, bars)).length;
  const last = bars[bars.length - 1].timestamp;

  // Ini BUKTI kenapa cursor tak boleh dihitung dari DUR.MN. Rumus lama (`open + DUR[tf]`, dipakai
  // load-chart.js & replay-ui.js untuk "lompat ke bar terbaru") mendarat 13j 26m SEBELUM tutup Juli,
  // jadi begitu revealed() memakai batas bulan yang benar, bar terbaru justru tak terungkap.
  expect(await jumlah(last + 2.63e9), 'rumus DUR.MN mengubur bar terbaru').toBe(bars.length - 1);

  const cursor = await page.evaluate((b) => cursorAtNewest('MN', b), bars);
  expect(cursor, 'cursor live = tutup bar terakhir yang sebenarnya').toBe(ms('2026-07-31T21:00:00Z'));
  expect(await jumlah(cursor), 'semua bar, termasuk bulan berjalan, harus terungkap').toBe(bars.length);

  assertNoPageErrors(page);
});

test('bulanan: proyeksi area future maju per bulan nyata & bolak-balik konsisten', async ({ page }) => {
  await gotoApp(page);

  // Area kosong di kanan bar terakhir: label sumbu-X & anchor gambar dihitung dgn ekstrapolasi.
  // Dengan DUR.MN, bar "+1" mendarat di 31 Jul 07:33Z — bukan awal bar Agustus.
  const bars = ANCHOR.map((t) => ({ timestamp: ms(t) }));
  const cursor = ms('2026-07-31T21:00:00Z');
  const li = bars.length - 1;
  const at = (idx) => probeMonthly(page, 'fidxToTs', cursor, bars, idx);
  const idxOf = (ts) => probeMonthly(page, 'tsToFracIndex', cursor, bars, ts);
  const iso = (v) => new Date(v).toISOString();

  expect(iso(await at(li + 1)), 'satu bar ke depan = buka bar Agustus').toBe(iso(ms('2026-07-31T21:00:00Z')));
  expect(iso(await at(li + 2)), 'dua bar ke depan = buka bar September').toBe(iso(ms('2026-08-31T21:00:00Z')));

  // Kebalikannya harus mendarat di angka bulat yang sama (bukan pecahan).
  expect(await idxOf(ms('2026-07-31T21:00:00Z')), 'buka Agustus = li+1 tepat').toBeCloseTo(li + 1, 6);
  expect(await idxOf(ms('2026-08-31T21:00:00Z')), 'buka September = li+2 tepat').toBeCloseTo(li + 2, 6);

  // Tengah bar Agustus (31 hari) → pecahan ~0,5.
  const tengahAgu = ms('2026-07-31T21:00:00Z') + (ms('2026-08-31T21:00:00Z') - ms('2026-07-31T21:00:00Z')) / 2;
  expect(await idxOf(tengahAgu), 'tengah bar Agustus ≈ li+1,5').toBeCloseTo(li + 1.5, 3);

  assertNoPageErrors(page);
});

test('bulanan: bar dilabeli bulan dagangnya, bukan hari terakhir bulan sebelumnya', async ({ page }) => {
  await gotoApp(page);

  // OANDA menandai bar Juli dengan 2026-06-30T21:00Z. Yang dilihat pengguna harus "Jul",
  // sama seperti TradingView — bukan "30 Jun".
  const label = await page.evaluate((t) => {
    const simpan = currentTF;
    try {
      currentTF = 'MN';
      return crosshairDate(t);
    } finally {
      currentTF = simpan;
    }
  }, ms('2026-06-30T21:00:00Z'));

  expect(label, 'label bar bulanan tak boleh menyebut bulan sebelumnya').not.toMatch(/Jun/);
  expect(label, 'label bar bulanan harus menyebut bulan dagangnya (Jul 2026)').toMatch(/Jul/);
  expect(label, "tanpa hari & jam — satu bar = satu bulan penuh").toMatch(/^Jul '26$/);

  assertNoPageErrors(page);
});
