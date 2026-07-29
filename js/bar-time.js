// ===================== batas bar: tutup & langkah maju =====================
// `DUR[tf]` (js/constants.js) adalah durasi NOMINAL per TF. Untuk semua TF sampai `W` itu cukup,
// tapi untuk `MN` ia MUSTAHIL benar: bulan 28–31 hari sementara konstantanya satu angka
// (2.63e9 ms = 30,4398 hari = rata-rata). Selisihnya bukan kosmetik —
//
//   Jul 2026 (31 hari) → tutup dianggap 13j 26m LEBIH AWAL
//   Feb 2026 (28 hari) → tutup dianggap 58j 33m LEBIH LAMBAT
//
// dan `DUR` dipakai sebagai BATAS TUTUP di jalur yang kelihatan pengguna: countdown ⏱, penjaga
// anti-lookahead `revealed()` (Bar Replay), serta proyeksi bar di area future.
//
// Dua aturan di file ini:
//
//   1. Kalau bar punya PENERUS di data, batas tutupnya adalah open penerus itu — eksak, nol
//      aritmetika, otomatis benar untuk MN, pekan DST (167/169 jam), maupun gap pasar. Data yang
//      jadi kebenaran, bukan konstanta.
//   2. Hanya bar TERAKHIR (yang sedang terbentuk) butuh proyeksi, dan khusus MN proyeksinya
//      dihitung dari kalender, bukan dari konstanta.
//
// Jangkar bulanan OANDA: bar suatu bulan BUKA pada 17:00 New York di hari TERAKHIR bulan
// sebelumnya (= 21:00Z saat EDT, 22:00Z saat EST) dan TUTUP pada 17:00 NY di hari terakhir bulan
// itu sendiri. Terverifikasi atas 12 bar EUR_USD berurutan, termasuk dua transisi DST.
// Rancangan: docs/superpowers/specs/2026-07-29-monthly-bar-boundary-design.md

// Bulan dagang milik sebuah bar bulanan.
//
// +12 jam dari open (17:00 NY) mendarat di hari ke-1 bulan dagang, sekitar 04:00–06:00 NY apa pun
// keadaan DST-nya. Itu sengaja: membaca bulan dari titik AMAN di dalam bulan dagang tak perlu
// mengasumsikan open selalu jatuh di "hari terakhir" bulan sebelumnya, jadi ia tetap benar kalau
// OANDA suatu saat menggeser jangkarnya.
function monthlyTradingMonth(open){
  const p = nyParts(open + 12 * 3600000);
  return { y: p.y, mo: p.mo };
}
// Hari terakhir bulan (mo = 1..12). Trik Date.UTC: hari ke-0 bulan berikutnya = hari terakhir
// bulan ini — benar untuk tahun kabisat tanpa aturan kabisat ditulis tangan.
function lastDayOfMonth(y, mo){ return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }
// Open bar bulanan `n` langkah ke depan dari bar yang buka di `open`.
//
// Jam jangkarnya DIBACA dari bar itu sendiri (`nyParts(open).h`), bukan dipatok 17. Jadi kalau
// alignment OANDA berubah — atau kita sendiri meng-override `dailyAlignment` seperti yang sudah
// dilakukan untuk D/W/H4 di main.go — proyeksi ini ikut pindah tanpa perlu disentuh.
function monthlyStep(open, n){
  const { h, min } = nyParts(open);
  const tm = monthlyTradingMonth(open);
  // Bulan absolut supaya lintas tahun & n>1 tak butuh cabang sendiri.
  const abs = tm.y * 12 + (tm.mo - 1) + ((n | 0) - 1);
  const y = Math.floor(abs / 12), mo = (abs % 12) + 1;
  return nyTimestamp(y, mo, lastDayOfMonth(y, mo), h, min);
}
// Open bar `n` langkah ke depan dari `ts`. Satu-satunya tempat "durasi TF" boleh jadi aritmetika.
function stepBarTs(tf, ts, n){
  n = (n == null) ? 1 : n;
  if(tf === 'MN') return monthlyStep(ts, n);
  return ts + n * DUR[tf];
}
// Batas tutup bar ke-`i` dalam `arr`: open bar berikutnya bila ada, proyeksi bila `i` bar terakhir.
function barEndAt(tf, i, arr){
  if(arr && arr[i + 1]) return arr[i + 1].timestamp;
  return stepBarTs(tf, arr[i].timestamp, 1);
}
// Cursor `T` yang mengungkap SEMUA bar (mode Live / "lompat ke bar terbaru").
//
// Wajib lewat sini, bukan `open + DUR[tf]`: begitu revealed() memakai batas bulan yang benar, rumus
// DUR untuk bulan 31 hari mendarat 13j 26m SEBELUM tutup → bar terbaru justru tak pernah terungkap.
function cursorAtNewest(tf, arr){
  if(!arr || !arr.length) return null;
  return barEndAt(tf, arr.length - 1, arr);
}

// ---- area FUTURE (kanan bar terakhir): ekstrapolasi & kebalikannya ----
// Label sumbu-X, anchor gambar, dan alat posisi memakai "n bar ke depan" dalam satuan PECAHAN.
// Untuk TF berdurasi tetap itu satu perkalian; untuk MN harus melangkah bulan demi bulan karena
// panjang bulannya tak seragam — kalau tidak, "+1 bar" dari bar Juli mendarat di 31 Jul 07:33Z,
// di tengah-tengah bar Juli sendiri, bukan di awal bar Agustus.

// Waktu setelah `steps` bar (boleh pecahan) dari open `from`.
function tsAfterSteps(tf, from, steps){
  if(tf !== 'MN') return from + steps * DUR[tf];
  const n = Math.floor(steps), f = steps - n;
  const o = stepBarTs(tf, from, n), e = stepBarTs(tf, o, 1);
  return o + f * (e - o);
}
// Kebalikannya: berapa bar (pecahan) dari open `from` ke waktu `to` (dipakai hanya saat to >= from).
function barStepsFrom(tf, from, to){
  if(tf !== 'MN'){ const d = DUR[tf]; return d ? (to - from) / d : 0; }
  let n = 0, o = from, e = stepBarTs(tf, o, 1);
  // Batas 1200 bar (~100 tahun) — cukup jauh untuk area future chart mana pun, sekaligus menahan
  // loop liar kalau `to` datang dari nilai yang tak masuk akal.
  while(to >= e && n < 1200){ n++; o = e; e = stepBarTs(tf, o, 1); }
  return n + (e > o ? (to - o) / (e - o) : 0);
}
