// Cheat-sheet shortcut keyboard (js/shortcuts-help.js): `?` / Ctrl+⌘+/ / menu akun membuka,
// daftar tool drawing diturunkan dari DRAW_GROUPS, keyboard ditelan selama dialog terbuka.
const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');

test('Shortcut cheat-sheet: ? membuka, isi dari DRAW_GROUPS, hotkey lain ditelan, Esc menutup', async ({ page }) => {
  await gotoApp(page);
  const dlg = page.locator('.kbs-scrim.show [role="dialog"]');

  await page.locator('#chart').click({ position: { x: 300, y: 200 } });
  await page.keyboard.press('Shift+Slash');            // `?`
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.kbs-title')).toHaveText('Keyboard shortcuts');

  // semua tool ber-`sc` ikut tampil dgn label sesuai OS (satu sumber dgn DRAW_GROUPS)
  const tools = await page.evaluate(() => {
    const out = []; DRAW_GROUPS.forEach(g => g.tools.forEach(t => { if (t.sc) out.push({ title: t.title, sc: t.sc }); }));
    return { out, alt: IS_MAC ? '⌥' : 'Alt' };
  });
  expect(tools.out.length).toBeGreaterThan(5);
  for (const t of tools.out) {
    const row = dlg.locator('.kbs-row', { has: page.locator('.kbs-lbl', { hasText: new RegExp('^' + t.title + '$') }) });
    await expect(row.locator('kbd')).toHaveText([tools.alt, t.sc]);
  }

  // selama terbuka: huruf tak membuka symbol search
  await page.keyboard.press('a');
  await expect(page.locator('#ipickPanel')).not.toHaveClass(/open/);
  await expect(dlg).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  // Ctrl/⌘+/ = toggle
  await page.keyboard.press('ControlOrMeta+Slash');
  await expect(dlg).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Slash');
  await expect(dlg).toBeHidden();

  // ✕ & klik scrim menutup
  await page.evaluate(() => openShortcutsHelp());
  await dlg.locator('.kbs-x').click();
  await expect(dlg).toBeHidden();
  await page.evaluate(() => openShortcutsHelp());
  await page.mouse.click(5, 5);
  await expect(dlg).toBeHidden();

  // menu akun
  await page.locator('#userAvatar').click();
  await page.locator('#shortcutsBtn').click();
  await expect(dlg).toBeVisible();
  assertNoPageErrors(page);
});
