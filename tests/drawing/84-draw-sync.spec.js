// Sync drawings ke server — memuat, fallback, dan adopsi localStorage.
// Spec: docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { overlays } = require('../helpers/draw');

/** Satu objek tersimpan, dalam format serializeDraws (vt = wall-clock ms). */
function seedObject(ts) {
  return [{ name: 'trendline', points: [{ vt: ts - 3600000, value: 1.1 }, { vt: ts, value: 1.12 }], lock: 0, extendData: null, style: null }];
}

test.describe('draw-sync: memuat', () => {
  test('gambar dimuat DARI SERVER, bukan dari localStorage', async ({ page }) => {
    const { state } = await gotoApp(page, {
      beforeGoto: async (p) => {
        await p.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
      },
    });
    // state.drawings di-seed lewat stub: lihat helper di bawah
    expect(state.drawings, 'stub harus punya wadah drawings').toBeTruthy();

    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate((rows) => { window.__seedDrawings('EUR_USD', rows, 3); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => drawVer[inst]), 'versi server harus tercatat').toBe(3);
    assertNoPageErrors(page);
  });

  test('GET gagal → pakai localStorage, dan versi ditandai TIDAK diketahui', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => __setFailDrawings(true));   // stub membalas 500 selama flag ini menyala
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // null = "tak tahu baseVersion" → Task 4 menolak mendorong dalam keadaan ini.
    expect(await page.evaluate(() => drawVer[inst]), 'versi harus null saat GET gagal').toBeNull();
    assertNoPageErrors(page);
  });

  test('adopsi: server kosong + localStorage berisi → lokal diunggah sekali', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // Terunggah → server kini punya versi 1 untuk simbol ini.
    await expect.poll(async () => page.evaluate(() => window.__drawingsVersion(inst)), { timeout: 8000 }).toBe(1);
    assertNoPageErrors(page);
  });

  // Ronde review 1: 200 dgn bodi tak terbaca (mis. null) HARUS diperlakukan sbg gagal, bukan
  // "server kosong utk simbol ini" — kalau tidak, adopsi keliru menganggap belum ada apa2 di
  // server lalu menimpa/mengunggah tanpa dasar yang benar.
  test('GET 200 tapi bodi bukan objek → diperlakukan gagal: pakai localStorage, versi null, TANPA POST adopsi', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    const posts = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/drawings' && r.method() === 'POST') posts.push(r.url());
    });

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => __setMalformedDrawings(true));   // stub membalas 200 dgn bodi `null`
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => drawVer[inst]), 'versi harus null saat bodi 200 tak terduga').toBeNull();
    expect(posts, 'tak boleh ada POST adopsi saat bentuk respons tak diketahui').toHaveLength(0);
    assertNoPageErrors(page);
  });

  // Bug yang ditemukan review: restoreDraws() melempar (mis. TypeError akses properti d.version)
  // → suppressDrawSave nyangkut true selamanya krn baris resetnya tak pernah tercapai. Sejak fix,
  // js/load-chart.js membungkus restoreDraws() dgn try/finally.
  test('setelah bodi 200 tak terduga, suppressDrawSave tetap dilepas → simpan lokal tetap jalan', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => __setMalformedDrawings(true));
    await page.evaluate(() => loadInit(true));

    expect(await page.evaluate(() => suppressDrawSave), 'suppressDrawSave harus lepas walau load gagal-bentuk').toBe(false);
    assertNoPageErrors(page);
  });
});

const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, CLICK_GAP_MS } = require('../helpers/draw');

/** Gambar satu trendline (dua klik) di posisi yang bisa diprediksi. */
async function drawLine(page, rect) {
  const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
  const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
}

test.describe('draw-sync: mendorong', () => {
  test('menggambar → terdorong ke server dengan baseVersion yang benar', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await expect.poll(async () => page.evaluate(() => __drawingsVersion(inst)), { timeout: 8000 }).toBe(1);
    expect(await page.evaluate(() => drawVer[inst]), 'versi lokal harus ikut naik').toBe(1);
    assertNoPageErrors(page);
  });

  test('reload CEPAT (<1,5 dtk) tetap menyimpan — flush beforeunload mem-POST sungguhan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    // Ronde review 1, temuan 3: dgn versi server dibiarkan 0 (bawaan stub kosong), jalur "adopsi"
    // (Task 3 — server kosong & versi 0 → unggah localStorage) DIAM-DIAM bisa meloloskan test ini
    // walau flush beforeunload dihapus total, sebab beforeunload LAMA di draw-persist.js (yang
    // mendahului task ini) tetap menulis localStorage & adopsi mengunggahnya sendiri sesudah
    // reload. Memaksa versi awal jadi 1 (bukan 0) mematikan jalur pintas itu — adopsi cuma jalan
    // saat versi PERSIS 0 — sehingga satu2nya cara objek ini bisa selamat lewat reload cepat
    // adalah POST sungguhan sebelum unload (flush keepalive).
    await page.evaluate(() => window.__seedDrawings(inst, [], 1));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(0);

    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/drawings')) posts.push(r.url()); });
    await drawLine(page, rect);
    // sengaja TIDAK menunggu debounce 1500ms: inilah yang diuji
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined',
      null, { timeout: 20000 }
    );
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);
    expect(await page.evaluate(() => __drawingsVersion(inst)), 'versi server harus naik dari basis 1 lewat SATU dorongan sungguhan').toBe(2);
    expect(posts, 'flush beforeunload harus benar2 mem-POST, bukan cuma bertahan lewat adopsi localStorage').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('GET gagal → TIDAK ada POST sama sekali', async ({ page }) => {
    await gotoApp(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/drawings')) posts.push(r.url()); });

    await page.evaluate(() => __setFailDrawings(true));
    await page.evaluate(() => loadInit(true));
    await page.waitForTimeout(500);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await page.waitForTimeout(2500);   // lewati debounce 1500ms dgn margin

    expect(posts, 'tanpa baseVersion yang diketahui, mendorong = menimpa perangkat lain').toHaveLength(0);
    assertNoPageErrors(page);
  });

  test('ganti instrumen saat dorongan tertunda: muatan lama tak nyasar ke simbol baru', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    // Simbol awal dibaca, bukan diasumsikan EUR_USD — kalau default harness berubah, test ini
    // harus tetap menguji hal yang sama, bukan gagal karena alasan yang salah.
    const asal = await page.evaluate(() => inst);
    await drawLine(page, rect);
    await page.evaluate(() => selectSymbol('XAU_USD'));   // < 1,5 dtk sesudah menggambar
    await page.waitForFunction(() => inst === 'XAU_USD', null, { timeout: 15000 });
    await page.waitForTimeout(2500);

    expect(await page.evaluate((s) => __drawingsVersion(s), asal), `gambar harus mendarat di ${asal}`).toBe(1);
    expect(await page.evaluate(() => __drawingsVersion('XAU_USD')), 'XAU_USD tak boleh menerima gambar simbol asal').toBe(0);
    assertNoPageErrors(page);
  });

  // Ronde review 1, temuan 1: reload INSTRUMEN YANG SAMA (mis. tombol Load, boot ulang) saat
  // dorongan lokal masih antre. restoreDraws() menimpa kanvas dgn state server segar & menyegarkan
  // drawVer — kalau dorongan lama tak dibatalkan, ia terkirim belakangan dgn baseVersion yg
  // (kebetulan) sudah cocok, sehingga server MENERIMANYA & diam2 menimpa hasil restore yg benar
  // dgn payload pra-reload yg sudah basi. Version protection tak menangkap ini krn base-nya
  // memang benar — yg basi justru payload-nya.
  test('reload instrumen SAMA saat dorongan tertunda: payload basi tak boleh menimpa state server segar', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const asal = await page.evaluate(() => inst);
    await drawLine(page, rect);   // menjadwalkan dorongan lokal (payload lama), belum terkirim

    // Server berubah SEBELUM dorongan lama sempat terkirim (device lain, atau siapa pun) — versi
    // & payload sengaja beda dari yg lokal supaya "basi menang" vs "segar menang" bisa dibedakan.
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate(({ rows, instr }) => window.__seedDrawings(instr, rows, 5), { rows: seedObject(ts), instr: asal });

    await page.evaluate(() => loadInit(true));   // reload INSTRUMEN SAMA saat dorongan lama msh antre
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // Lewati window debounce 1,5 dtk penuh dgn margin. Kalau dorongan lama tak dibatalkan, ia akan
    // terkirim sesudah loadInit selesai, dgn baseVersion yg sudah disegarkan (5) — cocok, diterima
    // server, & menaikkan versi jadi 6 sambil menimpa payload segar dgn payload basi.
    await page.waitForTimeout(2500);

    expect(await page.evaluate((s) => __drawingsVersion(s), asal), 'dorongan basi harus dibatalkan, bukan menimpa versi segar').toBe(5);
    assertNoPageErrors(page);
  });
});

test.describe('draw-sync: bentrok antar perangkat', () => {
  /** Buat server berjalan lebih dulu, sehingga dorongan berikutnya pasti 409. */
  async function makeServerAhead(page) {
    await page.evaluate(() => __seedDrawings(inst, [{ name: 'rect', points: [], lock: 0, extendData: null, style: null }], 9));
  }

  test('409 → notice MENETAP, objek lokal tak tergantikan, dorongan berhenti', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    await makeServerAhead(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/drawings')) posts.push(1); });

    // chart.createOverlay() langsung TAK masuk drawIds (yg mendaftarkannya cuma delHooks() di
    // createDraw/clone/restore — lihat tests/helpers/draw.js) — didorong manual di sini supaya
    // overlays()/serializeDraws() ikut melihatnya sbg objek lokal KEDUA yg harus tetap utuh.
    await page.evaluate(() => { const id = chart.createOverlay({ name: 'rect', points: [] }); drawIds.push(id); scheduleSyncDraws(inst, serializeDraws()); });
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });

    // Menetap: toast biasa hilang 3,8 dtk — ini tidak boleh.
    await page.waitForTimeout(4500);
    await expect(page.locator('#syncConflict')).toBeVisible();

    expect(await overlays(page), 'objek lokal tak boleh diganti tanpa persetujuan').toHaveLength(2);
    const n = posts.length;
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await page.waitForTimeout(2500);
    expect(posts.length, 'tak boleh menembak 409 berulang selama menunggu keputusan').toBe(n);
    assertNoPageErrors(page);
  });

  test('Reload → isi server yang dipakai', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate((t) => __seedDrawings(inst, [
      { name: 'trendline', points: [{ vt: t - 7200000, value: 1.05 }, { vt: t, value: 1.06 }], lock: 0, extendData: null, style: null },
      { name: 'trendline', points: [{ vt: t - 3600000, value: 1.07 }, { vt: t, value: 1.08 }], lock: 0, extendData: null, style: null },
    ], 9), ts);

    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await page.locator('#syncConflict [data-act="reload"]').click();

    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(2);
    await expect(page.locator('#syncConflict')).toBeHidden();
    assertNoPageErrors(page);
  });

  test('Keep mine → punya perangkat ini yang menang', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    await makeServerAhead(page);
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await page.locator('#syncConflict [data-act="keep"]').click();

    // Server menerima muatan lokal di atas versi 9 → jadi 10.
    await expect.poll(async () => page.evaluate(() => __drawingsVersion(inst)), { timeout: 8000 }).toBe(10);
    expect(await overlays(page), 'objek lokal tetap seperti apa adanya').toHaveLength(1);
    assertNoPageErrors(page);
  });

  // Fix round 1: banner adalah SATU elemen DOM tapi drawConflict per-instrumen bisa punya lebih
  // dari satu entri. Bug lama merebind innerHTML+onclick ke instrumen TERAKHIR yang bentrok, jadi
  // instrumen pertama kehilangan satu-satunya jalur ke hideDrawConflict() → dorongannya mati diam2
  // selamanya (gate drawConflict[instrument] di pushDrawsNow tak pernah lepas).
  test('bentrok KEDUA di instrumen lain tak boleh menghilangkan bentrok PERTAMA (orphaning)', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const asal = await page.evaluate(() => inst);

    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);
    await makeServerAhead(page);
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });

    // Pindah simbol & bikin bentrok KEDUA di sana — instrumen asal masih menunggu keputusan.
    await page.evaluate(() => selectSymbol('XAU_USD'));
    await page.waitForFunction(() => inst === 'XAU_USD', null, { timeout: 15000 });
    await expect(page.locator('#syncConflict')).toBeHidden();   // belum ada bentrok di XAU_USD

    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);
    await makeServerAhead(page);   // bergantung ke `inst` SAAT DIPANGGIL → menyasar XAU_USD
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#syncConflict .sc-msg')).toContainText('XAU_USD');

    // Balik ke instrumen ASAL: kalau banner cuma di-rebind (bug lama), yang pertama tak pernah
    // tampil lagi & tombolnya sudah tak tersambung ke apa pun.
    await page.evaluate((s) => selectSymbol(s), asal);
    await page.waitForFunction((s) => inst === s, asal, { timeout: 15000 });
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#syncConflict .sc-msg')).toContainText(asal);

    await page.locator('#syncConflict [data-act="keep"]').click();
    // Bukti hidup, bukan cuma elemen tampak: server harus benar2 menerima muatan instrumen asal
    // di atas versi 9 (dari makeServerAhead pertama) → 10.
    await expect.poll(async () => page.evaluate((s) => __drawingsVersion(s), asal), { timeout: 8000 }).toBe(10);
    assertNoPageErrors(page);
  });

  test('pindah simbol saat bentrok belum diputuskan: banner sembunyi, konflik tetap tertunda & muncul lagi saat balik', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const asal = await page.evaluate(() => inst);

    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);
    await makeServerAhead(page);
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });

    await page.evaluate(() => selectSymbol('XAU_USD'));
    await page.waitForFunction(() => inst === 'XAU_USD', null, { timeout: 15000 });
    await expect(page.locator('#syncConflict')).toBeHidden();

    // Pindah simbol HANYA menyembunyikan tampilan — entri drawConflict instrumen asal tak dibuang.
    const stillPending = await page.evaluate((s) => !!drawConflict[s], asal);
    expect(stillPending, 'konflik instrumen asal tak boleh terhapus cuma krn ganti simbol').toBe(true);

    await page.evaluate((s) => selectSymbol(s), asal);
    await page.waitForFunction((s) => inst === s, asal, { timeout: 15000 });
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    assertNoPageErrors(page);
  });

  test('pesan notice menyebut instrumen yang bentrok, bukan generik', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const asal = await page.evaluate(() => inst);

    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);
    await makeServerAhead(page);
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('#syncConflict .sc-msg')).toHaveText(`Your ${asal} drawings were changed on another device`);
    assertNoPageErrors(page);
  });
});
