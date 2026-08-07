// [Shift = kunci sudut] Menahan Shift saat menggambar / menyeret ujung garis mengunci arahnya ke
// kelipatan 45° — horizontal, vertikal, dan diagonal rapi. Perilaku TradingView.
// Rancangan & keputusannya: docs/superpowers/specs/2026-08-07-shift-angle-lock-design.md
//
// Sudut dihitung di RUANG PIKSEL, bukan ruang harga/waktu: "lurus" adalah properti visual, dan
// satuan kedua sumbu chart tak sebanding. Konsekuensi yang diterima (TV sama): ubah zoom → sudut
// garis yang sudah jadi ikut berubah.

// Tool yang kena. Bentuk (rect/circle/ellipse), fib, position, dan text sengaja di luar — di TV
// Shift pada bentuk berarti "kunci rasio 1:1", perilaku yang berbeda dan belum dicakup di sini.
const ANGLE_LOCK={trendline:1, rayLine:1, straightLine:1, arrow:1, parallelStraightLine:1, priceChannelLine:1};

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
