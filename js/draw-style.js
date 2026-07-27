// ===== style per-objek gambar (ala TradingView): id → {color,size,style} =====
const DRAW_DEFAULT = {
  trendline:{color:'#4a71ff',size:1,style:'solid',textAlign:'center',textValign:'top'},
  rect:{color:'#4a71ff',size:1,style:'solid',textAlign:'center',textValign:'middle'},
  fib3:{color:'#4a71ff',size:1,style:'solid'},
  dateRange:{color:'#4a71ff',size:2,style:'solid'},
  text:{color:'',size:13,style:'solid',textAlign:'left',textValign:'top'},
  horizontalStraightLine:{color:'#4a71ff',size:1,style:'dotted'},  // default dotted, warna bisa diganti
  verticalStraightLine:{color:'#4a71ff',size:1,style:'dotted'},
  // Long/Short Position: warna & transparansi zona Profit (tgt) & Stop terpisah, per objek.
  longPosition:{tgtColor:'#089981',tgtAlpha:12,stopColor:'#f23645',stopAlpha:12},
  shortPosition:{tgtColor:'#089981',tgtAlpha:12,stopColor:'#f23645',stopAlpha:12},
  // --- garis bawaan klinecharts yang di-ekspos ---
  straightLine:{color:'#4a71ff',size:1,style:'solid'},
  rayLine:{color:'#4a71ff',size:1,style:'solid'},
  horizontalRayLine:{color:'#4a71ff',size:1,style:'solid'},
  priceLine:{color:'#4a71ff',size:1,style:'dashed'},
  parallelStraightLine:{color:'#4a71ff',size:1,style:'solid'},
  priceChannelLine:{color:'#4a71ff',size:1,style:'solid'},
  fibonacciLine:{color:'#4a71ff',size:1,style:'solid'},
  // --- shape custom baru ---
  circle:{color:'#4a71ff',size:1,style:'solid'},
  ellipse:{color:'#4a71ff',size:1,style:'solid'},
  arrow:{color:'#4a71ff',size:2,style:'solid'},
  arrowMarkUp:{color:'#089981',size:2,style:'solid'},
  arrowMarkDown:{color:'#f23645',size:2,style:'solid'},
  callout:{color:'#4a71ff',size:1,style:'solid',textAlign:'left',textValign:'top'},
};
// garis bawaan klinecharts (horizontal/vertical) — pakai styles.line, bukan createPointFigures
const BUILTIN_LINE={horizontalStraightLine:1, verticalStraightLine:1,
  straightLine:1, rayLine:1, horizontalRayLine:1, priceLine:1,
  parallelStraightLine:1, priceChannelLine:1, fibonacciLine:1};
// Tag tanggal DEFAULT klinecharts di sumbu X (polos, tanpa pill) ditekan utk SEMUA overlay.
// Objek berbasis waktu (vertical line, date range) render tag-nya sendiri via createXAxisFigures
// dgn pill seragam ala hover crosshair (lihat xDateFig) → tak butuh default figure sama sekali.
// _overrideInstance klinecharts mengabaikan flag ini & template built-in (ray/channel/fib) yg
// default-nya true tak bisa di-edit → paksa false di instance saat draw selesai / restore.
function applyXDateFlag(o){ try{ if(o) o.needDefaultXAxisFigure=false; }catch(_){}}
function klineLineStyles(st){ const ls=lsLine(st); return {
  line:Object.assign({color:st.color,size:st.size},ls),
  // tag price (Y) default klinecharts saat terpilih → pill seragam ala hover crosshair (Inter 10px bold,
  // radius 4, padding 6/3), bg ikut warna objek. Juga menata label in-pane priceLine/fibonacciLine.
  text:{color:'#fff', backgroundColor:st.color, borderColor:'rgba(0,0,0,0)',
    size:10, family:AXIS_FONT, weight:'bold', borderRadius:4,
    paddingLeft:6, paddingRight:6, paddingTop:3, paddingBottom:3}
}; }
const objStyle = {};   // overlayId -> {color,size,style}
function dstyle(o){ return Object.assign({}, DRAW_DEFAULT[o&&o.name]||{color:'#4a71ff',size:1,style:'solid'}, objStyle[o&&o.id]||{}); }
function setObjStyle(id, patch){
  objStyle[id]=Object.assign({}, objStyle[id]||{}, patch);
  try{ const o=chart.getOverlayById(id); if(!o) return;
    if(BUILTIN_LINE[o.name]) chart.overrideOverlay({id, styles:klineLineStyles(dstyle(o))});
    else chart.overrideOverlay({id, points:o.points});
  }catch(e){}
  scheduleSaveDraws();
}
// klinecharts hanya kenal 'solid'/'dashed' → 'dotted' & 'dashed' dipetakan ke dashedValue [dash,gap]
const DASHV={ dashed:[10,8], dotted:[2,7] };
function lsLine(st){ const d=DASHV[st&&st.style]; return d?{style:'dashed',dashedValue:d}:{style:'solid'}; }

