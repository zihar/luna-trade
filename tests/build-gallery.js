// Menyusun report/gallery.html dari kartu JSON+PNG yang ditulis tiap test.
// Dijalankan otomatis sebagai globalTeardown, atau manual: node tests/build-gallery.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'report');
const DIR = path.join(ROOT, 'gallery');

function load() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v == null ? '—' : (+v).toFixed(2));

function worst(card) {
  const all = [card.maxParity, card.maxLanding, card.maxPreview].filter(Boolean);
  return all.reduce((m, d) => Math.max(m, Math.abs(d.dx || 0), Math.abs(d.dy || 0)), 0);
}

function cardHtml(c) {
  const w = worst(c);
  const cls = c.status === 'fail' ? 'bad' : w > 1 ? 'warn' : 'ok';
  const img = (file, label) =>
    file ? `<figure><img src="gallery/${esc(file)}" alt="${esc(c.tool)} ${label}" loading="lazy"><figcaption>${label}</figcaption></figure>` : '';
  return `<article class="card ${cls}">
  <header>
    <h3>${esc(c.tool)}</h3>
    <span class="mode">${esc(c.mode || 'default')}</span>
    <span class="badge">Δ ${num(w)}px</span>
  </header>
  <div class="shots">${img(c.previewPng, 'preview')}${img(c.finalPng, 'final')}${img(c.diffPng, 'diff')}</div>
  <dl>
    <dt>Δ parity (preview→final)</dt><dd>x ${num(c.maxParity && c.maxParity.dx)} · y ${num(c.maxParity && c.maxParity.dy)}</dd>
    <dt>Δ preview (klik→rubber-band)</dt><dd>x ${num(c.maxPreview && c.maxPreview.dx)} · y ${num(c.maxPreview && c.maxPreview.dy)}</dd>
    <dt>Δ landing (klik→objek)</dt><dd>x ${num(c.maxLanding && c.maxLanding.dx)} · y ${num(c.maxLanding && c.maxLanding.dy)}</dd>
    <dt>titik</dt><dd>${esc(c.pointCount)} / ${esc(c.expectedPoints)} diharapkan</dd>
    <dt>anchor X</dt><dd>${esc(c.anchor)}</dd>
    <dt>toleransi X</dt><dd>${num(c.tolX)} px · barSpace ${num(c.barSpace)} px${c.diffPixels != null ? ` · diff ${c.diffPixels} px` : ''}</dd>
  </dl>
  ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ''}
</article>`;
}

function build() {
  const cards = load().sort((a, b) => worst(b) - worst(a));
  const fails = cards.filter((c) => c.status === 'fail').length;
  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Luna Trade — galeri drawing E2E</title>
<style>
  :root{color-scheme:dark light;--bg:#0e1117;--fg:#e6e8ec;--mut:#8b93a1;--line:#242a35;--ok:#54c88c;--warn:#e5b567;--bad:#ff6f6f}
  @media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#161a20;--mut:#697280;--line:#e3e6eb}}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--mut);margin:0 0 20px}
  .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr))}
  .card{border:1px solid var(--line);border-radius:10px;padding:12px;background:color-mix(in srgb,var(--bg) 92%,var(--fg))}
  .card.ok{border-left:3px solid var(--ok)}
  .card.warn{border-left:3px solid var(--warn)}
  .card.bad{border-left:3px solid var(--bad)}
  header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  h3{font-size:15px;margin:0;font-family:ui-monospace,monospace}
  .mode{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:99px;padding:1px 7px}
  .badge{margin-left:auto;font-family:ui-monospace,monospace;font-size:12px}
  .card.bad .badge{color:var(--bad)} .card.warn .badge{color:var(--warn)} .card.ok .badge{color:var(--ok)}
  .shots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
  figure{margin:0}
  img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px;background:#000}
  figcaption{font-size:10px;color:var(--mut);text-align:center;margin-top:3px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0;font-size:12px}
  dt{color:var(--mut)} dd{margin:0;font-family:ui-monospace,monospace}
  .notes{font-size:12px;color:var(--mut);margin:8px 0 0}
  .empty{color:var(--mut)}
</style></head><body>
<h1>Galeri drawing E2E</h1>
<p class="sub">${cards.length} kartu · ${fails} gagal · diurut Δ terbesar di atas. Δ parity = geseran preview→final; Δ landing = jarak objek dari pixel yang diklik. Target ≤1px untuk semua tool kecuali <code>verticalStraightLine</code>.</p>
${cards.length ? `<div class="grid">${cards.map(cardHtml).join('\n')}</div>` : '<p class="empty">Belum ada kartu — jalankan <code>npx playwright test</code> dulu.</p>'}
</body></html>
`;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'gallery.html'), html);
  return { cards: cards.length, fails };
}

if (require.main === module) {
  const r = build();
  console.log(`galeri: ${r.cards} kartu (${r.fails} gagal) → report/gallery.html`);
}

module.exports = { build };
