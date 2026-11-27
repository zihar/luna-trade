// [Shift = kunci sudut] Menahan Shift saat menggambar / menyeret ujung garis mengunci arahnya ke
// kelipatan 45° — horizontal, vertikal, dan diagonal rapi. Perilaku TradingView.
// Rancangan & keputusannya: docs/superpowers/specs/2026-08-07-shift-angle-lock-design.md
//
// Sudut dihitung di RUANG PIKSEL, bukan ruang harga/waktu: "lurus" adalah properti visual, dan
// satuan kedua sumbu chart tak sebanding. Konsekuensi yang diterima (TV sama): ubah zoom → sudut
// garis yang sudah jadi ikut berubah.

// Tool yang kena. Bentuk (rect/circle/ellipse), fib, position, dan text sengaja di luar — di TV
// Shift pada bentuk berarti "kunci rasio 1:1", perilaku yang berbeda dan belum dicakup di sini.
const ANGLE_LOCK={trendline:1, rayLine:1, straightLine:1, arrow:1, parallelStraightLine:1, priceChannelLine:1, path:1};

// Jangkar penguncian = indeks titik yang jadi pangkal sinar 45°, atau -1 (tak dikunci).
// Path (polyline N titik): TIAP segmen terkunci terhadap titik SEBELUMNYA, seperti TradingView.
// Tool lain: hanya titik ke-2 terhadap titik ke-1 (titik #3 channel cuma jarak paralel).
function lockAnchorIdx(name, m){        // m = indeks titik yang sedang digambar
  if(!angleLockOn(name) || m<1) return -1;
  return name==='path' ? m-1 : (m===1 ? 0 : -1);
}
function dragLockAnchorIdx(name, i, n){ // i = indeks ujung yang diseret, n = jumlah titik
  if(!angleLockOn(name) || n<2 || i==null || i<0) return -1;
  if(name==='path') return i>0 ? i-1 : 1;
  return i<2 ? (i===0?1:0) : -1;
}

// Status Shift dilacak dari DUA sumber. keydown/keyup saja tak cukup: bila Shift dilepas ketika
// window kehilangan fokus (mis. pindah aplikasi di tengah gestur), `keyup` tak pernah datang dan
// garis akan nyangkut terkunci selamanya. Tiap event mouse membawa `shiftKey` yang selalu benar,
// jadi ia dipakai untuk menyegarkan — dipasang di fase CAPTURE pada window supaya sudah tersegar
// sebelum handler #chart mana pun (draw-pointer, measure) membacanya.
let shiftHeld=false;
addEventListener('keydown',(e)=>{ if(e.key==='Shift') shiftHeld=true; });
addEventListener('keyup',(e)=>{ if(e.key==='Shift') shiftHeld=false; });
addEventListener('blur',()=>{ shiftHeld=false; });
addEventListener('mousemove',(e)=>{ shiftHeld=e.shiftKey; },{capture:true});
addEventListener('mousedown',(e)=>{ shiftHeld=e.shiftKey; },{capture:true});

function angleLockOn(name){ return shiftHeld && !!ANGLE_LOCK[name]; }

// Titik overlay → pixel container-relative (ruang yang sama dgn e.x/e.y klinecharts &
// fracAnchorFromPx). null bila titiknya tak punya anchor yang bisa dikonversi.
function anchorPx(p){
  if(!p) return null;
  const q = p.timestamp!=null ? {timestamp:p.timestamp, value:p.value} : {dataIndex:p.dataIndex, value:p.value};
  if(q.value==null || (q.timestamp==null && q.dataIndex==null)) return null;
  let c=chart.convertToPixel(q,{paneId:'candle_pane',absolute:true}); if(Array.isArray(c)) c=c[0];
  return c ? {x:c.x, y:c.y} : null;
}

// Proyeksi TEGAK LURUS (x,y) ke sinar 45° terdekat yang berpangkal di (ax,ay). Bukan "salin |dx|
// ke dy": proyeksi ortogonal menjaga titik sedekat mungkin dgn kursor, jadi ia tak melompat jauh
// saat arah kursor melenceng. Sudut dibulatkan ke kelipatan terdekat, jadi simpangannya ≤22,5° dan
// panjang proyeksi selalu positif (titik tak pernah membalik ke sisi seberang jangkar).
function constrainPx(ax, ay, x, y){
  const dx=x-ax, dy=y-ay;
  if(dx===0 && dy===0) return {x, y};
  const step=Math.PI/4;
  const ang=Math.round(Math.atan2(dy,dx)/step)*step;
  const ux=Math.cos(ang), uy=Math.sin(ang);
  const t=dx*ux + dy*uy;
  return {x: ax+ux*t, y: ay+uy*t};
}

// constrainPx + X di pusat candle (js/util.js barAnchorFromPx). X dibulatkan ke pusat bar, lalu Y
// dihitung ulang di SINAR yang sama → sudut tetap persis kelipatan 45°. Sinar vertikal dibiarkan
// (X-nya = X jangkar, yang sudah di pusat candle).
function lockPx(ax, ay, x, y){
  const c=constrainPx(ax, ay, x, y), dx=c.x-ax;
  if(Math.abs(dx)<1e-6) return c;
  const xs=snapPxToBar(c.x);
  return {x:xs, y: ay + (c.y-ay)*(xs-ax)/dx};
}
