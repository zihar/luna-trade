// Galeri visual: tiap test menulis PNG + satu JSON kecil; build-gallery.js menyusunnya
// jadi report/gallery.html. Tujuannya menangkap yang tak bisa diassert — garis tak
// kelihatan, arrowhead salah arah, warna default aneh — dengan cara paling murah:
// difoto, lalu dilihat manusia sekali.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'report', 'gallery');

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function writePng(name, buf) {
  if (!buf) return null;
  ensureDir();
  const file = slug(name) + '.png';
  fs.writeFileSync(path.join(DIR, file), buf);
  return file;
}

/**
 * Catat satu kartu galeri.
 * entry = { tool, group, groupTitle, mode, status, maxParity, maxLanding, pointCount,
 *           expectedPoints, anchor, barSpace, notes, shots:{preview,final}, diff }
 */
function record(entry) {
  ensureDir();
  const key = slug(`${entry.tool}-${entry.mode || 'default'}`);
  const out = { ...entry };
  delete out.shots;
  delete out.diff;

  out.previewPng = writePng(key + '-preview', entry.shots && entry.shots.preview);
  out.finalPng = writePng(key + '-final', entry.shots && entry.shots.final);
  if (entry.diff && entry.diff.dataUrl) {
    const b64 = entry.diff.dataUrl.split(',')[1];
    out.diffPng = writePng(key + '-diff', Buffer.from(b64, 'base64'));
    out.diffPixels = entry.diff.diffPixels;
    out.diffBbox = entry.diff.bbox;
  }

  fs.writeFileSync(path.join(DIR, key + '.json'), JSON.stringify(out, null, 2));
}

function reset() {
  fs.rmSync(path.join(__dirname, '..', '..', 'report'), { recursive: true, force: true });
  ensureDir();
}

module.exports = { record, reset, DIR };
