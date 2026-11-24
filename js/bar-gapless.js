// ===================== candle menyambung (tanpa gap harga) =====================
// OANDA mengisi `open` dengan tick PERTAMA periode itu, bukan close bar sebelumnya → hampir tiap
// bar punya celah kecil (XAU_USD: median $0,03 intraday, $2,6 Daily, s/d $90 di pembukaan pekan).
// Chart menampilkannya menyambung ala FOREX.com: open = close bar sebelumnya, high/low melebar
// seperlunya supaya celah itu tertutup badan/sumbu candle. TERMASUK celah akhir pekan (permintaan
// pengguna 2026-11-24).
//
// Hanya lapisan TAMPILAN (+ magnet, yang harus menempel ke yang digambar). tfData tetap mentah:
// engine fill SL/TP replay, agregasi forming bar, dan alert memakai OHLC asli OANDA.

// bar `c` versi menyambung terhadap bar sebelumnya `prev` (objek baru; `c` tak diubah)
function sealBar(prev, c){
  if(!prev || !c || c.open===prev.close) return c;
  const o=prev.close;
  return {...c, open:o, high:Math.max(c.high,o), low:Math.min(c.low,o)};
}
// seluruh deret (asc) → deret menyambung. Close tak pernah diubah, jadi tiap bar cukup
// dibandingkan dgn bar MENTAH sebelumnya.
function sealBars(arr){
  if(!arr || arr.length<2) return arr;
  const out=new Array(arr.length); out[0]=arr[0];
  for(let i=1;i<arr.length;i++) out[i]=sealBar(arr[i-1],arr[i]);
  return out;
}
