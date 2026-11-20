// ===================== skala harga (sumbu Y) =====================
//
// Wheel di atas SUMBU harga = skala harga (meregang/memampatkan), persis hasil klik-drag di
// sumbu. Wheel di area plot tetap zoom-waktu bawaan KLineCharts. Shift+wheel di mana pun juga
// men-skala harga (jalan pintas untuk yang tak mau menggeser kursor ke sumbu).
//
// KLineCharts 9.8.10 tak punya API zoom-harga di permukaan publiknya, tapi komponen sumbunya
// terjangkau: `chart.getAllDrawPanes()` → `pane.getAxisComponent()` → `getRange()/setRange()`.
// Itu persis yang dipakai jalur drag sumbu miliknya sendiri, jadi rumus di bawah cuma menyalin
// rumus internal itu (rentang di-skala mengelilingi TENGAHNYA), lalu `adjustPaneViewport`.
//
// KENAPA BUKAN MENSINTESIS DRAG (jalur lama, dicabut):
//   Versi sebelumnya mengirim mousedown→mousemove→mouseup palsu per notch wheel. KLineCharts
//   MEMBUANG `pressedMouseMoveEvent` yang jarak manhattan-nya < 5px dari mousedown-nya, jadi
//   langkah trackpad (deltaY 2–15, bukan 100) harus DITAHAN sampai geseran implisitnya ≥ 6px
//   baru boleh dilepas. Akibatnya terukur: cuma 5–20% event wheel yang mengubah skala, tiap
//   perubahan meloncat 1,6–5,4% — sementara zoom-waktu di area plot menerapkan 100% event
//   dengan langkah 0,6%. Itulah "bergetar/tersendat" yang cuma terasa di sumbu harga.
//   Lebih buruk: ambang 6px itu dihitung dari pageY, jadi kekasarannya ikut ketinggian kursor
//   (dekat tepi atas ~5,4% per loncatan, dekat bawah ~0,9%), dan sisa notch yang belum sampai
//   ambang dibuang — total skalanya meleset dari niat pengguna.
//
//   Menyetel rentang langsung membuat semua itu hilang sekaligus: tak ada ambang, tak ada notch
//   yang ditahan atau dibuang, tak ada click/double-click palsu yang bisa mengembalikan
//   auto-scale, dan tak ada mousedown palsu yang bisa berubah jadi drag SL/TP (dulu butuh
//   penjaga `elementFromPoint` sendiri).

const AXIS_ZONE = 70;          // fallback lebar sumbu (px) bila getSize gagal
const SCALE_PER_NOTCH = 1.05;  // satu notch wheel mouse (deltaY≈100) = 5%

// Wheel → jumlah "notch" ternormalkan (mengikuti normalisasi deltaMode KLineCharts sendiri).
// Trackpad mengirim banyak delta kecil → langkahnya halus; fling di-clamp supaya tak meloncat.
function wheelNotches(e){
  let n = e.deltaY/100;
  if(e.deltaMode===1) n *= 32;        // DOM_DELTA_LINE
  else if(e.deltaMode===2) n *= 120;  // DOM_DELTA_PAGE
  return Math.sign(n)*Math.min(1, Math.abs(n));
}

// Batas kanan area plot (px, relatif kontainer). Di kanannya = sumbu harga.
function plotRightEdge(c, rect){
  try{ const sz=c.getSize('candle_pane','main'); if(sz && sz.width>0) return sz.width; }catch(e){}
  return rect.width - AXIS_ZONE;
}

// Pane yang menaungi ketinggian y (relatif kontainer) — begitulah wheel di sumbu osilator
// men-skala osilatornya, bukan pane candle. Pane sumbu-X dilewati: "axis component"-nya sumbu
// waktu, bukan harga.
function paneAtY(c, y){
  let xId = null;
  try{ xId = c.getXAxisPane().getId(); }catch(e){}
  const panes = c.getAllDrawPanes();
  for(let i=0;i<panes.length;i++){
    const p = panes[i];
    if(p.getId() === xId) continue;
    const b = p.getBounding();
    if(y >= b.top && y < b.top + b.height) return p;
  }
  return null;
}

// Skala rentang harga satu pane dengan faktor f (>1 = memampatkan), mengelilingi tengah rentang.
// Salinan rumus drag sumbu KLineCharts; `setRange` sekaligus mematikan auto-calc, sama seperti
// drag — jadi "Reset chart view" & double-click di sumbu tetap satu-satunya jalan pulang ke auto.
function scaleRange(c, pane, f){
  const ax = pane.getAxisComponent();
  if(!ax || !ax.getScrollZoomEnabled || !ax.getScrollZoomEnabled()) return false;
  const r = ax.getRange();
  if(!r || !isFinite(r.range)) return false;
  const w = (r.range*f - r.range)/2;
  const from = r.from - w, to = r.to + w;
  if(!(to > from) || !isFinite(from) || !isFinite(to)) return false;
  const realFrom = ax.convertToRealValue(from), realTo = ax.convertToRealValue(to);
  ax.setRange({from, to, range: to-from, realFrom, realTo, realRange: realTo-realFrom});
  c.adjustPaneViewport(false, true, true, true);
  return true;
}

// Pasang skala-harga ke satu elemen chart (panel utama & panel multi-chart).
function attachPriceScale(el, c){
  el.addEventListener('wheel',(e)=>{
    const rect = el.getBoundingClientRect();
    const onAxis = (e.clientX-rect.left) >= plotRightEdge(c, rect);
    if(!onAxis && !e.shiftKey) return;              // area plot tanpa Shift → zoom-waktu default
    const notches = wheelNotches(e);
    if(!notches) return;
    const pane = paneAtY(c, e.clientY - rect.top);
    if(!pane) return;
    // scroll bawah (deltaY>0) → faktor>1 → rentang harga membesar = memampatkan; atas = meregang.
    let ok = false;
    try{ ok = scaleRange(c, pane, Math.pow(SCALE_PER_NOTCH, notches)); }catch(err){ ok = false; }
    if(ok){ e.preventDefault(); e.stopPropagation(); }
  },{passive:false,capture:true});
}
attachPriceScale($('#chart'), chart);

// ===================== lebar sumbu harga stabil (grow-only) =====================
//
// KLineCharts menghitung ulang lebar sumbu-Y di SETIAP layout (`YAxis.getAutoSize`) dari label
// tick terlebar yang sedang tampak + label crosshair `range.to`. Dua hal membuatnya goyang:
// font sumbu proporsional (Inter Tight: "1.1111" lebih sempit dari "1.0800") dan jumlah desimal
// tick yang ikut interval zoom. Hasilnya terukur 47↔53px, ~80 loncatan per 30 dtk zoom/geser —
// dan tiap loncatan menggeser SELURUH area plot (candle + gambar) ke samping = "layar bergetar".
//
// Penawarnya meniru TradingView: dalam satu instrumen sumbu hanya boleh MEMBESAR. Memo disimpan
// per instance sumbu (pane indikator punya sumbunya sendiri; lebar akhir = maks semua pane, jadi
// tetap grow-only). Prototipe dipatch sekali → berlaku juga untuk panel multi-chart.
// `resetPriceAxisWidth` dipanggil saat ganti instrumen/presisi supaya simbol berdigit lebih
// sedikit tak mewarisi sumbu lebar simbol sebelumnya.
function stabilizePriceAxisWidth(c){
  const pane = c.getAllDrawPanes().find(p => p.getId() === 'candle_pane');
  const proto = pane && Object.getPrototypeOf(pane.getAxisComponent());
  if(!proto || typeof proto.getAutoSize !== 'function' || proto.__lunaGrowOnly) return;
  const orig = proto.getAutoSize;
  proto.getAutoSize = function(){
    const w = orig.call(this);
    if(typeof w !== 'number' || !isFinite(w)) return w;
    if(this.__lunaMaxW == null || w > this.__lunaMaxW) this.__lunaMaxW = w;
    return this.__lunaMaxW;
  };
  proto.__lunaGrowOnly = true;
}
function resetPriceAxisWidth(c){
  try{
    let xId = null; try{ xId = c.getXAxisPane().getId(); }catch(e){}
    c.getAllDrawPanes().forEach(p => { if(p.getId() !== xId){ const ax = p.getAxisComponent(); if(ax) ax.__lunaMaxW = null; } });
  }catch(e){}
}
try{ stabilizePriceAxisWidth(chart); }catch(e){}
