// Alert dari objek gambar — tab Alert, pembuatan, dan label daftar.
// Spec v1 (horizontal): docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md
// Spec v2 (miring):     docs/superpowers/specs/2026-08-09-alert-garis-miring-design.md
//
// Didukung: tiga tool HORIZONTAL (horizontalStraightLine, horizontalRayLine, priceLine) dan tiga
// tool MIRING (trendline, rayLine, straightLine). Keduanya diuji berdampingan di berkas ini karena
// anchornya dibaca dengan aturan BERBEDA: horizontal memaksa p1===p2 dari points[0], miring membaca
// kedua titik sungguhan lalu menormalkannya jadi menaik.
//
// Zona (rect, parallelStraightLine, priceChannelLine) dibuka di spec ketiga
// (2026-08-10-alert-zona-design.md): ketiganya dinormalkan ke satu bentuk — garis batas pertama +
// pOff — dan memakai kondisi TRANSISI (Entering/Exiting), bukan persilangan satu level.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, drawTool, CLICK_GAP_MS } = require('../helpers/draw');

const HLINE_TOOLS = ['horizontalStraightLine', 'horizontalRayLine', 'priceLine'];
const SLOPED_TOOLS = ['trendline', 'rayLine', 'straightLine'];
const ZONE_TOOLS = ['rect', 'parallelStraightLine', 'priceChannelLine'];

async function drawRect(page, rect) {
  await armTool(page, 'rect');
  await clickAt(page, rect, { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.2) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.35) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  return (await overlays(page))[0];
}

/**
 * Seret BADAN objek ke bawah sejauh `dy` px.
 *
 * Spot-nya sengaja dihitung sendiri, BUKAN lewat hoverableSpot(): kandidat pertama helper itu
 * adalah titik anchor objek, dan menekan tepat di handle titik pada garis horizontal tak
 * menghasilkan gerakan sama sekali (terverifikasi utk ketiga tool — hover true, geser nol).
 * Yang menggerakkan objek adalah tekanan di BADAN garis, sedikit menjauh dari handle.
 */
async function dragBodyBy(page, obj, rect, dy) {
  const px = await toPixels(page, obj.points);
  const spot = px.length > 1
    ? { x: px[0].x + (px[1].x - px[0].x) * 0.3, y: px[0].y + (px[1].y - px[0].y) * 0.3 }
    : { x: px[0].x + 60, y: px[0].y };
  await page.mouse.move(rect.x + spot.x, rect.y + spot.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(rect.x + spot.x, rect.y + spot.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('alert garis: tab & pembuatan', () => {
  for (const name of HLINE_TOOLS) {
    test(`tab Alert muncul untuk ${name}`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), obj.id);
      await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
      assertNoPageErrors(page);
    });
  }

  // Spec v2: tool MIRING kini punya tab Alert. Basis waktunya sudah jam-dagang (session.go), jadi
  // level yang diawasi monitor sama dengan garis yang digambar di sumbu indeks-bar.
  for (const name of SLOPED_TOOLS) {
    test(`tab Alert muncul untuk ${name} (garis miring)`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), obj.id);
      await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
      expect(await page.evaluate((n) => ALERTABLE_LINE.has(n), name), `${name} harus alertable`).toBe(true);
      assertNoPageErrors(page);
    });
  }

  // Kebalikan dari invarian horizontal: anchor tool miring membawa DUA harga yang berbeda, dan
  // waktunya menaik. p1===p2 di sini justru berarti harga titik kedua tak terbaca.
  for (const name of SLOPED_TOOLS) {
    test(`${name}: anchor MIRING menaik (t1<t2) dan kedua harganya berbeda`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      const an = await page.evaluate((id) => lineAnchorsOf(id), obj.id);
      expect(an, 'anchor harus terbentuk').not.toBeNull();
      expect(an.t1, 't1 harus lebih awal dari t2 (dinormalkan)').toBeLessThan(an.t2);
      expect(an.p1, 'garis miring: harga kedua ujung berbeda').not.toBe(an.p2);
      assertNoPageErrors(page);
    });
  }

  // Menggambar MUNDUR (kanan → kiri) adalah gestur yang sah. Server memakai selisih waktu dagang
  // antar anchor sebagai penyebut, jadi anchor yang menurun akan membalik arah garisnya.
  test('garis digambar KANAN ke KIRI tetap menghasilkan anchor menaik', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.6), y: Math.round(rect.height * 0.3) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.6) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    const obj = (await overlays(page))[0];
    const an = await page.evaluate((id) => lineAnchorsOf(id), obj.id);
    expect(an.t1, 'anchor harus dinormalkan menaik walau digambar mundur').toBeLessThan(an.t2);
    assertNoPageErrors(page);
  });

  // Zona: tab Alert ada, dan dropdown-nya menawarkan TRANSISI (enter/exit) — bukan cross.
  // Kalau suatu saat ia kembali menawarkan cross, artinya gerbang keluarga objeknya bocor.
  for (const name of ZONE_TOOLS) {
    test(`tab Alert muncul untuk ${name} dgn kondisi Entering/Exiting`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
      await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
      const opts = await page.$$eval('.dm-pane[data-pane="alert"] select option', (os) => os.map((o) => o.value));
      expect(opts).toEqual(['enter', 'exit']);
      assertNoPageErrors(page);
    });
  }

  for (const name of ZONE_TOOLS) {
    test(`${name}: anchor zona membawa pOff bukan nol`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      const an = await page.evaluate((id) => anchorsOf(id), obj.id);
      expect(an, 'anchor zona harus terbentuk').not.toBeNull();
      expect(an.t1).toBeLessThan(an.t2);
      expect(Math.abs(an.pOff), 'zona harus punya tinggi').toBeGreaterThan(0);
      assertNoPageErrors(page);
    });
  }

  // priceChannelLine: garis yang DIGAMBAR pengguna adalah sumbu tengah, jadi anchor yang dikirim
  // harus sudah digeser — kalau tidak, pita yang diawasi meleset setengah lebar dari yang terlihat.
  test('priceChannelLine: garis yang digambar ada di TENGAH pita yang dikirim', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'priceChannelLine');
    const cek = await page.evaluate((id) => {
      const o = chart.getOverlayById(id), an = anchorsOf(id);
      const i1 = fidxOf(o.points[0]), i2 = fidxOf(o.points[1]), i3 = fidxOf(o.points[2]);
      const f = (i3 - i1) / (i2 - i1);
      const tengahDigambar = o.points[0].value + (o.points[1].value - o.points[0].value) * f;
      const tengahDikirim = an.p1 + (an.p2 - an.p1) * f + an.pOff / 2;
      return { tengahDigambar, tengahDikirim };
    }, obj.id);
    expect(Math.abs(cek.tengahDikirim - cek.tengahDigambar)).toBeLessThan(1e-9);
    assertNoPageErrors(page);
  });

  // POST zona: cond transisi + pOff ikut terkirim.
  test('rect: POST alert membawa cond enter + pOff', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'rect');
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.postDataJSON()); });
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
    expect(posts[0].cond).toBe('enter');
    expect(Math.abs(posts[0].pOff)).toBeGreaterThan(0);
    assertNoPageErrors(page);
  });

  // I6: ketiga tool yang didukung harus SAMA-SAMA mengirim anchor yang sah. p1===p2 dijamin SECARA
  // KONSTRUKSI (harga diambil dari points[0] utk kedua anchor) — horizontalRayLine punya dua titik
  // dan nilai titik keduanya tak selalu tersinkron ke titik pertama; "horizontal" yang anchornya
  // berselisih adalah alert MIRING berkostum horizontal. t1!==t2 karena server menolak vertikal.
  for (const name of HLINE_TOOLS) {
    test(`${name}: POST alert membawa cond + did + p1===p2 dan t1!==t2`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      const did = await page.evaluate((id) => objDid[id], obj.id);

      const posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.postDataJSON()); });

      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
      await page.selectOption('.dm-pane[data-pane="alert"] select', 'up');
      await page.click('.dm-pane[data-pane="alert"] .da-create');
      await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);

      const body = posts[0];
      expect(body.cond).toBe('up');
      expect(body.drawId).toBe(did);
      for (const k of ['t1', 'p1', 't2', 'p2']) {
        expect(body[k], `anchor ${k} harus terkirim`).not.toBeUndefined();
        expect(body[k], `anchor ${k} tak boleh null`).not.toBeNull();
      }
      expect(body.p1, 'garis horizontal: kedua anchor harga HARUS identik').toBe(body.p2);
      expect(body.t1, 't1 dan t2 harus beda — garis vertikal ditolak server').not.toBe(body.t2);
      assertNoPageErrors(page);
    });
  }

  // C1 (bagian "secara konstruksi"): garis horizontal yang digambar lewat UI selalu punya dua nilai
  // titik yang sama — klinecharts memaksakannya, bahkan overrideOverlay() diluruskan kembali. Jadi
  // test di atas tak bisa membedakan "diambil dari points[0] dua kali" dari "dibaca dari points[1]".
  // Yang dijaga di sini adalah kasus yang TAK bisa dibuat lewat kanvas: muatan lama / desync yang
  // titik keduanya berbeda. Karena itu lineAnchorsOf() diuji langsung atas objek palsu (pola
  // monkey-patch yang sama dgn chart.createOverlay di test drawAlertLines di bawah). Kalau harga
  // dibaca dari points[1], yang tersimpan adalah alert MIRING berkostum horizontal.
  test('lineAnchorsOf: nilai titik kedua yang MELENCENG tetap menghasilkan p1===p2', async ({ page }) => {
    await gotoApp(page);
    const an = await page.evaluate(() => {
      const orig = chart.getOverlayById;
      chart.getOverlayById = () => ({ id: 'fake', name: 'horizontalRayLine',
        points: [{ timestamp: 1_700_000_000_000, value: 1.10 }, { timestamp: 1_700_000_600_000, value: 1.15 }] });
      try { return lineAnchorsOf('fake'); } finally { chart.getOverlayById = orig; }
    });
    expect(an, 'anchor harus terbentuk').not.toBeNull();
    expect(an.p1, 'harga kedua anchor diambil dari points[0] → identik apa pun isi points[1]').toBe(an.p2);
    expect(an.p1).toBe(1.10);
    expect(an.t1).not.toBe(an.t2);
    assertNoPageErrors(page);
  });

  // I4: label asal alert diambil dari objek yang HIDUP lewat `did`, bukan dari field yang dititipkan
  // saat create — alertPoll() menulis ulang `alerts` tiap ~2dtk dari respons server, dan server tak
  // menyimpan tipe objeknya. Karena itu test ini menunggu SATU putaran poll dulu (keadaan mantap);
  // versi lama lolos hanya karena kebetulan tak ada poll yang mendarat di sela-selanya.
  test('daftar alert menampilkan kondisi & asal — dan bertahan sesudah satu putaran poll', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'horizontalRayLine');

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.selectOption('.dm-pane[data-pane="alert"] select', 'down');
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    // Keadaan MANTAP: satu putaran alertPoll() sudah menulis ulang `alerts` dari server.
    await page.evaluate(async () => { await alertPoll(); });

    const teks = await page.locator('#alertList .al-item .al-main').first().textContent();
    expect(teks, 'harus menyebut kondisi arah').toMatch(/Crossing down/i);
    expect(teks, 'harus menyebut asal objeknya (judul dari OBJ_TITLE), bukan "Drawing"').toContain('Horizontal Ray');
    assertNoPageErrors(page);
  });

  test('objek yang sudah punya alert: tab menampilkannya + bisa dihapus', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'horizontalStraightLine');

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toBeVisible();
    await page.click('.dm-pane[data-pane="alert"] .da-del');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(0);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: modal yg masih terbuka sesudah Create tetap menampilkan
  // form Create (bukan Delete), jadi klik kedua mengirim POST /api/alerts KEDUA. Test ini
  // SENGAJA tidak reopen modal — itulah yg bikin gagal lama luput ketahuan.
  test('sesudah Create, pane yg masih terbuka (TANPA reopen) langsung tampil Delete', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'priceLine');

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    // TANPA openObjSettings lagi: pane yg sudah terbuka harus sudah berganti sendiri.
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toBeVisible();
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-create')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  // I5: `panel` adalah SATU node modal yang dipakai ulang, sedangkan `o` ditangkap saat klik Create
  // — dan jalur create bisa makan beberapa detik. Kalau modal sudah menampilkan objek LAIN saat
  // refresh yang tertunda mendarat, pane objek baru ditimpa keadaan objek lama dan tombol Delete-nya
  // terikat ke objek lama: "hapus alert garis ini" menghapus alert garis LAIN.
  test('refresh pane yang tertunda tak boleh menulis ulang modal objek LAIN', async ({ page }) => {
    await gotoApp(page);
    const { obj: a } = await drawTool(page, 'horizontalStraightLine');
    // Objek kedua di ketinggian berbeda supaya tak berimpit dgn yang pertama.
    const rect = await chartRect(page);
    await armTool(page, 'horizontalStraightLine');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.5), y: Math.round(rect.height * 0.7) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    const b = (await overlays(page)).find((o) => o.id !== a.id);
    expect(b, 'harus ada objek kedua').toBeTruthy();

    // A punya alert; B belum. Modal sedang menampilkan B.
    await page.evaluate((id) => createLineAlert(id, 'cross'), a.id);
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), b.id);
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-create'), 'B belum punya alert').toBeVisible();

    // Refresh yang "terlambat" untuk A mendarat sekarang.
    await page.evaluate((id) => refreshAlertPane(drawModal.querySelector('.dmodal'), chart.getOverlayById(id)), a.id);

    await expect(page.locator('.dm-pane[data-pane="alert"] .da-create'), 'pane B tak boleh berubah jadi keadaan A').toBeVisible();
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: gerbang !a.drawId di drawAlertLines() ada tapi tak pernah
  // diuji siapa pun; regresi di situ menggambar garis datar di harga 0 utk tiap alert garis.
  test('drawAlertLines() tak membuat overlay alertLine untuk alert garis', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'horizontalStraightLine');

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    const created = await page.evaluate(() => {
      const calls = [];
      const orig = chart.createOverlay;
      chart.createOverlay = (opts) => { if (opts && opts.name === 'alertLine') calls.push(opts); return orig.call(chart, opts); };
      try { drawAlertLines(); } finally { chart.createOverlay = orig; }
      return calls;
    });
    expect(created, 'alert garis tak boleh menghasilkan overlay alertLine — garisnya sudah ADA sbg objek gambar').toHaveLength(0);
    assertNoPageErrors(page);
  });

  // Fix round 2 — review menemukan: `await flushPendingPushFor(inst)` polos bisa menggantung
  // SELAMANYA kalau koneksi ke /api/drawings STALL (server diam, bukan menolak) — fetch di
  // codebase ini tak pernah punya timeout sendiri. __setStallDrawings membuat stub MENAHAN
  // route tanpa fulfill sama sekali, meniru itu. Race timer (ALERT_FLUSH_TIMEOUT_MS, ~2dtk di
  // js/draw-alert.js) harus tetap membiarkan alert terbentuk dlm batas waktu wajar.
  test('flush gambar yang STALL tak menyandera Create — alert tetap terbentuk dlm batas waktu', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'horizontalStraightLine');

    await page.evaluate(() => __setStallDrawings(true));   // /api/drawings kini digantung stub, tak pernah fulfill

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), obj.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');

    // Timeout di sini (6dtk) sengaja jauh di atas ALERT_FLUSH_TIMEOUT_MS (~2dtk) + overhead —
    // marjin utk CI, bukan utk menutupi kemungkinan menggantung selamanya (kalau race-nya hilang,
    // ini akan timeout 6dtk lalu tetap merah, bukan macet tanpa batas — Playwright sendiri yang
    // membatasi expect.poll).
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);
    assertNoPageErrors(page);
  });
});

test.describe('alert garis: mengikuti objeknya', () => {
  async function buatAlert(page, name = 'horizontalRayLine') {
    const { obj, rect } = await drawTool(page, name);
    await page.evaluate((id) => createLineAlert(id, 'cross'), obj.id);
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);
    return { obj, rect };
  }

  test('menggeser garis memperbarui anchor alert di server', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await buatAlert(page);
    const sebelum = await page.evaluate(() => __alertRow(0));

    await dragBodyBy(page, obj, rect, 70);
    await page.waitForTimeout(1200);

    const sesudah = await page.evaluate(() => __alertRow(0));
    expect(sesudah.p1, 'anchor harga harus ikut bergeser').not.toBe(sebelum.p1);
    expect(sesudah.p1, 'sesudah geser pun kedua anchor harga tetap identik').toBe(sesudah.p2);
    assertNoPageErrors(page);
  });

  // I3: applyDrawsSnapshot (js/draw-undo.js) memanggil lapisan sync LANGSUNG, bukan lewat saveDraws()
  // — padahal saveDraws() satu-satunya pemanggil syncAlertAnchors(). Akibatnya: seret garis ber-alert
  // (anchor ikut), Ctrl+Z (garis kembali), tapi alertnya tetap mengawasi posisi yang barusan di-undo.
  test('undo sesudah menggeser mengembalikan anchor alert juga, bukan cuma garisnya', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await buatAlert(page);
    await page.waitForTimeout(600);   // snapshot awal tercatat di history
    const awal = await page.evaluate(() => __alertRow(0));

    await dragBodyBy(page, obj, rect, 70);
    await page.waitForTimeout(1200);
    const setelahGeser = await page.evaluate(() => __alertRow(0));
    expect(setelahGeser.p1, 'prasyarat: geser harus memindahkan anchor').not.toBe(awal.p1);

    await page.evaluate(() => undoDraw());
    await page.waitForTimeout(1200);

    const garis = await page.evaluate(() => { const o = chart.getOverlayById(drawIds[0]); return o ? o.points[0].value : null; });
    expect(garis, 'prasyarat: undo harus mengembalikan garisnya').toBeCloseTo(awal.p1, 6);
    const setelahUndo = await page.evaluate(() => __alertRow(0));
    expect(setelahUndo.p1, 'alert harus ikut kembali ke posisi sebelum digeser').toBeCloseTo(awal.p1, 6);
    expect(setelahUndo.p1, 'kedua anchor harga tetap identik').toBe(setelahUndo.p2);
    assertNoPageErrors(page);
  });

  test('menghapus garis menghapus alertnya', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await buatAlert(page);

    await page.evaluate((id) => chart.removeOverlay(id), obj.id);
    await expect.poll(async () => page.evaluate(() => __alertCount()), { timeout: 6000 }).toBe(0);
    assertNoPageErrors(page);
  });

  // Gerbang penyapuan: chart kosong SESAAT saat memuat tak boleh memusnahkan alert.
  test('memuat ulang instrumen TIDAK menghapus alert', async ({ page }) => {
    await gotoApp(page);
    await buatAlert(page);
    await page.waitForTimeout(2500);   // gambar tersimpan ke server

    await page.evaluate(() => loadInit(true));
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => __alertCount()), 'alert tak boleh hilang saat memuat ulang').toBe(1);
    assertNoPageErrors(page);
  });

  // I2 — temuan bernilai tertinggi review: gerbang lama cuma membuktikan pemuatan SELESAI, bukan
  // OTORITATIF. Kalau GET /api/drawings gagal, loadDrawsFor() jatuh ke cermin localStorage — yang
  // KOSONG di browser baru / jendela private / sesudah data situs dibersihkan. drawIds lalu kosong,
  // sweep menyimpulkan SEMUA alert kehilangan objeknya, dan menghapusnya di server tanpa bisa
  // dikembalikan. Predikat drawVer[inst]==null ("keadaan server tak diketahui") adalah predikat yang
  // SAMA yang sudah dipakai jalur dorong untuk menolak mendorong.
  test('GET gambar GAGAL + cermin lokal kosong → sweep TIDAK menghapus alert apa pun', async ({ page }) => {
    await gotoApp(page);
    await buatAlert(page);
    await page.waitForTimeout(2500);   // gambar tersimpan ke server

    await page.evaluate(() => {
      __setFailDrawings(true);                 // GET /api/drawings → 500
      Object.keys(localStorage).filter((k) => k.startsWith('br_draws_')).forEach((k) => localStorage.removeItem(k));
    });

    await page.evaluate(() => loadInit(true));
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => drawVer[inst]), 'prasyarat: keadaan server harus TAK diketahui').toBeNull();
    expect(await page.evaluate(() => drawIds.length), 'prasyarat: chart harus kosong (cermin dikosongkan)').toBe(0);
    expect(await page.evaluate(() => __alertCount()), 'pemuatan yang gagal tak boleh memusnahkan alert').toBe(1);
    assertNoPageErrors(page);
  });

  // I6: jalur BAHAGIA penyapuan dgn gambar SUNGGUHAN di dua simbol — test sweep satu-satunya
  // sebelumnya memakai alert yatim sintetis di atas kanvas kosong, jadi ia tak pernah membuktikan
  // sweep membiarkan alert yang objeknya memang ada, apalagi lintas ganti instrumen.
  test('ganti instrumen dgn gambar nyata di KEDUA simbol: kedua alert selamat', async ({ page }) => {
    await gotoApp(page);
    // Alert di EUR_USD (instrumen awal).
    await buatAlert(page);
    await page.waitForTimeout(2500);

    // Pindah ke GBP_USD, gambar + alert di sana juga.
    await page.evaluate(() => { $('#instrument').value = 'GBP_USD'; return loadInit(true); });
    await page.waitForTimeout(2000);
    const { obj: b } = await drawTool(page, 'horizontalStraightLine');
    await page.evaluate((id) => createLineAlert(id, 'cross'), b.id);
    await expect.poll(async () => page.evaluate(() => __alertCount()), { timeout: 6000 }).toBe(2);
    await page.waitForTimeout(2500);

    // Kembali ke EUR_USD: sweep jalan atas gambar EUR_USD yang otoritatif dari server.
    await page.evaluate(() => { $('#instrument').value = 'EUR_USD'; return loadInit(true); });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => __alertCount()), 'kedua alert punya objeknya masing-masing → tak boleh ada yang tersapu').toBe(2);

    // Dan sekali lagi ke GBP_USD, arah sebaliknya.
    await page.evaluate(() => { $('#instrument').value = 'GBP_USD'; return loadInit(true); });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => __alertCount()), 'arah sebaliknya pun sama').toBe(2);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: sweepAlertsForMissingDrawings() nge-snapshot `ada` (daftar did
  // di layar) sekali, tapi loopnya `await` dan membandingkan tiap alert ke `inst` yg LIVE. Kalau
  // pengguna ganti instrumen SAAT sweep sedang menunggu satu delete, alert instrumen BARU lolos
  // filter sym (krn dibandingkan ke inst yg sudah berganti) tapi diperiksa thd `ada` instrumen LAMA
  // → dianggap yatim → terhapus, padahal objeknya ada di layar (instrumen yg sedang dilihat
  // pengguna). Reproduksi lewat UI (drag chart sungguhan sambil ganti instrumen tepat di jendela
  // await) tak deterministik, jadi test ini memanggil sweep langsung & memaksa interleaving-nya via
  // monkey-patch deleteAlertsForDid (pola yg sama dgn drawAlertLines() di atas).
  test('sweep berhenti begitu instrumen berganti — alert instrumen baru tak ikut diperiksa/dihapus', async ({ page }) => {
    await gotoApp(page);

    const hasil = await page.evaluate(async () => {
      stopAlertPoll();   // cegah poll latar menimpa alert sintetis di bawah selama test berjalan
      const A = inst, B = 'GBP_USD';
      // Dua alert yatim (drawId-nya tak ada di `ada` manapun — chart kosong dari gambar): satu utk
      // instrumen SEKARANG (A), satu "milik" instrumen LAIN (B) yg akan jadi instrumen aktif
      // begitu sweep berpindah tengah-jalan — orphanB HARUS selamat, bukan diperiksa thd data A.
      alerts.push({ id: 90001, sym: A, drawId: 'orphanA', t1: 1, p1: 1, t2: 2, p2: 2 });
      alerts.push({ id: 90002, sym: B, drawId: 'orphanB', t1: 1, p1: 1, t2: 2, p2: 2 });

      const calls = [];
      const orig = deleteAlertsForDid;
      deleteAlertsForDid = async (did) => {
        calls.push(did);
        if (did === 'orphanA') inst = B;   // simulasi: pengguna ganti instrumen SAAT sweep await
        return orig(did);
      };
      try {
        await sweepAlertsForMissingDrawings();
      } finally {
        deleteAlertsForDid = orig;
        inst = A;
        startAlertPoll();
      }
      return { calls, sisa: alerts.map((a) => a.id) };
    });

    expect(hasil.calls, 'hanya alert instrumen AWAL (target) yg boleh diperiksa/dihapus').toEqual(['orphanA']);
    expect(hasil.sisa, 'alert instrumen BARU yg sedang dilihat pengguna harus selamat').toContain(90002);
    assertNoPageErrors(page);
  });

  // Fix round 1 — review menemukan: alertPoll() (js/forming-candle.js) menjatuhkan t1/p1/t2/p2 saat
  // menulis ulang `alerts` tiap ~2dtk, walau server mengembalikannya. Akibatnya cache anchor di
  // client jadi undefined dlm 2dtk sejak alert dibuat, dan gerbang "tak berubah → jangan kirim" di
  // syncAlertAnchors() SELALU menganggap berubah (undefined !== angka) → tiap saveDraws() (termasuk
  // yg dipicu gambar LAIN yg tak ada hubungannya) mem-POST ulang anchor semua alert garis, sia-sia.
  test('anchor tak berubah → saveDraws TIDAK mem-POST; anchor berubah → PERSIS satu POST', async ({ page }) => {
    await gotoApp(page);
    const { obj, rect } = await buatAlert(page);
    // Paksa satu putaran poll (dan hentikan pollingnya) → cache anchor di client terisi dari
    // respons server, meniru kondisi "sudah lewat >=1 siklus poll sejak alert dibuat" yg jadi
    // pemicu bug ini di dunia nyata.
    await page.evaluate(async () => { stopAlertPoll(); await alertPoll(); });

    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts/anchors')) posts.push(r.postDataJSON()); });

    // Simpan tanpa menggerakkan apa pun — anchor objeknya tak berubah dari yg di-cache.
    await page.evaluate(() => saveDraws());
    await page.waitForTimeout(500);
    expect(posts.length, 'anchor tak berubah → tak boleh mem-POST').toBe(0);

    // Sekarang geser badan garis — anchornya SUNGGUH berubah.
    await dragBodyBy(page, obj, rect, 70);
    await page.waitForTimeout(1200);

    expect(posts.length, 'anchor berubah → PERSIS satu POST, bukan nol atau lebih dari satu').toBe(1);
    assertNoPageErrors(page);
  });
});
