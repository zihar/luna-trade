// Langkah maju/mundur Bar Replay (`step()` di js/replay-control.js).
//
// Kenapa file ini ada. PR #163 mengganti batas tutup bar dari konstanta `DUR[tf]` ke `barEndAt()`
// dan ikut menghapus `dur` dari destrukturisasi di awal `step()` — tapi cabang MUNDUR masih
// memakainya (`T=arr[idx-1].timestamp+dur`). Akibatnya setiap penekanan Prev / ArrowLeft melempar
// `ReferenceError: dur is not defined`: cursor tak bergerak, chart tak re-render, dan karena
// regresi ini lolos sampai ref `release`, tombol Prev mati di produksi.
//
// Tak ada satu pun test yang menekan Prev saat itu — maka test ini. Ia sengaja di smoke (gerbang
// PR), bukan suite penuh: satu tombol mati adalah persis kelas bug yang harus tertahan sebelum
// merge, dan biayanya beberapa detik.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

/** Masuk Bar Replay lewat jalur UI nyata: ArrowRight → step(1) (js/keyboard.js). */
async function enterReplay(page) {
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => typeof replayMode !== 'undefined' && replayMode === true);
}

test('replay: Prev memundurkan cursor satu bar tanpa error', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);

  // Maju dua bar dulu supaya ada ruang mundur (Prev no-op di bar pertama data).
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  const arr = await page.evaluate(() => tfData[currentTF].map((b) => b.timestamp));
  const sebelum = await page.evaluate(() => T);
  const idxSebelum = await page.evaluate(() => {
    const a = tfData[currentTF];
    let lo = 0, h = a.length;
    while (lo < h) { const m = (lo + h) >> 1; if (barEndAt(currentTF, m, a) <= T) lo = m + 1; else h = m; }
    return lo - 1;
  });
  expect(idxSebelum, 'butuh minimal 1 bar di kiri untuk bisa mundur').toBeGreaterThan(0);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);

  const sesudah = await page.evaluate(() => T);
  expect(sesudah, 'Prev harus memundurkan cursor').toBeLessThan(sebelum);
  // Cursor mendarat tepat di TUTUP bar sebelumnya — sama seperti Next mendarat di tutup bar
  // berikutnya. Untuk bar yang punya penerus, tutup = open penerusnya (barEndAt), jadi ekspektasi
  // ini juga menahan kembalinya aritmetika `+DUR` yang meleset di TF bulanan.
  expect(sesudah, 'cursor mendarat di tutup bar sebelumnya').toBe(arr[idxSebelum]);

  assertNoPageErrors(page);
});

test('replay: Prev lalu Next kembali ke cursor semula', async ({ page }) => {
  await gotoApp(page);
  await enterReplay(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  const awal = await page.evaluate(() => T);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => T), 'bolak-balik satu bar harus idempoten').toBe(awal);

  assertNoPageErrors(page);
});
