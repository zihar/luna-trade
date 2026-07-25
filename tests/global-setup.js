// Bersihkan artefak galeri run sebelumnya supaya kartu lama tak tercampur.
const { reset } = require('./helpers/gallery');

module.exports = async () => {
  reset();
};
