// Presisi menggambar: preview ↔ final ↔ titik klik, untuk SEMUA tool drawing.
//
// Tiga metrik per tool, masing-masing menjawab keluhan yang beda meski terasa sama:
//   Δparity  (preview → final)  "objek LONCAT setelah klik terakhir"
//   Δpreview (klik → preview)   "rubber-band-nya sendiri sudah tak ikut kursor"
//   Δlanding (klik → final)     "objek tak mendarat di tempat aku klik"
//
// Toleransi ≤1px untuk semua tool, kecuali yang snap-per-bar-nya disengaja & beralasan di
// kode (verticalStraightLine, long/shortPosition — lihat TOOL_SPEC.anchorWhy); untuk itu
// toleransi X = ½ barSpace + 1.
//
// Kartu galeri ditulis untuk SETIAP tool (lolos maupun gagal) — preview.png / final.png /
// diff.png + angka Δ — supaya yang tak bisa diassert (garis tak kelihatan, arrowhead salah
// arah, warna default aneh) masih tertangkap mata di report/gallery.html.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { measureParity, diffShots } = require('../helpers/draw');
const { TOOL_SPEC, tolX, axisOf, TOL_Y_PX } = require('../helpers/spec');
const gallery = require('../helpers/gallery');

/**
 * Maksimum |Δ| hanya atas sumbu yang MEMANG dinilai untuk tool ini. Tanpa ini, angka di
 * galeri menyesatkan: mis. horizontalRayLine sengaja mengabaikan Y klik ke-2 (garis harus
 * tetap horizontal), jadi Δy ratusan pixel di situ bukan cacat.
 */
function maxAssessed(deltas, spec) {
  return deltas.reduce(
    (m, d) => ({
      dx: Math.max(m.dx, Math.abs(d.dx)),
      dy: axisOf(spec, d.i) === 'x' ? m.dy : Math.max(m.dy, Math.abs(d.dy)),
    }),
    { dx: 0, dy: 0 }
  );
}

async function runAndRecord(page, spec, mode, notes) {
  const r = await measureParity(page, spec.name, { mode });
  const diff = await diffShots(page, r.shots.preview, r.shots.final);
  const tx = tolX(spec, r.barSpace);
  const okAll =
    r.completed &&
    r.pointCount === spec.pointsAfter &&
    r.deltaParity.every((d) => Math.abs(d.dx) <= tx && Math.abs(d.dy) <= TOL_Y_PX) &&
    r.deltaLanding.every((d, i) => Math.abs(d.dx) <= tx && (axisOf(spec, i) === 'x' || Math.abs(d.dy) <= TOL_Y_PX));

  gallery.record({
    tool: spec.name,
    group: spec.group,
    groupTitle: spec.groupTitle,
    mode,
    status: okAll ? 'pass' : 'fail',
    maxParity: maxAssessed(r.deltaParity, spec),
    maxLanding: maxAssessed(r.deltaLanding, spec),
    maxPreview: maxAssessed(r.deltaPreview, spec),
    pointCount: r.pointCount,
    expectedPoints: spec.pointsAfter,
    anchor: spec.anchor + (spec.anchorWhy ? ` — ${spec.anchorWhy}` : ''),
    barSpace: r.barSpace,
    tolX: tx,
    completed: r.completed,
    notes:
      [
        notes,
        spec.autoEditor ? 'teks di-commit "E2E" sebelum foto final → diff ikut memuat teks' : null,
        spec.clickAxes ? `sumbu klik yang dinilai: ${spec.clickAxes.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    shots: r.shots,
    diff,
  });

  return { r, tx };
}

/** Assertion Δ yang seragam, menghormati sumbu klik yang bermakna. */
function expectDeltas(deltas, spec, tx, label) {
  for (const d of deltas) {
    expect(Math.abs(d.dx), `${label} X titik #${d.i} (${spec.name})`).toBeLessThanOrEqual(tx);
    if (axisOf(spec, d.i) !== 'x') {
      expect(Math.abs(d.dy), `${label} Y titik #${d.i} (${spec.name})`).toBeLessThanOrEqual(TOL_Y_PX);
    }
  }
}

test.describe('presisi menggambar — klik normal', () => {
  for (const spec of TOOL_SPEC) {
    test(`${spec.name}: preview == final == titik klik`, async ({ page }) => {
      await gotoApp(page);
      const { r, tx } = await runAndRecord(page, spec, 'normal');

      expect(r.completed, `${spec.name} tak selesai setelah ${spec.clicks} klik`).toBe(true);
      expect(r.objName, 'nama overlay').toBe(spec.name);
      expect(r.pointCount, `jumlah titik akhir ${spec.name}`).toBe(spec.pointsAfter);
      expect(r.deltaParity.length, 'tak ada titik preview yang terukur').toBeGreaterThan(0);

      expectDeltas(r.deltaParity, spec, tx, 'parity (preview→final): objek loncat setelah klik terakhir —');
      expectDeltas(r.deltaPreview, spec, tx, 'preview (klik→rubber-band): preview tak ikut kursor —');
      expectDeltas(r.deltaLanding, spec, tx, 'landing (klik→objek): objek tak mendarat di tempat diklik —');
      assertNoPageErrors(page);
    });
  }
});

test.describe('presisi menggambar — press-drag', () => {
  // Titik terakhir ditaruh lewat tekan-geser-lepas (bukan klik) → jalur onPressedMoving.
  for (const spec of TOOL_SPEC.filter((t) => t.clicks > 1)) {
    test(`${spec.name}: drag titik terakhir tetap presisi`, async ({ page }) => {
      await gotoApp(page);
      const { r, tx } = await runAndRecord(page, spec, 'drag', 'titik terakhir via press-drag');

      expect(r.completed, `${spec.name} tak selesai lewat press-drag`).toBe(true);
      expect(r.pointCount, `jumlah titik akhir ${spec.name}`).toBe(spec.pointsAfter);
      expectDeltas(r.deltaLanding, spec, tx, 'landing (drag)');
      assertNoPageErrors(page);
    });
  }
});

test.describe('presisi menggambar — klik cepat', () => {
  // Memancing dua masalah sekaligus: (a) klik tertelan oleh deteksi double-click klinecharts
  // (< ~400ms, lihat 10-click-timing.spec.js), dan (b) desync pendingClicks (index.html:3063)
  // yang membuat titik jatuh kembali ke snap-per-bar.
  for (const spec of TOOL_SPEC.filter((t) => t.clicks > 1)) {
    test(`${spec.name}: klik cepat tetap presisi`, async ({ page }) => {
      await gotoApp(page);
      const { r, tx } = await runAndRecord(page, spec, 'fast', 'jeda antar klik 120ms');

      expect(r.completed, `${spec.name} tak selesai saat diklik cepat (klik tertelan)`).toBe(true);
      expectDeltas(r.deltaLanding, spec, tx, 'landing (klik cepat)');
    });
  }
});
