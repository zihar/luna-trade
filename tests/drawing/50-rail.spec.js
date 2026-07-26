// Rail drawing: arm 1-klik, caret + flyout, favorites, shortcut Alt+huruf, instant-drop,
// mode cursor, dan tabrakan nama `arrow` antar grup.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { openFlyout, overlays, setCursor, clickAt, CLICK_GAP_MS } = require('../helpers/draw');
const { TOOL_SPEC, RETIRED_TOOLS, CURSOR_MODES, withShortcut } = require('../helpers/spec');

const GROUPS = [...new Set(TOOL_SPEC.map((t) => t.group))];

test.describe('rail', () => {
  test('klik badan ikon = arm langsung (1-klik, tanpa buka flyout)', async ({ page }) => {
    await gotoApp(page);
    const cat = page.locator('#drawtools .dt-cat[data-cat="trend"]');
    const tool = await cat.getAttribute('data-tool');
    await cat.click();
    await expect(page.locator('#dtFlyout.show'), 'flyout tak boleh terbuka saat badan ikon diklik').toHaveCount(0);
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    const prog = await page.evaluate(() => chart.getOverlayById(inProgressId).name);
    expect(prog, 'tool yang armed harus = tool terakhir grup').toBe(tool);
    assertNoPageErrors(page);
  });

  test('caret membuka flyout berisi seluruh tool grup itu', async ({ page }) => {
    await gotoApp(page);
    for (const g of GROUPS) {
      await openFlyout(page, g);
      const names = await page.locator('#dtFlyout .dt-item .dt-nm').allTextContents();
      const expected = TOOL_SPEC.filter((t) => t.group === g).map((t) => t.title);
      expect(names, `isi flyout grup ${g}`).toEqual(expected);
      await page.keyboard.press('Escape');
    }
    assertNoPageErrors(page);
  });

  test('memilih tool dari flyout mengubah ikon grup jadi tool itu (sticky)', async ({ page }) => {
    await gotoApp(page);
    await openFlyout(page, 'shapes');
    await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Ellipse$/ }) }).click();
    const cat = page.locator('#drawtools .dt-cat[data-cat="shapes"]');
    await expect(cat).toHaveAttribute('data-tool', 'ellipse');
    // Sticky: setelah reload, grup masih ingat pilihan terakhir (br_lasttool_*).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof chart !== 'undefined' && chart.getDataList().length > 0, null, { timeout: 20000 });
    await expect(page.locator('#drawtools .dt-cat[data-cat="shapes"]')).toHaveAttribute('data-tool', 'ellipse');
    assertNoPageErrors(page);
  });
});

test.describe('favorites', () => {
  test('bintang di flyout memunculkan tool di favorites bar & bar-nya bisa arm', async ({ page }) => {
    await gotoApp(page);
    await openFlyout(page, 'shapes');
    const item = page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Circle$/ }) });
    await item.locator('.dt-fav').click();
    await expect(item.locator('.dt-fav')).toHaveClass(/on/);
    await page.keyboard.press('Escape');

    const bar = page.locator('#favBar');
    await expect(bar).toHaveClass(/show/);
    await expect(bar.locator('.favbar-btn')).toHaveCount(1);

    await bar.locator('.favbar-btn').first().click();
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('circle');
    assertNoPageErrors(page);
  });

  test('favorites bar bisa digeser lewat grip & posisinya tersimpan', async ({ page }) => {
    await gotoApp(page);
    await openFlyout(page, 'shapes');
    await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Circle$/ }) }).locator('.dt-fav').click();
    await page.keyboard.press('Escape');

    const bar = page.locator('#favBar');
    const before = await bar.boundingBox();
    const grip = bar.locator('.favbar-grip');
    const gb = await grip.boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + gb.height / 2 + 80, { steps: 10 });
    await page.mouse.up();

    const after = await bar.boundingBox();
    expect(Math.abs(after.x - before.x), 'bar harus bergeser horizontal').toBeGreaterThan(50);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('br_favBarPos') || 'null'));
    expect(saved, 'posisi favorites bar harus tersimpan').toBeTruthy();
    assertNoPageErrors(page);
  });
});

test.describe('shortcut Alt+huruf', () => {
  for (const spec of withShortcut()) {
    test(`Alt+${spec.sc} meng-arm ${spec.name}`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);
      // Pointer harus di atas chart: jalur instant-drop (H/V) mengambil posisi dari lastPtr
      // dan jatuh kembali ke mode gambar bila cursor di luar chart (index.html:3135).
      await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.45, { steps: 4 });
      await page.keyboard.press(`Alt+${spec.sc}`);

      if (spec.name === 'horizontalStraightLine' || spec.name === 'verticalStraightLine') {
        // instant-drop: objek langsung jadi TANPA klik.
        await expect.poll(async () => (await overlays(page)).length, { timeout: 3000 }).toBe(1);
        expect((await overlays(page))[0].name).toBe(spec.name);
        expect(await page.evaluate(() => inProgressId), 'instant-drop tak boleh menyisakan mode gambar').toBeNull();
      } else {
        await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
        expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe(spec.name);
      }
      assertNoPageErrors(page);
    });
  }

  test('instant-drop tak boleh memakai posisi kursor BASI saat pointer di luar chart', async ({ page }) => {
    // Niat yang tertulis di kode (index.html:3131-3137): instantDropPoint mengembalikan null
    // bila cursor di LUAR chart → jatuh ke mode gambar biasa. Tapi lastPtr hanya di-update
    // oleh mousemove pada #chart (index.html:3299), jadi ia tak pernah berisi koordinat di
    // luar chart: shortcut yang ditekan sambil kursor berada di watchlist/header akan
    // menjatuhkan garis di posisi kursor TERAKHIR di dalam chart, tanpa diminta.
    await gotoApp(page);
    const rect = await chartRect(page);
    // Tinggalkan jejak posisi di dalam chart, lalu pindah ke luar chart.
    await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5, { steps: 4 });
    await page.mouse.move(5, 5, { steps: 4 });

    await page.keyboard.press('Alt+H');
    await page.waitForTimeout(300);

    const objs = await overlays(page);
    const dropped = objs.filter((o) => o.points.length > 0);
    expect(dropped, 'garis tak boleh langsung jatuh saat kursor di luar chart').toHaveLength(0);
    assertNoPageErrors(page);
  });
});

test.describe('mode cursor', () => {
  for (const m of CURSOR_MODES) {
    test(`${m.name}: crosshair ${m.crosshair ? 'aktif' : 'mati'}${m.line ? ' + garis' : ''}`, async ({ page }) => {
      await gotoApp(page);
      await setCursor(page, m.name);
      const st = await page.evaluate(() => {
        const c = chart.getStyles().crosshair;
        return { show: c.show, hLine: c.horizontal && c.horizontal.line && c.horizontal.line.show, vLine: c.vertical && c.vertical.line && c.vertical.line.show };
      });
      expect(st.show, `crosshair.show untuk ${m.name}`).toBe(m.crosshair);
      if (m.crosshair) {
        expect(st.hLine, `garis crosshair untuk ${m.name}`).toBe(m.line);
        expect(st.vLine, `garis crosshair untuk ${m.name}`).toBe(m.line);
      }
      expect(await page.evaluate(() => document.body.classList.contains('eraser-on'))).toBe(m.name === 'eraser');
      assertNoPageErrors(page);
    });
  }

  test('mengganti mode cursor membatalkan gambar yang sedang berjalan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#drawtools .dt-cat[data-cat="trend"]').click();
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    await clickAt(page, rect, { x: Math.round(rect.width * 0.4), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);

    await setCursor(page, 'dot');
    expect(await page.evaluate(() => inProgressId)).toBeNull();
    expect(await overlays(page), 'overlay setengah jadi harus dibuang').toHaveLength(0);
    assertNoPageErrors(page);
  });
});

test.describe('tool yang ditarik', () => {
  // Temuan 3: simpleAnnotation & simpleTag ditarik dari rail karena semua figure-nya ber-
  // `ignoreEvent` (tak bisa di-hover/dipilih/di-drag/dihapus lewat klik) dan keduanya redundan
  // dengan tool yang sudah bekerja. Test ini menjaga agar tak diam-diam kembali: menghidupkannya
  // lagi WAJIB lewat pendaftaran ulang sendiri tanpa ignoreEvent, bukan dengan menambahkan
  // entri rail-nya kembali.
  test('tak muncul di rail mana pun (nama & label)', async ({ page }) => {
    await gotoApp(page);
    const names = await page.evaluate(() => DRAW_GROUPS.flatMap((g) => g.tools.map((t) => t.name)));
    const titles = await page.evaluate(() => DRAW_GROUPS.flatMap((g) => g.tools.map((t) => t.title)));
    for (const r of RETIRED_TOOLS) {
      expect(names, `${r.name} sudah ditarik (${r.why})`).not.toContain(r.name);
      expect(titles, `label "${r.title}" sudah ditarik`).not.toContain(r.title);
    }
    // …dan tak ikut di-persist, supaya objek lama di localStorage berhenti dimuat sendiri.
    const persisted = await page.evaluate(() => Object.keys(PERSIST_DRAW));
    for (const r of RETIRED_TOOLS) expect(persisted, `${r.name} tak boleh ada di PERSIST_DRAW`).not.toContain(r.name);
    assertNoPageErrors(page);
  });
});

test.describe('tabrakan nama tool', () => {
  test('`arrow` ada di grup Cursor DAN Shapes — keduanya harus bisa dipakai', async ({ page }) => {
    // toolByName('arrow') (index.html:3532) mengembalikan yang PERTAMA (cursor), sedangkan
    // OBJ_TITLE (index.html:5550) dibangun "definisi belakang menang" → arrow = shape.
    // Dua sumber kebenaran untuk satu nama; test ini menegaskan konsekuensi praktisnya.
    await gotoApp(page);

    // Cursor Arrow → mematikan crosshair, TIDAK membuat overlay.
    await setCursor(page, 'arrow');
    expect(await page.evaluate(() => chart.getStyles().crosshair.show)).toBe(false);
    expect(await overlays(page)).toHaveLength(0);

    // Shapes Arrow → overlay bernama 'arrow'.
    await openFlyout(page, 'shapes');
    await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: /^Arrow$/ }) }).click();
    await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).name)).toBe('arrow');

    // Konsekuensi yang bisa dilihat pengguna: header modal objek memakai judul SHAPE.
    expect(await page.evaluate(() => OBJ_TITLE.arrow)).toBe('Arrow');

    // Dan inilah inkonsistensinya, ditegaskan supaya terlihat: dua sumber kebenaran untuk
    // satu nama. toolByName() (dipakai favorites bar & restore tool terakhir) mengembalikan
    // varian CURSOR, sedangkan OBJ_TITLE/OBJ_ICON (dipakai header modal) memberi varian SHAPE.
    // Efek nyata: mem-favorite shape Arrow menghasilkan tombol dengan tooltip cursor.
    const byName = await page.evaluate(() => ({ title: toolByName('arrow').title, group: (groupOfTool('arrow') || {}).key }));
    expect(byName.title, 'toolByName("arrow") mengembalikan varian cursor — bukan shape').toBe('Arrow (no crosshair)');
    expect(byName.group, 'groupOfTool("arrow") juga menunjuk grup cursor').toBe('cursor');
    assertNoPageErrors(page);
  });
});
