// Search di Object Tree (js/draw-object-tree.js → otMatches): menyaring baris menurut label objek
// (judul tool + teks) atau nama grup di jalurnya; folder induk ikut tampil & dipaksa terbuka;
// Escape mengosongkan. Di smoke karena menyentuh renderObjTree yang dipakai semua jalur tree.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { drawTool } = require('../helpers/draw');
const { chartRect } = require('../helpers/chart');

test('Search menyaring baris Object Tree menurut nama objek & nama grup', async ({ page }) => {
  await gotoApp(page);
  const rect = await chartRect(page);
  const ids = [];
  for (const [tool, fy] of [['trendline', 0.2], ['trendline', 0.4], ['trendline', 0.6], ['rect', 0.75]]) {
    const t = await drawTool(page, tool, {
      rect,
      targets: [{ x: Math.round(rect.width * 0.3), y: Math.round(rect.height * fy) },
                { x: Math.round(rect.width * 0.55), y: Math.round(rect.height * (fy + 0.08)) }],
    });
    ids.push(t.obj.id);
  }
  const [a, b, c, r] = ids;
  // a,b dikelompokkan lalu dinamai "Breakout" dan dilipat
  await page.evaluate(([x, y]) => {
    deselectOverlay();
    const g = grpCreate([x, y]); grpName[g] = 'Breakout'; grpCollapsed.add(g); grpChanged();
  }, [a, b]);
  await page.click('#railObjTree');
  const rows = page.locator('#objTreeList .ot-row');
  const shown = () => rows.evaluateAll((rs) => rs.map((x) => x.dataset.gid ? 'G:' + x.querySelector('.ot-name').textContent : x.dataset.id));
  await expect(rows).toHaveCount(3);   // folder terlipat + c + r

  const search = page.locator('#objTreeSearch');
  await search.fill('RECT');           // tak peka huruf besar/kecil
  expect(await shown()).toEqual([r]);

  await search.fill('breakout');       // nama grup → folder + seluruh isinya, meski terlipat
  expect((await shown()).sort()).toEqual(['G:Breakout', a, b].sort());

  await search.fill('trend');          // objek di dalam grup ikut tampil bersama foldernya
  expect((await shown()).sort()).toEqual(['G:Breakout', a, b, c].sort());
  await expect(page.locator('#objTreeCount')).toHaveText('4');   // hitungan tetap total

  // klik baris hasil saring tetap memilih objeknya
  await page.locator(`#objTreeList .ot-row[data-id="${c}"] .ot-name`).click();
  expect(await page.evaluate(() => selectedId)).toBe(c);

  await search.fill('zzz');
  await expect(page.locator('#objTreeList .ot-empty')).toHaveText('No matching drawings.');

  // Escape mengosongkan → daftar penuh kembali (folder terlipat lagi)
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(3);
  assertNoPageErrors(page);
});
