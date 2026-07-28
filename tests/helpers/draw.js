// Helper drawing: arm tool lewat UI asli, gambar dengan mouse asli, baca state via
// bookkeeping aplikasi sendiri (drawIds + chart.getOverlayById).
//
// Prinsip: JANGAN memanggil chart.createOverlay() langsung — itu melewati seluruh jalur
// yang mau diuji (rail → pickTool → createDraw → onDrawing → onDrawEnd). Semua input
// lewat page.mouse / page.keyboard (trusted input).

const { chartRect, toPixels, barSpace } = require('./chart');
const { byName } = require('./spec');

// Jeda antar klik untuk jalur "normal".
//
// TERUKUR (tests/drawing/10-click-timing.spec.js): lapisan synthetic-event klinecharts
// mendeteksi double-click TANPA memeriksa jarak, jadi dua klik yang berjarak < ~400ms
// dianggap satu double-click dan klik ke-2 DITELAN — objek tak pernah selesai, walau DOM
// #chart menerima dua `click` normal (detail=1 keduanya). Jalur normal karena itu memakai
// jeda di atas ambang supaya yang diuji adalah presisi, bukan penelanan klik.
const CLICK_GAP_MS = 450;
// Jalur "fast" sengaja di bawah ambang: memancing klik tertelan + desync pendingClicks
// (index.html pra-Fase-2:3063) yang membuat titik jatuh kembali ke snap-per-bar.
const FAST_GAP_MS = 120;

/** Titik-titik overlay yang tercatat aplikasi (urutan = drawIds). */
async function overlays(page) {
  return page.evaluate(() =>
    drawIds
      .map((id) => {
        const o = chart.getOverlayById(id);
        if (!o) return null;
        return {
          id: o.id,
          name: o.name,
          points: (o.points || []).map((p) => (p ? { timestamp: p.timestamp ?? null, dataIndex: p.dataIndex ?? null, value: p.value ?? null } : null)),
          extendData: typeof o.extendData === 'string' ? o.extendData : o.extendData ? JSON.stringify(o.extendData) : null,
          visible: o.visible !== false,
          lock: !!o.lock,
        };
      })
      .filter(Boolean)
  );
}

/** Overlay yang sedang digambar (inProgressId), atau null. */
async function inProgress(page) {
  return page.evaluate(() => {
    if (inProgressId == null) return null;
    const o = chart.getOverlayById(inProgressId);
    if (!o) return null;
    return {
      id: o.id,
      name: o.name,
      points: (o.points || []).map((p) => (p ? { timestamp: p.timestamp ?? null, dataIndex: p.dataIndex ?? null, value: p.value ?? null } : null)),
    };
  });
}

/** Buka flyout grup lewat caret (jalur UI asli). */
async function openFlyout(page, groupKey) {
  const row = page.locator(`#drawtools .dt-catrow`).filter({ has: page.locator(`.dt-cat[data-cat="${groupKey}"]`) });
  await row.locator('.dt-caret').click();
  await page.locator('#dtFlyout.show').waitFor({ state: 'visible' });
}

/**
 * Arm tool lewat UI: caret grup → flyout → item dengan judul yang cocok.
 * Judul dipakai (bukan index) karena nama `arrow` ada di dua grup (cursor & shapes) —
 * lihat catatan tabrakan nama di spec.
 */
async function armTool(page, name) {
  const t = byName(name);
  if (!t) throw new Error('tool tak ada di TOOL_SPEC: ' + name);
  await openFlyout(page, t.group);
  await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: new RegExp(`^${escapeRe(t.title)}$`) }) }).click();
  await page.locator('#dtFlyout.show').waitFor({ state: 'hidden' });
  // createDraw() membuat overlay in-progress segera → itu bukti tool benar-benar armed.
  await page.waitForFunction(() => inProgressId != null, null, { timeout: 3000 });
}

/** Set mode cursor lewat flyout grup Cursor. */
async function setCursor(page, name) {
  const titles = {
    cross: 'Cross',
    dot: 'Dot',
    arrow: 'Arrow (no crosshair)',
    eraser: 'Eraser (click object to delete)',
  };
  await openFlyout(page, 'cursor');
  await page.locator('#dtFlyout .dt-item', { has: page.locator('.dt-nm', { hasText: new RegExp(`^${escapeRe(titles[name])}$`) }) }).click();
  await page.locator('#dtFlyout.show').waitFor({ state: 'hidden' });
  await page.waitForFunction((n) => cursorMode === n, name, { timeout: 3000 });
}

/**
 * Target klik default untuk tool ber-N titik: pixel container-relative di dalam pane candle.
 * Fraksi dipilih agar selalu di area candle (bukan sumbu X / pane bawah) dan berjarak
 * beberapa bar supaya geseran ½ bar terlihat jelas.
 */
function defaultTargets(rect, n) {
  const fx = [0.34, 0.58, 0.72];
  const fy = [0.55, 0.24, 0.4];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: Math.round(rect.width * fx[i % fx.length]), y: Math.round(rect.height * fy[i % fy.length]) });
  }
  return out;
}

/**
 * Tutup editor teks inline yang terbuka sendiri untuk tool text/callout
 * (applyTextInput → editTextOverlay, index.html pra-Fase-2:3306).
 *
 * PENTING: Escape pada tool `text` yang masih kosong MENGHAPUS objeknya
 * (close(false) + removeIfEmpty, index.html pra-Fase-2:3370) — jadi jangan pakai Escape di sini.
 * Isi teks lalu blur = jalur simpan (index.html pra-Fase-2:3382).
 */
async function commitTextEditor(page, value = 'E2E') {
  const ta = page.locator('textarea.text-editor');
  if ((await ta.count()) === 0) return false;
  await ta.fill(value);
  await ta.blur();
  await page.waitForSelector('textarea.text-editor', { state: 'detached', timeout: 3000 });
  return true;
}

/**
 * Jarak titik target ke titik overlay TERDEKAT (pencocokan tak per-indeks, karena rect/fib3
 * mengembang jadi 8 titik dan posisi jadi 6 titik).
 *
 * Kandidat dibatasi dulu ke titik yang selevel secara Y (default ±20px). Tanpa batas ini,
 * pencocokan "terdekat" bisa MENUTUPI drift: pada kotak 8-titik, titik tengah atau sudut
 * seberang kebetulan bisa lebih dekat daripada sudut yang benar, lalu geseran nyata terbaca
 * kecil. Kalau tak ada kandidat selevel, dipakai nearest global dan ditandai lewat `loose`.
 */
function nearestDelta(target, pts, opts = {}) {
  const yWindow = opts.yWindow ?? 20;
  const pick = (candidates) => {
    let best = null;
    for (const p of candidates) {
      if (!p) continue;
      const dx = p.x - target.x;
      const dy = p.y - target.y;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { d, dx, dy };
    }
    return best;
  };
  const level = pts.filter((p) => p && Math.abs(p.y - target.y) <= yWindow);
  const best = pick(level.length ? level : pts);
  if (!best) return null;
  return { dx: +best.dx.toFixed(2), dy: +best.dy.toFixed(2), loose: level.length === 0 };
}

/** Klik di pixel container-relative. */
async function clickAt(page, rect, p, opts = {}) {
  await page.mouse.move(rect.x + p.x, rect.y + p.y, { steps: opts.steps ?? 6 });
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Ukur parity preview↔final + landing untuk satu tool.
 *
 * mode:
 *   'normal' — gerak halus + jeda antar klik (pemakaian biasa)
 *   'fast'   — klik beruntun tanpa jeda → memancing desync pendingClicks (index.html pra-Fase-2:3063)
 *   'drag'   — press-move-release untuk titik terakhir (jalur onPressedMoving)
 *
 * Mengembalikan { targets, previewPx, finalPx, points, deltaParity, deltaLanding, shots }.
 */
async function measureParity(page, name, opts = {}) {
  const spec = byName(name);
  const mode = opts.mode || 'normal';
  const rect = await chartRect(page);
  const targets = opts.targets || defaultTargets(rect, spec.clicks);
  const shoot = opts.shots !== false;

  // Crosshair dimatikan supaya foto preview & final hanya berisi objeknya → diff PNG
  // mengisolasi geseran, bukan crosshair yang ikut pindah.
  if (shoot) await setCursor(page, 'arrow');

  await armTool(page, name);

  const stepDelay = mode === 'fast' ? FAST_GAP_MS : CLICK_GAP_MS;
  const moveSteps = mode === 'fast' ? 1 : 6;

  // Semua klik kecuali yang terakhir.
  for (let i = 0; i < targets.length - 1; i++) {
    await clickAt(page, rect, targets[i], { steps: moveSteps });
    await page.waitForTimeout(stepDelay);
  }

  // Titik terakhir: gerak ke posisi → PREVIEW (rubber-band hidup, belum commit).
  const last = targets[targets.length - 1];
  if (mode === 'drag') {
    await page.mouse.move(rect.x + last.x, rect.y + last.y, { steps: 1 });
    await page.mouse.down();
    await page.mouse.move(rect.x + last.x, rect.y + last.y, { steps: 3 });
  } else {
    await page.mouse.move(rect.x + last.x, rect.y + last.y, { steps: moveSteps });
  }
  await page.waitForTimeout(stepDelay);

  const prev = await inProgress(page);
  const previewPx = prev ? await toPixels(page, prev.points) : [];
  const previewShot = shoot ? await page.locator('#chart').screenshot() : null;

  // Commit titik terakhir.
  if (mode === 'drag') {
    await page.mouse.up();
  } else {
    await page.mouse.down();
    await page.mouse.up();
  }

  // Jalur 'fast' bisa TIDAK selesai (klik tertelan) — itu temuannya, bukan error harness.
  // Jangan melempar: kembalikan completed:false supaya test yang memutuskan.
  let completed = true;
  try {
    await page.waitForFunction(() => inProgressId == null, null, { timeout: mode === 'fast' ? 1500 : 5000 });
  } catch (_) {
    completed = false;
  }

  // Tool text/callout membuka editor inline sendiri → commit dulu (Escape akan MENGHAPUS
  // objek `text` yang masih kosong, index.html pra-Fase-2:3370).
  const textCommitted = spec.autoEditor ? await commitTextEditor(page) : false;

  // Deselect + jauhkan pointer supaya handle bulat (hover/selected) tak ikut ter-foto.
  await page.keyboard.press('Escape');
  await page.mouse.move(rect.x + 8, rect.y + 8, { steps: 2 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const objs = await overlays(page);
  const obj = objs[objs.length - 1] || null;
  const finalPx = obj ? await toPixels(page, obj.points) : [];
  const finalShot = shoot ? await page.locator('#chart').screenshot() : null;

  const bs = await barSpace(page);

  // Δ dihitung lewat pencocokan titik TERDEKAT, bukan per-indeks: rect & fib3 mengembang
  // jadi 8 titik dan posisi jadi 6 titik setelah onDrawEnd (expandBox/expandPosition), jadi
  // indeks preview tak lagi sejajar dengan indeks final. Properti yang benar-benar penting:
  // "ada titik objek TEPAT di tempat aku klik / tempat preview menunjukkannya".
  const deltaParity = [];
  for (let i = 0; i < previewPx.length; i++) {
    const a = previewPx[i];
    if (!a) continue;
    const d = nearestDelta(a, finalPx);
    if (d) deltaParity.push({ i, ...d });
  }

  const deltaLanding = [];
  for (let i = 0; i < targets.length; i++) {
    const d = nearestDelta(targets[i], finalPx);
    if (d) deltaLanding.push({ i, ...d });
  }

  // Δ preview→klik: memisahkan dua keluhan yang terasa sama bagi pengguna.
  //   preview tepat di kursor + final geser  → "objek LONCAT saat klik terakhir"
  //   preview sudah geser + final sama       → "rubber-band-nya sendiri sudah snap per-bar"
  const deltaPreview = [];
  for (let i = 0; i < targets.length; i++) {
    const d = nearestDelta(targets[i], previewPx);
    if (d) deltaPreview.push({ i, ...d });
  }

  return {
    tool: name,
    mode,
    completed,
    textCommitted,
    barSpace: bs,
    targets,
    objName: obj ? obj.name : null,
    points: obj ? obj.points : [],
    pointCount: obj ? obj.points.length : 0,
    previewPx,
    finalPx,
    deltaParity,
    deltaLanding,
    deltaPreview,
    maxParity: maxAbs(deltaParity),
    maxLanding: maxAbs(deltaLanding),
    maxPreview: maxAbs(deltaPreview),
    shots: { preview: previewShot, final: finalShot },
  };
}

function maxAbs(deltas) {
  return deltas.reduce((m, d) => ({ dx: Math.max(m.dx, Math.abs(d.dx)), dy: Math.max(m.dy, Math.abs(d.dy)) }), { dx: 0, dy: 0 });
}

/** Gambar tool tanpa mengukur apa pun (untuk aspek drag/delete/persist/dst). */
async function drawTool(page, name, opts = {}) {
  const spec = byName(name);
  const rect = opts.rect || (await chartRect(page));
  const targets = opts.targets || defaultTargets(rect, spec.clicks);
  await armTool(page, name);
  for (const t of targets) {
    await clickAt(page, rect, t);
    await page.waitForTimeout(CLICK_GAP_MS);
  }
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  if (spec.autoEditor) await commitTextEditor(page, opts.text || 'E2E');
  await page.keyboard.press('Escape');
  await page.mouse.move(rect.x + 8, rect.y + 8, { steps: 2 });
  const objs = await overlays(page);
  return { obj: objs[objs.length - 1] || null, targets, rect };
}

/**
 * Cari satu pixel di mana objek benar-benar bisa di-hover.
 *
 * Titik overlay tak selalu berada DI ATAS bentuk yang tergambar: titik `ellipse` adalah sudut
 * bounding box (kurvanya tak melewatinya), dan figure arrowMark digambar bergeser dari
 * titiknya. Menghakimi "modal tak terbuka" dari klik di titik seperti itu akan salah menuduh.
 * Jadi kandidat diprobe satu per satu sampai hoverId = objek. Kalau TAK ADA yang mengenai,
 * itu temuan nyata: objeknya tak bisa dijangkau pengguna.
 */
async function hoverableSpot(page, obj, rect, pxPoints) {
  const pts = pxPoints || (await toPixels(page, obj.points));
  const cands = [];
  const push = (p) => p && cands.push({ x: p.x, y: p.y });
  pts.forEach(push);
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i] && pts[i + 1]) push({ x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 });
  }
  const xs = pts.filter(Boolean).map((p) => p.x);
  const ys = pts.filter(Boolean).map((p) => p.y);
  if (xs.length) {
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    push({ x: cx, y: cy });
    push({ x: Math.min(...xs), y: cy });
    push({ x: Math.max(...xs), y: cy });
    push({ x: cx, y: Math.min(...ys) });
    push({ x: cx, y: Math.max(...ys) });
    // figure arrowMark digambar bergeser vertikal dari titiknya → coba beberapa offset
    for (const dy of [-14, -8, 8, 14]) pts.forEach((p) => p && push({ x: p.x, y: p.y + dy }));
  }

  for (const c of cands) {
    await page.mouse.move(rect.x + c.x, rect.y + c.y, { steps: 4 });
    const hit = await page.evaluate((id) => hoverId === id, obj.id);
    if (hit) return c;
  }
  return null;
}

/** Drag titik overlay dari pixel `from` ke `to` (press-move-release di atas handle). */
async function dragPoint(page, rect, from, to) {
  // Hover dulu supaya handle aktif (klinecharts butuh objek hovered untuk press-move titik).
  await page.mouse.move(rect.x + from.x, rect.y + from.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Diff dua PNG di dalam browser (nol dependency): jumlah pixel beda + bbox + data URL. */
async function diffShots(page, aBuf, bBuf) {
  if (!aBuf || !bBuf) return null;
  return page.evaluate(
    async ([a64, b64]) => {
      const load = async (b64) => {
        const res = await fetch('data:image/png;base64,' + b64);
        return createImageBitmap(await res.blob());
      };
      const [A, B] = await Promise.all([load(a64), load(b64)]);
      const w = Math.min(A.width, B.width);
      const h = Math.min(A.height, B.height);
      const px = (img) => {
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const da = px(A);
      const db = px(B);
      const out = new Uint8ClampedArray(w * h * 4);
      let n = 0;
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const d = Math.abs(da[o] - db[o]) + Math.abs(da[o + 1] - db[o + 1]) + Math.abs(da[o + 2] - db[o + 2]);
        if (d > 24) {
          n++;
          out[o] = 255;
          out[o + 1] = 32;
          out[o + 2] = 96;
          out[o + 3] = 255;
          const x = i % w;
          const y = (i / w) | 0;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        } else {
          out[o] = da[o];
          out[o + 1] = da[o + 1];
          out[o + 2] = da[o + 2];
          out[o + 3] = 60;
        }
      }
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const dataUrl = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
      return { diffPixels: n, bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, dataUrl };
    },
    [aBuf.toString('base64'), bBuf.toString('base64')]
  );
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  CLICK_GAP_MS,
  FAST_GAP_MS,
  overlays,
  inProgress,
  armTool,
  setCursor,
  openFlyout,
  defaultTargets,
  clickAt,
  commitTextEditor,
  nearestDelta,
  hoverableSpot,
  measureParity,
  drawTool,
  dragPoint,
  diffShots,
};
