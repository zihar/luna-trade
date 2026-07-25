// Susun report/gallery.html dari kartu yang ditulis tiap test.
const { build } = require('./build-gallery');

module.exports = async () => {
  const r = build();
  // stderr, bukan stdout: reporter mesin (mis. --reporter=json) menulis ke stdout.
  process.stderr.write(`\ngaleri: ${r.cards} kartu (${r.fails} gagal) → report/gallery.html\n`);
};
