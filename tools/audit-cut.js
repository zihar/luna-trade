#!/usr/bin/env node
// Audit titik potong pemecahan index.html — dengan parser sungguhan (acorn), bukan regex.
//
// Pakai:
//   npm i --no-save acorn          # sekali per checkout (bukan devDependency: alat sekali pakai per PR)
//   node tools/audit-cut.js 5688   # satu titik potong
//   node tools/audit-cut.js        # tanpa argumen: usulkan potongan ≤800 baris + audit semuanya
//
// PERTANYAAN YANG DIJAWAB (satu-satunya yang bisa merusak ekstraksi ekor):
// file hasil ekstraksi dimuat SETELAH blok inline dan tak ada hoisting antar-script, jadi —
// apakah ada kode yang DIEVALUASI LANGSUNG di top-level blok inline yang menyentuh nama yang
// dideklarasikan di bawah titik potong?
//
// "Dievaluasi langsung" = referensi yang tidak berada di dalam body fungsi/arrow mana pun.
// Referensi di dalam body fungsi aman: fungsinya baru dipanggil setelah semua script termuat —
// KECUALI kalau fungsi itu sendiri dipanggil eager dari atas potongan, dan itu justru muncul
// sebagai temuan CALL di bawah.
//
// Dua kelas temuan, konsekuensinya beda jauh:
//   CALL  → melempar ReferenceError saat boot. Berisik; suite menangkapnya (assertNoPageErrors).
//   VALUE → diserahkan sebagai nilai → jadi `undefined` TANPA error. SENYAP. Ini yang berbahaya,
//           dan ini juga satu-satunya kelas yang butuh perbaikan kode sebelum potongannya dicabut.
//           Penawarnya: bungkus jadi pemanggilan tertunda, mis.
//             performEventPressedMove: posPressedMove          →  (...a)=>posPressedMove(...a)
//           Resolusinya berpindah ke saat dipanggil, saat semua script sudah termuat.

const fs = require('fs');
const path = require('path');

let acorn;
try {
  acorn = require('acorn');
} catch (_) {
  console.error('Butuh acorn. Jalankan dulu:  npm i --no-save acorn');
  process.exit(2);
}

const MAX_CHUNK = 800;
const file = process.env.AUDIT_FILE || 'index.html';
const src = fs.readFileSync(path.resolve(file), 'utf8').split('\n');
const START = src.findIndex((l) => l === '<script>') + 2; // baris pertama JS (1-indexed)
const END = src.findIndex((l) => l === '</script>'); // baris terakhir JS
if (START < 2 || END < START) {
  console.error(`${file}: tak menemukan blok <script> inline (sudah habis dipecah?)`);
  process.exit(2);
}
const at = (n) => src[n - 1];
const ast = acorn.parse(src.slice(START - 1, END).join('\n'), { ecmaVersion: 2022, locations: true });
const off = START - 1;

// Deklarasi top-level: nama → baris.
const declAt = new Map();
for (const node of ast.body) {
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
    declAt.set(node.id.name, node.loc.start.line + off);
  } else if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      if (d.id.type === 'Identifier') declAt.set(d.id.name, d.id.loc.start.line + off);
    }
  }
}

// Referensi eager = di luar body fungsi mana pun.
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const eager = [];
(function walk(node, inFn, parent) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'Identifier' && !inFn && declAt.has(node.name)) {
    const isBinding =
      parent &&
      ((parent.type === 'VariableDeclarator' && parent.id === node) ||
        (FN.has(parent.type) && parent.id === node) ||
        (parent.type === 'ClassDeclaration' && parent.id === node) ||
        (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
        (parent.type === 'Property' && parent.key === node && !parent.computed) ||
        parent.type === 'LabeledStatement');
    if (!isBinding) {
      const kind = parent && parent.type === 'CallExpression' && parent.callee === node ? 'CALL' : 'VALUE';
      eager.push({ name: node.name, line: node.loc.start.line + off, kind });
    }
  }
  const nowInFn = inFn || FN.has(node.type);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, nowInFn, node));
    else if (v && typeof v.type === 'string') walk(v, nowInFn, node);
  }
})(ast, false, null);

function hazards(cut) {
  const out = [];
  const seen = new Set();
  for (const r of eager) {
    if (r.line >= cut) continue;
    const d = declAt.get(r.name);
    if (d === undefined || d < cut) continue;
    const key = `${r.name}:${r.line}:${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, declaredAt: d });
  }
  return out;
}

function report(cut) {
  const h = hazards(cut);
  const silent = h.filter((x) => x.kind === 'VALUE');
  const banner = /^\/\/ ={5,}/.test(at(cut)) ? at(cut).replace(/^\/\/ =+ ?/, '').replace(/ ?=+$/, '') : null;
  console.log(
    `\ntitik potong ${cut}${banner ? ` — «${banner}»` : '  ⚠ BUKAN awal banner section'}: ` +
      `${h.length} temuan (${silent.length} SENYAP/VALUE, ${h.length - silent.length} CALL)`
  );
  for (const x of h) {
    console.log(
      `   ${x.kind === 'VALUE' ? '☠ SENYAP' : '● CALL  '} baris ${x.line} → ${x.name} (dideklarasikan ${x.declaredAt})`
    );
    console.log(`            ${at(x.line).trim().slice(0, 110)}`);
  }
  if (!h.length) console.log('   bersih — pindahan murni, tak butuh perubahan kode');
  return h;
}

const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
console.log(
  `${file}: blok inline ${START}-${END} (${END - START + 1} baris) · ` +
    `${declAt.size} deklarasi top-level · ${eager.length} referensi eager`
);

if (args.length) {
  args.forEach(report);
} else {
  // Usulkan potongan dari EKOR: banner terjauh yang masih ≤MAX_CHUNK baris.
  const banners = [];
  for (let n = START; n <= END; n++) if (/^\/\/ ={5,}/.test(at(n))) banners.push(n);
  const plan = [];
  let tail = END;
  while (tail >= START) {
    const cands = banners.filter((b) => b <= tail && tail - b + 1 <= MAX_CHUNK);
    if (!cands.length) break;
    const cut = Math.min(...cands);
    plan.push([cut, tail]);
    tail = cut - 1;
  }
  console.log(`\nusulan ${plan.length} potongan ≤${MAX_CHUNK} baris (urutan = urutan PR, kupas dari ekor):`);
  plan.forEach(([a, b], i) => console.log(`  ${i + 1}. ${a}-${b}  ${b - a + 1} baris`));
  plan.forEach(([a]) => report(a));
}
