// Ctrl/⌘+C & Ctrl/⌘+V objek gambar — clipboard aplikasi, paste mendarat di kursor.
// Spec: docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');
const { dataList } = require('../helpers/chart');

/** Gambar satu trendline di posisi yang bisa diprediksi, kembalikan objek + pixel titiknya. */
async function drawLine(page, rect) {
  const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
  const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  const obj = (await overlays(page))[0];
  return { obj, px: await toPixels(page, obj.points) };
}

/** Gambar satu verticalStraightLine (BAR_ANCHOR, 1 klik) — kembalikan objek + pixel titiknya. */
async function drawVLine(page, rect) {
  const p = { x: Math.round(rect.width * 0.4), y: Math.round(rect.height * 0.5) };
  await armTool(page, 'verticalStraightLine');
  await clickAt(page, rect, p);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  const obj = (await overlays(page))[0];
  return { obj, px: await toPixels(page, obj.points) };
}

/** Gambar satu priceChannelLine (builtin, 3 klik, TANPA invariant kotak BOX_TOOLS). */
async function drawChannel(page, rect) {
  const pts = [
    { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.3) },
    { x: Math.round(rect.width * 0.5), y: Math.round(rect.height * 0.5) },
    { x: Math.round(rect.width * 0.5), y: Math.round(rect.height * 0.7) },
  ];
  await armTool(page, 'priceChannelLine');
  for (const p of pts) {
    await clickAt(page, rect, p);
    await page.waitForTimeout(CLICK_GAP_MS);
  }
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  const obj = (await overlays(page))[0];
  return { obj, px: await toPixels(page, obj.points) };
}

/** Objek selain `id` — yang baru lahir dari paste. */
async function otherThan(page, id) {
  const all = await overlays(page);
  const o = all.find((x) => x.id !== id);
  return o ? { obj: o, px: await toPixels(page, o.points) } : null;
}

test.describe('copy/paste objek: API', () => {
  test('copy lalu paste → 2 objek, bentuk sama, titik-1 mendarat di titik paste', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawLine(page, rect);

    expect(await page.evaluate(() => copyOverlay()), 'copyOverlay harus true untuk objek terpilih').toBe(true);

    const target = { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.7) };
    await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'paste harus menambah satu objek').toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - target.x), 'titik-1 tak mendarat di X titik paste').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - target.y), 'titik-1 tak mendarat di Y titik paste').toBeLessThanOrEqual(1);
    // Bentuk = jarak antar titik dalam PIKSEL, persis yang direkam saat copy.
    expect(Math.abs((baru.px[1].x - baru.px[0].x) - (px[1].x - px[0].x)), 'lebar bentuk berubah').toBeLessThanOrEqual(1);
    expect(Math.abs((baru.px[1].y - baru.px[0].y) - (px[1].y - px[0].y)), 'tinggi bentuk berubah').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  test('tanpa objek terpilih: copy gagal & paste tak membuat apa pun', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.keyboard.press('Escape'); // lepas pilihan
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => selectedId), 'prasyarat: tak ada objek terpilih').toBeNull();

    expect(await page.evaluate(() => copyOverlay()), 'copy tanpa seleksi harus false').toBe(false);
    expect(await page.evaluate(() => drawClip), 'clipboard tak boleh terisi').toBeNull();
    expect(await page.evaluate(() => pasteOverlayAt(50, 50)), 'paste dgn clipboard kosong harus null').toBeNull();
    expect(await overlays(page), 'tak boleh ada objek baru').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('salinan mewarisi gaya & teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    await page.evaluate((id) => {
      setObjStyle(id, { color: '#ff00aa', size: 4, style: 'dashed' });
      chart.overrideOverlay({ id, extendData: 'HALO' });
    }, obj.id);
    await page.waitForTimeout(120);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(80, 80); });
    await page.waitForTimeout(150);

    const baru = await otherThan(page, obj.id);
    const salinan = await page.evaluate((id) => {
      const o = chart.getOverlayById(id);
      return { style: objStyle[id] || null, text: o && typeof o.extendData === 'string' ? o.extendData : null };
    }, baru.obj.id);
    expect(salinan.style, 'salinan kehilangan gaya per-objek').toBeTruthy();
    expect(salinan.style.color, 'warna tak tersalin').toBe('#ff00aa');
    expect(salinan.style.size, 'tebal tak tersalin').toBe(4);
    expect(salinan.text, 'teks tak tersalin').toBe('HALO');
    // `lock` sengaja TIDAK ikut tersalin: salinan yang lahir terkunci hanya menjebak.
    expect(await page.evaluate((id) => !!(chart.getOverlayById(id) || {}).lock, baru.obj.id), 'hasil paste tak boleh terkunci').toBe(false);
    assertNoPageErrors(page);
  });

  test('paste dua kali di dua posisi → 3 objek, masing-masing di tempatnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const a = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.25) };
    const b = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.75) };
    const ids = await page.evaluate(([pa, pb]) => {
      copyOverlay();
      return [pasteOverlayAt(pa.x, pa.y), pasteOverlayAt(pb.x, pb.y)];
    }, [a, b]);
    await page.waitForTimeout(150);

    expect(await overlays(page), 'dua paste harus menghasilkan 3 objek').toHaveLength(3);
    expect(ids[0], 'paste pertama tak mengembalikan id').toBeTruthy();
    expect(ids[1], 'paste kedua tak mengembalikan id').toBeTruthy();
    expect(ids[0], 'dua paste menghasilkan id yang sama').not.toBe(ids[1]);
    const all = await overlays(page);
    for (const [id, t] of [[ids[0], a], [ids[1], b]]) {
      const p = await toPixels(page, all.find((o) => o.id === id).points);
      expect(Math.abs(p[0].y - t.y), `objek ${id} tak mendarat di Y-nya`).toBeLessThanOrEqual(1);
    }
    assertNoPageErrors(page);
  });

  // Premis inti dari seluruh refactor descOf/createFromDesc (js/draw-clone.js): clipboard harus
  // hidup lebih lama dari objek sumbernya. Sebelum refactor ini, cloneOverlay(id,pts) membaca
  // objeknya lewat chart.getOverlayById(id) — kalau objek sumber sudah dihapus sebelum di-paste,
  // paste akan gagal diam-diam. Tak ada test yang menagih janji ini sampai sekarang.
  test('clipboard bertahan walau objek sumber sudah dihapus', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    expect(await page.evaluate(() => copyOverlay()), 'copy harus berhasil sebelum objek dihapus').toBe(true);

    await page.evaluate((id) => chart.removeOverlay(id), obj.id);
    await expect.poll(async () => (await overlays(page)).length).toBe(0);

    const target = { x: 80, y: 80 };
    const nid = await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    expect(nid, 'paste harus tetap berhasil walau objek sumber sudah tak ada').toBeTruthy();

    const all = await overlays(page);
    expect(all, 'paste harus menghasilkan tepat satu objek').toHaveLength(1);
    const px = await toPixels(page, all[0].points);
    expect(Math.abs(px[0].x - target.x), 'titik-1 tak mendarat di X titik paste').toBeLessThanOrEqual(1);
    expect(Math.abs(px[0].y - target.y), 'titik-1 tak mendarat di Y titik paste').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  test('objek hasil paste TERPILIH, tanpa membuka editor teks', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    const nid = await page.evaluate(() => { copyOverlay(); return pasteOverlayAt(90, 90); });
    await page.waitForTimeout(400); // editor teks inline muncul lewat timer 220ms — beri ruang lewat

    expect(await page.evaluate(() => selectedId), 'objek hasil paste harus terpilih').toBe(nid);
    expect(await page.locator('textarea.text-editor').count(), 'paste tak boleh membuka editor teks inline').toBe(0);
    assertNoPageErrors(page);
  });

  test('hasil paste selamat dari reload & bisa di-undo', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(70, 70); });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(2);
    await page.waitForTimeout(600); // scheduleSaveDraws (350ms) harus sempat menulis

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(1);

    await page.keyboard.press('Control+Shift+z'); // redo → kembali 2
    await expect.poll(async () => (await overlays(page)).length, { timeout: 4000 }).toBe(2);
    await page.waitForTimeout(600);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined',
      null,
      { timeout: 20000 }
    );
    await expect.poll(async () => (await overlays(page)).length, { timeout: 5000 }).toBe(2);
  });
});

test.describe('copy/paste objek: hotkey', () => {
  for (const mod of ['Control', 'Meta']) {
    test(`${mod}+C lalu ${mod}+V → salinan mendarat di kursor`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      const { obj, px } = await drawLine(page, rect);

      await page.keyboard.press(`${mod}+c`);
      expect(await page.evaluate(() => drawClip != null), `${mod}+C tak mengisi clipboard`).toBe(true);

      const target = { x: Math.round(rect.width * 0.22), y: Math.round(rect.height * 0.72) };
      await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 4 });
      await page.keyboard.press(`${mod}+v`);
      await page.waitForTimeout(200);

      expect(await overlays(page), `${mod}+V harus menambah satu objek`).toHaveLength(2);
      const baru = await otherThan(page, obj.id);
      expect(Math.abs(baru.px[0].x - target.x), 'tak mendarat di X kursor').toBeLessThanOrEqual(1);
      expect(Math.abs(baru.px[0].y - target.y), 'tak mendarat di Y kursor').toBeLessThanOrEqual(1);
      expect(Math.abs((baru.px[1].x - baru.px[0].x) - (px[1].x - px[0].x)), 'bentuk berubah').toBeLessThanOrEqual(1);
      assertNoPageErrors(page);
    });
  }

  test('Ctrl+V tanpa copy: tak terjadi apa-apa', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 4 });
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    expect(await overlays(page), 'paste dgn clipboard kosong tak boleh membuat objek').toHaveLength(1);
    assertNoPageErrors(page);
  });

  test('kursor di LUAR chart: salinan mendarat di tengah chart', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);

    await page.keyboard.press('Control+c');
    // Keluar dari #chart → ptrOverChart harus padam (mouseleave), bukan sekadar koordinat berubah.
    await page.mouse.move(rect.x + rect.width / 2, Math.max(2, rect.y - 30), { steps: 6 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => ptrOverChart), 'prasyarat: pointer harus tercatat di luar chart').toBe(false);

    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    expect(await overlays(page)).toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - rect.width / 2), 'tak mendarat di tengah X').toBeLessThanOrEqual(2);
    expect(Math.abs(baru.px[0].y - rect.height / 2), 'tak mendarat di tengah Y').toBeLessThanOrEqual(2);
    assertNoPageErrors(page);
  });

  // Menyalin harga dari panel trades tak boleh diam-diam berubah jadi menyalin objek gambar.
  test('ada teks terseleksi di halaman: Ctrl+C dibiarkan ke browser', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await page.evaluate(() => {
      const s = document.createElement('span');
      s.id = 'e2e-sel';
      s.textContent = 'harga 1.2345';
      document.body.appendChild(s);
      const r = document.createRange();
      r.selectNodeContents(s);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });

    await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => drawClip), 'clipboard objek tak boleh terisi saat ada teks terseleksi').toBeNull();
    assertNoPageErrors(page);
  });
});

test.describe('copy/paste objek: menu klik-kanan', () => {
  /** Klik-kanan di area kosong chart, kembalikan daftar item menu yang terlihat. */
  async function openMenuAt(page, rect, p) {
    await page.mouse.click(rect.x + p.x, rect.y + p.y, { button: 'right' });
    await page.waitForTimeout(200);
    return page.$$eval('.ctxmenu .ctxitem', (els) =>
      els.map((el) => ({ label: el.textContent, disabled: el.classList.contains('disabled') }))
    );
  }

  test('item Paste redup saat clipboard kosong, aktif sesudah copy', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const kosong = { x: Math.round(rect.width * 0.12), y: Math.round(rect.height * 0.15) };

    let items = await openMenuAt(page, rect, kosong);
    let paste = items.find((i) => /paste/i.test(i.label));
    expect(paste, 'item Paste tak ada di menu klik-kanan').toBeTruthy();
    expect(paste.disabled, 'Paste harus redup saat clipboard kosong').toBe(true);

    // Tutup menu dgn klik kiri (hideCtx dipasang di event `click` window — Escape tak menutupnya),
    // supaya menu yang masih terbuka tak menelan klik pertama saat menggambar.
    await page.mouse.click(rect.x + Math.round(rect.width * 0.8), rect.y + Math.round(rect.height * 0.85));
    await page.waitForTimeout(150);
    const { obj } = await drawLine(page, rect);
    await page.keyboard.press('Control+c');

    items = await openMenuAt(page, rect, kosong);
    paste = items.find((i) => /paste/i.test(i.label));
    expect(paste.disabled, 'Paste harus aktif sesudah copy').toBe(false);
    expect(await page.evaluate((id) => selectedId === id, obj.id), 'prasyarat: objek yang disalin memang terpilih').toBe(true);
    assertNoPageErrors(page);
  });

  test('Paste dari menu menempatkan objek di titik yang diklik-kanan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawLine(page, rect);
    await page.keyboard.press('Control+c');

    const titik = { x: Math.round(rect.width * 0.14), y: Math.round(rect.height * 0.2) };
    await page.mouse.click(rect.x + titik.x, rect.y + titik.y, { button: 'right' });
    await page.waitForTimeout(200);
    const idx = await page.$$eval('.ctxmenu .ctxitem', (els) => els.findIndex((el) => /paste/i.test(el.textContent)));
    expect(idx, 'item Paste tak ketemu').toBeGreaterThanOrEqual(0);
    await page.locator('.ctxmenu .ctxitem').nth(idx).click();
    await page.waitForTimeout(250);

    expect(await overlays(page), 'Paste dari menu harus menambah objek').toHaveLength(2);
    const baru = await otherThan(page, obj.id);
    expect(Math.abs(baru.px[0].x - titik.x), 'tak mendarat di X titik klik-kanan').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - titik.y), 'tak mendarat di Y titik klik-kanan').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });
});

test.describe('copy/paste objek: cabang anchor yang belum tersentuh', () => {
  // Semua test paste di atas memakai trendline — tool SUB-BAR (fracAnchorFromPx). Cabang
  // BAR_ANCHOR di anchorFromPx (js/util.js) — xAnchorFromPx + snap verticalStraightLine ke bar
  // lewat snapTimeToBar — tak pernah dilewati paste sampai sekarang.
  test('paste verticalStraightLine (BAR_ANCHOR): X mendarat di bar terdekat, bukan piksel mentah', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawVLine(page, rect);

    expect(await page.evaluate(() => copyOverlay())).toBe(true);
    const target = { x: Math.round(rect.width * 0.65), y: Math.round(rect.height * 0.3) };
    const nid = await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    expect(nid).toBeTruthy();

    const baru = await otherThan(page, obj.id);
    expect(baru.obj.name, 'salinan harus tetap verticalStraightLine').toBe('verticalStraightLine');

    // Ekspektasi diturunkan lewat converter chart (dataList + toPixels), BUKAN via anchorFromPx/
    // snapTimeToBar langsung — supaya test tak sekadar membandingkan kode dgn dirinya sendiri:
    // bar TERDEKAT secara piksel terhadap titik paste, di antara SEMUA bar yang di-render chart.
    const bars = await dataList(page);
    const barPx = await toPixels(page, bars.map((b) => ({ timestamp: b.timestamp, value: 0 })));
    let bestX = null, bestD = Infinity;
    for (const p of barPx) { if (!p) continue; const d = Math.abs(p.x - target.x); if (d < bestD) { bestD = d; bestX = p.x; } }
    expect(bestX, 'prasyarat: harus ada bar yang bisa dikonversi ke piksel').not.toBeNull();

    expect(Math.abs(baru.px[0].x - bestX), 'X titik-1 tak snap ke bar terdekat').toBeLessThanOrEqual(1);
    assertNoPageErrors(page);
  });

  // Spec menyatakan objek >2 titik (channel/fib/posisi) lewat jalur yang SAMA tanpa perlakuan
  // khusus — offset direkam per titik. Ini pembuktian klaim itu, bukan cuma trendline 2-titik.
  test('paste objek multi-titik (priceChannelLine): jumlah titik & bentuk terjaga', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj, px } = await drawChannel(page, rect);
    expect(px.length, 'prasyarat: channel harus punya 3 titik').toBe(3);

    expect(await page.evaluate(() => copyOverlay())).toBe(true);
    const target = { x: Math.round(rect.width * 0.15), y: Math.round(rect.height * 0.2) };
    const nid = await page.evaluate(([x, y]) => pasteOverlayAt(x, y), [target.x, target.y]);
    expect(nid).toBeTruthy();

    const baru = await otherThan(page, obj.id);
    expect(baru.px.length, 'jumlah titik channel harus tetap 3 setelah paste').toBe(3);
    expect(Math.abs(baru.px[0].x - target.x), 'titik-1 tak mendarat di X titik paste').toBeLessThanOrEqual(1);
    expect(Math.abs(baru.px[0].y - target.y), 'titik-1 tak mendarat di Y titik paste').toBeLessThanOrEqual(1);
    for (let i = 1; i < px.length; i++) {
      expect(Math.abs((baru.px[i].x - baru.px[0].x) - (px[i].x - px[0].x)), `offset X titik #${i} berubah`).toBeLessThanOrEqual(1);
      expect(Math.abs((baru.px[i].y - baru.px[0].y) - (px[i].y - px[0].y)), `offset Y titik #${i} berubah`).toBeLessThanOrEqual(1);
    }
    assertNoPageErrors(page);
  });
});
