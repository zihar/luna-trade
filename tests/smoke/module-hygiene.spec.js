// Kebersihan antar-modul js/ — dua kelas bug yang LAHIR dari pemecahan index.html, dan yang
// keduanya sudah pernah terjadi sungguhan di repo ini:
//
//   1. NAMA GANDA. `fmtCountdown` dideklarasikan di dua file dengan isi berbeda; yang dimuat
//      terakhir menang untuk SEMUA pemanggil, termasuk pemanggil di file lain yang tak tahu-menahu.
//      Akibatnya UI memformat "144:00:00" alih-alih "6d 00:00:00" selama berbulan-bulan tanpa satu
//      pun error (diperbaiki di #152).
//   2. REFERENSI EAGER LINTAS FILE. Nama dipakai di top-level sebuah file, padahal dideklarasikan
//      di file yang dimuat BELAKANGAN. Tak ada hoisting antar-<script src>, jadi nilainya
//      `undefined` saat dipakai. `posPressedMove` (drag posisi) dan `candleTooltipCustom` (legend
//      OHLC) keduanya kena ini dan MATI TANPA ERROR sampai ditawarkan (#138, #145).
//
// Sebelum test ini, penjaganya cuma dua: pemeriksaan manual dengan `tools/audit-cut.js` yang tak
// pernah dijalankan otomatis, dan satu assertion yang di-hardcode untuk nama `fmtCountdown` saja.
// Nama lain akan lolos persis seperti dulu.
//
// Ini analisis statis murni (tanpa browser): ia membaca urutan <script src> dari index.html, lalu
// mem-parse tiap modul dengan acorn.

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Urutan muat sebenarnya — diturunkan dari index.html, bukan dari urutan abjad readdir. */
function loadOrder() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="\/js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
}

/** Deklarasi top-level per file + referensi yang DIEVALUASI LANGSUNG (di luar body fungsi). */
function analyse(file) {
  const ast = acorn.parse(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), {
    ecmaVersion: 2022,
    locations: true,
  });
  const declared = [];
  for (const n of ast.body) {
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) declared.push(n.id.name);
    else if (n.type === 'VariableDeclaration')
      for (const d of n.declarations) if (d.id.type === 'Identifier') declared.push(d.id.name);
  }

  const eager = [];
  (function walk(node, inFn, parent) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Identifier' && !inFn) {
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
        eager.push({ name: node.name, line: node.loc.start.line, kind });
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

  return { declared, eager };
}

const FILES = loadOrder();
const INFO = new Map(FILES.map((f) => [f, analyse(f)]));

test('modul: tak ada nama top-level yang dideklarasikan di lebih dari satu file', () => {
  const owner = new Map();
  for (const f of FILES) for (const nm of INFO.get(f).declared) owner.set(nm, [...(owner.get(nm) || []), f]);

  const ganda = [...owner.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([nm, files]) => `${nm} → ${files.join(' + ')}`);

  expect(
    ganda,
    'nama ganda: yang dimuat terakhir akan menang untuk SEMUA pemanggil, termasuk yang ada di file lain — ' +
      'ubah salah satu namanya, atau hapus yang memang tak terpakai'
  ).toEqual([]);
});

test('modul: tak ada pemakaian eager atas nama yang dideklarasikan di file yang dimuat belakangan', () => {
  const declaredIn = new Map();
  FILES.forEach((f, i) => INFO.get(f).declared.forEach((nm) => { if (!declaredIn.has(nm)) declaredIn.set(nm, i); }));

  const bahaya = [];
  FILES.forEach((f, i) => {
    for (const ref of INFO.get(f).eager) {
      const di = declaredIn.get(ref.name);
      if (di === undefined || di <= i) continue;   // global browser, atau dideklarasikan lebih dulu
      bahaya.push(
        `${ref.kind === 'VALUE' ? 'SENYAP' : 'CALL  '} js/${f}:${ref.line} memakai '${ref.name}' ` +
          `yang dideklarasikan di js/${FILES[di]} (dimuat belakangan)`
      );
    }
  });

  expect(
    bahaya,
    'tak ada hoisting antar-<script src>: nama itu `undefined` saat dipakai. Kalau diserahkan sebagai NILAI, ' +
      'ia mati tanpa error sama sekali. Penawarnya: bungkus jadi pemanggilan tertunda, mis. ' +
      '`performEventPressedMove:(...a)=>posPressedMove(...a)`, atau pindahkan filenya lebih awal.'
  ).toEqual([]);
});
