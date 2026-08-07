// Magnet (snap ke OHLC), ganti timeframe, dan titik di area future.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect, toPixels, barAt, barSpace, plotWidth } = require('../helpers/chart');
const { armTool, clickAt, overlays, drawTool, dragPoint, inProgress, CLICK_GAP_MS } = require('../helpers/draw');

test.describe('magnet', () => {
  test('magnet ON: titik menempel ke salah satu nilai OHLC candle terdekat', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);

    await page.locator('#magBtn').click();
    await expect(page.locator('#magBtn')).toHaveClass(/armed/);
    expect(await page.evaluate(() => magnetOn)).toBe(true);

    // Klik di antara level OHLC (bukan tepat di salah satunya) → harus tertarik ke OHLC.
    const targets = [
      { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.47) },
      { x: Math.round(rect.width * 0.6), y: Math.round(rect.height * 0.33) },
    ];
    await armTool(page, 'trendline');
    for (const t of targets) {
      await clickAt(page, rect, t);
      await page.waitForTimeout(CLICK_GAP_MS);
    }
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    expect(obj, 'objek harus terbentuk').toBeTruthy();

    // Tiap titik harus persis sama dengan salah satu O/H/L/C dari SEBUAH bar di dataset.
    const snapped = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          const list = chart.getDataList();
          return list.some((d) => [d.open, d.high, d.low, d.close].some((v) => Math.abs(v - p.value) < 1e-9));
        }),
      obj.points
    );
    snapped.forEach((ok, i) => expect(ok, `titik #${i} tak menempel ke nilai OHLC mana pun (magnet ON)`).toBe(true));
    assertNoPageErrors(page);
  });

  test('magnet ON: preview juga sudah menempel (mode strong_magnet), bukan cuma hasil akhir', async ({ page }) => {
    // index.html pra-Fase-2:3129-3132 — magnet ON menyetel mode overlay ke 'strong_magnet' supaya garis
    // preview langsung nempel. Kalau hanya hasil akhir yang nempel, objek akan "melompat"
    // ke OHLC saat klik terakhir.
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();
    await armTool(page, 'trendline');

    await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.47) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.mouse.move(rect.x + Math.round(rect.width * 0.6), rect.y + Math.round(rect.height * 0.33), { steps: 8 });
    await page.waitForTimeout(120);

    const prog = await inProgress(page);
    expect(prog, 'overlay in-progress harus ada').toBeTruthy();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode), 'mode overlay saat magnet ON').toBe('strong_magnet');

    const onOhlc = await page.evaluate((pts) => {
      const list = chart.getDataList();
      return pts.filter(Boolean).map((p) => list.some((d) => [d.open, d.high, d.low, d.close].some((v) => Math.abs(v - p.value) < 1e-9)));
    }, prog.points);
    expect(onOhlc.some(Boolean), 'setidaknya satu titik preview harus sudah menempel ke OHLC').toBe(true);
    assertNoPageErrors(page);
  });

  // "Nempel ke SUATU OHLC" (test di atas) ternyata jauh lebih longgar dari yang dijanjikan magnet:
  // ia lolos walau titik mendarat di bar lain atau di ujung yang salah. Dua test berikut memaku
  // janji sebenarnya — kursor tepat di ujung wick harus mendarat DI UJUNG ITU.
  //
  // Kondisi yang dipasang di bawah bukan buatan: tiap TF di-load 5000 bar (js/switch-tf.js), jadi
  // TF halus SELALU menutup rentang waktu jauh lebih pendek daripada TF kasar yang sedang tampil.
  // Begitu pengguna pernah membuka TF halus, `finestLoadedTF()` memilihnya sebagai sumber nilai
  // OHLC — dan di bagian rentang yang tak tertutup penuh, ujung wick yang TAMPAK tak pernah jadi
  // kandidat sama sekali. Harness hermetik menyajikan fixture yang sama untuk semua granularity,
  // jadi kondisinya dipasang langsung ke tfData.
  test('magnet: kursor di ujung wick mendarat di ujung itu walau TF halus tak menutup penuh', async ({ page }) => {
    await gotoApp(page);

    const res = await page.evaluate(() => {
      const cur = currentTF;
      const arr = revealed(cur).slice();

      // TF halus yang ter-load hanya memuat AWAL tiap bar — bagian yang memuat high/low
      // sebenarnya tidak ikut (persis seperti jendela TF halus yang lebih pendek/terpotong).
      const fine = arr.map((d) => {
        const mid = (d.open + d.close) / 2;
        return { timestamp: d.timestamp, open: d.open, high: Math.max(d.open, mid), low: Math.min(d.open, mid), close: mid };
      });
      tfData.M1 = fine;

      const rows = [];
      for (let i = arr.length - 12; i < arr.length - 2; i++) {
        const d = arr[i];
        for (const [kind, want] of [
          ['high', d.high],
          ['low', d.low],
        ]) {
          const s = magnetSnap(d.timestamp, want, 0, 0); // kursor TEPAT di ujung
          rows.push({ kind, want, got: s && s.value });
        }
      }
      delete tfData.M1;
      return { finest: 'M1', rows };
    });

    const meleset = res.rows.filter((r) => r.got == null || Math.abs(r.got - r.want) > 1e-9);
    expect(
      meleset,
      `magnet tak mendarat di ujung wick padahal kursor tepat di sana: ${JSON.stringify(meleset.slice(0, 4))}`
    ).toEqual([]);

    assertNoPageErrors(page);
  });

  test('magnet: penyempurnaan M5 tak menarik titik keluar dari ujung wick yang tampak', async ({ page }) => {
    await gotoApp(page);

    const res = await page.evaluate(async () => {
      const cur = currentTF;
      const arr = revealed(cur).slice();
      const bar = arr[arr.length - 6];

      // Jendela M5 yang TIDAK memuat ujung bar — nyata terjadi saat rentang bar lebih panjang
      // dari yang muat diambil sekali (MN: count di-clamp 5000 → ~17 hari dari sebulan penuh),
      // atau saat permintaan M5 balik tak lengkap.
      const mid = (bar.open + bar.close) / 2;
      window.ensureM5Window = async () => [
        { timestamp: bar.timestamp, open: bar.open, high: Math.max(bar.open, mid), low: Math.min(bar.open, mid), close: mid },
      ];

      // trendline, BUKAN horizontalStraightLine: yang terakhir ada di MAGNET_REFINE_SKIP, jadi
      // test-nya akan lolos tanpa pernah menjalankan jalur yang diuji.
      const id = chart.createOverlay({
        name: 'trendline',
        points: [
          { timestamp: bar.timestamp, value: bar.high }, // titik PERSIS di ujung high
          { timestamp: arr[arr.length - 3].timestamp, value: bar.close },
        ],
      });
      await refineMagnetPoints(id);
      const o = chart.getOverlayById(id);
      const after = o && o.points && o.points[0] ? o.points[0].value : null;
      chart.removeOverlay({ id });
      return { want: bar.high, after };
    });

    expect(res.after, 'titik yang sudah tepat di high digeser oleh penyempurnaan M5').toBeCloseTo(res.want, 9);
    assertNoPageErrors(page);
  });

  // Janji magnet yang sebenarnya diminta: titik nempel ke SEBUAH titik OHLC candle — sebuah
  // koordinat DISKRIT (x candle, harga OHLC). Menggeser kursor beberapa piksel di dalam candle
  // yang sama tak boleh menggeser titiknya sama sekali; yang boleh memindahkannya cuma pindah
  // candle atau pindah ke level OHLC lain.
  //
  // Dua hal yang dulu melanggarnya, keduanya membuat titik "mengikuti kursor":
  //   1. sumbu X tak pernah di-snap — tool sub-bar meng-anchor dataIndex PECAHAN di kursor,
  //      jadi geser 3px = titik geser 3px (terukur: dataIndex 492 → 492.375);
  //   2. daftar harga kandidat memuai begitu TF halus ter-load — tiap sub-bar menyumbang O/H/L/C
  //      sendiri (terukur: 4 → 45 nilai berbeda di satu bar M15, ±1.4px per kandidat di wick
  //      setinggi 62px) sehingga magnet praktis kontinu.
  const smallOffsets = [
    { dx: 0, dy: 0 },
    { dx: 3, dy: 3 },
    { dx: -3, dy: 4 },
  ];

  test('magnet ON: geser kursor beberapa piksel DI DALAM candle yang sama → titik tak bergeser', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();

    const bar = await barAt(page, -8);
    const far = await barAt(page, -4);
    const [pxH, pxL, pxFar] = await toPixels(page, [
      { timestamp: bar.timestamp, value: bar.high },
      { timestamp: bar.timestamp, value: bar.low },
      { timestamp: far.timestamp, value: far.close },
    ]);
    const midY = (pxH.y + pxL.y) / 2; // sengaja di TENGAH wick: paling peka terhadap kandidat rapat

    const landed = [];
    for (const off of smallOffsets) {
      await page.evaluate(() => {
        drawIds.slice().forEach((id) => { try { chart.removeOverlay({ id }); } catch (e) {} });
        drawIds.length = 0;
      });
      await armTool(page, 'trendline');
      await clickAt(page, rect, { x: pxH.x + off.dx, y: midY + off.dy });
      await page.waitForTimeout(CLICK_GAP_MS);
      await clickAt(page, rect, { x: pxFar.x, y: pxFar.y });
      await page.waitForTimeout(CLICK_GAP_MS);
      await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
      const obj = (await overlays(page))[0];
      expect(obj, `objek harus terbentuk (offset ${off.dx},${off.dy})`).toBeTruthy();
      const px = (await toPixels(page, [obj.points[0]]))[0];
      landed.push({ off, value: obj.points[0].value, px });
    }

    const ref = landed[0];
    landed.slice(1).forEach((l) => {
      expect(l.value, `harga titik berubah saat kursor digeser ${l.off.dx},${l.off.dy}px di candle yang sama`).toBeCloseTo(ref.value, 9);
      expect(Math.abs(l.px.x - ref.px.x), `titik bergeser horizontal saat kursor digeser ${l.off.dx}px di candle yang sama`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(l.px.y - ref.px.y), `titik bergeser vertikal saat kursor digeser ${l.off.dy}px di candle yang sama`).toBeLessThanOrEqual(0.5);
    });
    // …dan yang didarati memang salah satu OHLC bar itu, bukan bar tetangga.
    expect([bar.open, bar.high, bar.low, bar.close].some((v) => Math.abs(v - ref.value) < 1e-9), 'harga bukan O/H/L/C bar yang diklik').toBe(true);
    assertNoPageErrors(page);
  });

  test('magnet ON: pindah ke candle berikutnya → titik ikut pindah satu bar', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await page.locator('#magBtn').click();

    const bar = await barAt(page, -8);
    const next = await barAt(page, -7);
    const far = await barAt(page, -4);
    const bs = await barSpace(page);
    const [pxBar, pxNext, pxFar] = await toPixels(page, [
      { timestamp: bar.timestamp, value: bar.high },
      { timestamp: next.timestamp, value: next.high },
      { timestamp: far.timestamp, value: far.close },
    ]);

    const drawAt = async (x, y) => {
      await page.evaluate(() => {
        drawIds.slice().forEach((id) => { try { chart.removeOverlay({ id }); } catch (e) {} });
        drawIds.length = 0;
      });
      await armTool(page, 'trendline');
      await clickAt(page, rect, { x, y });
      await page.waitForTimeout(CLICK_GAP_MS);
      await clickAt(page, rect, { x: pxFar.x, y: pxFar.y });
      await page.waitForTimeout(CLICK_GAP_MS);
      await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
      const obj = (await overlays(page))[0];
      return (await toPixels(page, [obj.points[0]]))[0];
    };

    const a = await drawAt(pxBar.x, pxBar.y);
    const b = await drawAt(pxNext.x, pxNext.y);
    expect(Math.abs(b.x - a.x), 'pindah satu candle harus memindahkan titik tepat satu bar').toBeCloseTo(bs, 0);
    assertNoPageErrors(page);
  });

  test('magnet: TF halus tak boleh menambah harga kandidat — hanya menajamkan waktunya', async ({ page }) => {
    await gotoApp(page);
    const res = await page.evaluate(() => {
      const cur = currentTF;
      const arr = revealed(cur).slice();
      const bar = arr[arr.length - 8];

      // Sub-bar M1 realistis di dalam tiap bar M15 (di produksi selalu begini begitu pengguna
      // pernah mampir ke TF halus). High & low bar kasar sengaja dicetak oleh sub-bar tertentu,
      // supaya penajaman WAKTU-nya ikut terukur.
      tfData.M1 = arr.flatMap((d) => {
        const out = [];
        for (let j = 0; j < 15; j++) {
          // Sub-bar netral (O=H=L=C=mid) supaya HANYA dua menit di bawah yang mencetak ujung bar
          // kasarnya — kalau sub-bar lain ikut menyentuh high/low, menit yang diharapkan jadi ambigu.
          const mid = d.open + ((d.close - d.open) * j) / 14;
          out.push({ timestamp: d.timestamp + j * 60000, open: mid, high: mid, low: mid, close: mid });
        }
        out[7].high = d.high;
        out[11].low = d.low;
        return out;
      });

      const nilai = new Set();
      let tsHigh = null;
      for (let k = 0; k <= 200; k++) {
        const v = bar.low + ((bar.high - bar.low) * k) / 200;
        const s = magnetSnap(bar.timestamp, v, 0, 0);
        if (s) {
          nilai.add(s.value);
          if (Math.abs(s.value - bar.high) < 1e-9) tsHigh = s.timestamp;
        }
      }
      delete tfData.M1;
      return { ohlc: [bar.open, bar.high, bar.low, bar.close], nilai: [...nilai], tsHigh, wantTsHigh: bar.timestamp + 7 * 60000 };
    });

    const asing = res.nilai.filter((v) => !res.ohlc.some((o) => Math.abs(o - v) < 1e-9));
    expect(asing, `magnet mendarat di harga yang bukan O/H/L/C bar: ${JSON.stringify(asing)}`).toEqual([]);
    expect(res.tsHigh, 'waktu titik high tak ditajamkan ke menit sub-bar yang mencetaknya').toBe(res.wantTsHigh);
    assertNoPageErrors(page);
  });

  test('magnet ON: menyeret ujung objek pun nempel & tak bergeser di dalam candle yang sama', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const { obj } = await drawTool(page, 'trendline');
    await page.locator('#magBtn').click();

    const bar = await barAt(page, -8);
    const [pxH, pxL] = await toPixels(page, [
      { timestamp: bar.timestamp, value: bar.high },
      { timestamp: bar.timestamp, value: bar.low },
    ]);
    const midY = (pxH.y + pxL.y) / 2;
    const start = (await toPixels(page, [obj.points[0]]))[0];

    const dragTo = async (x, y) => {
      const from = (await toPixels(page, [(await overlays(page))[0].points[0]]))[0];
      await dragPoint(page, rect, from, { x, y });
      await page.waitForTimeout(250); // refineMagnetPoints jalan async setelah lepas
      const p = (await overlays(page))[0].points[0];
      return { point: p, px: (await toPixels(page, [p]))[0] };
    };

    const a = await dragTo(pxH.x, midY);
    expect([bar.open, bar.high, bar.low, bar.close].some((v) => Math.abs(v - a.point.value) < 1e-9), 'ujung yang diseret tak nempel ke O/H/L/C candle').toBe(true);

    const b = await dragTo(pxH.x + 3, midY + 3);
    expect(b.point.value, 'harga ujung berubah saat diseret 3px di candle yang sama').toBeCloseTo(a.point.value, 9);
    expect(Math.abs(b.px.x - a.px.x), 'ujung bergeser horizontal saat diseret 3px di candle yang sama').toBeLessThanOrEqual(0.5);
    expect(start, 'sanity: titik awal harus terkonversi').toBeTruthy();
    assertNoPageErrors(page);
  });

  test('magnet di-toggle saat menggambar → mode overlay in-progress ikut berubah', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.5) });
    await page.waitForTimeout(CLICK_GAP_MS);

    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).not.toBe('strong_magnet');
    await page.locator('#magBtn').click();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).toBe('strong_magnet');
    await page.locator('#magBtn').click();
    expect(await page.evaluate(() => chart.getOverlayById(inProgressId).mode)).toBe('normal');
    assertNoPageErrors(page);
  });
});

test.describe('ganti timeframe', () => {
  test('objek tetap di harga & waktu yang sama setelah TF diganti', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'trendline');
    const before = obj.points.map((p) => ({ value: p.value, timestamp: p.timestamp, dataIndex: p.dataIndex }));

    // Waktu wall-clock tiap titik SEBELUM pindah TF (dataIndex → timestamp via dataset kini).
    const tsBefore = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          if (p.timestamp != null) return p.timestamp;
          const list = chart.getDataList();
          const i = Math.round(p.dataIndex);
          return list[Math.max(0, Math.min(list.length - 1, i))].timestamp;
        }),
      before
    );

    // H1 bukan favorit default (TF_FAV_DEFAULT = M15, D di index.html pra-Fase-2:1582) → lewat dropdown.
    await page.locator('#tfMore').click();
    await page.locator('#tfMenu.open').waitFor();
    await page.locator('#tfMenu .tf-row', { has: page.locator('.tf-lbl', { hasText: /^H1$/ }) }).locator('.tf-lbl').click();
    await page.waitForFunction(() => currentTF === 'H1' && chart.getDataList().length > 0, null, { timeout: 20000 });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    const after = (await overlays(page))[0];
    expect(after.name).toBe('trendline');
    // Harga wajib identik.
    after.points.forEach((p, i) => {
      expect(p.value, `harga titik #${i} berubah setelah ganti TF`).toBeCloseTo(before[i].value, 9);
    });
    // Waktu wajib sama dalam toleransi satu bar TF baru (H1) — titik dipetakan ulang ke
    // dataset baru, jadi presisi terbatas pada granularitas bar.
    const tsAfter = await page.evaluate(
      (pts) =>
        pts.map((p) => {
          if (p.timestamp != null) return p.timestamp;
          const list = chart.getDataList();
          const i = Math.round(p.dataIndex);
          return list[Math.max(0, Math.min(list.length - 1, i))].timestamp;
        }),
      after.points
    );
    tsAfter.forEach((t, i) => {
      expect(Math.abs(t - tsBefore[i]), `waktu titik #${i} bergeser >1 bar H1 setelah ganti TF`).toBeLessThanOrEqual(60 * 60 * 1000);
    });
    assertNoPageErrors(page);
  });
});

test.describe('area future', () => {
  test('titik di kanan bar terakhir tak "kelempar" ke tepi kiri', async ({ page }) => {
    // Jaring pengaman eksplisit di index.html pra-Fase-2:3081 — titik tanpa anchor (timestamp & dataIndex
    // null) akan tergambar di x=0. Test menggambar SENGAJA di area kosong kanan.
    await gotoApp(page);
    const rect = await chartRect(page);
    const bs = await barSpace(page);
    const last = await barAt(page, -1);
    const lastPx = await toPixels(page, [{ timestamp: last.timestamp, value: last.close }]);

    // Batas kanan = tepi AREA PLOT, bukan tepi container: 52px terakhir adalah sumbu harga
    // (lihat plotWidth). Klik di sumbu tak masuk ke chart dan akan salah dituduh sebagai bug.
    const pw = await plotWidth(page);
    const room = pw - lastPx[0].x;
    test.skip(room < 3 * bs, `tak ada ruang future di kanan (${Math.round(room)}px) — chart menempel ke tepi plot`);

    const targets = [
      { x: Math.round(lastPx[0].x + bs * 1.5), y: Math.round(rect.height * 0.45) },
      { x: Math.round(Math.min(pw - 4, lastPx[0].x + room * 0.75)), y: Math.round(rect.height * 0.3) },
    ];
    await armTool(page, 'trendline');
    for (const t of targets) {
      await clickAt(page, rect, t);
      await page.waitForTimeout(CLICK_GAP_MS);
    }
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });

    const obj = (await overlays(page))[0];
    expect(obj, 'objek di area future harus terbentuk').toBeTruthy();
    const px = await toPixels(page, obj.points);
    px.forEach((p, i) => {
      expect(p, `titik #${i} tak bisa dikonversi ke pixel`).toBeTruthy();
      expect(p.x, `titik #${i} kelempar ke tepi kiri (x=${p && p.x})`).toBeGreaterThan(lastPx[0].x - bs);
      expect(Math.abs(p.x - targets[i].x), `titik #${i} tak mendarat di area future yang diklik`).toBeLessThanOrEqual(bs);
    });
    assertNoPageErrors(page);
  });
});
