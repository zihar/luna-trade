// ===================== chart init (1 chart besar) =====================
// Font & ukuran label sumbu/crosshair — disamakan dgn label hover-future (.axis-time):
// 10px Inter Tight, minimalis. Konsisten sebelum & sesudah candle terakhir.
const AXIS_FONT = "'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const chTextStyle = bg => ({ backgroundColor:bg, color:'#fff', size:10, family:AXIS_FONT, weight:'bold',
  borderRadius:4, paddingLeft:6, paddingRight:6, paddingTop:3, paddingBottom:3 });
// buletan handle titik overlay (drag/draw): isi putih bersih + border tipis gelap. Dipakai di dark/light
// styles & utk RESTORE setelah menggambar — selama menggambar handle di-transparankan (HIDDEN_POINT) supaya
// tak ada buletan di kursor sebelum klik (lihat createDraw/onDrawEnd).
const OVERLAY_POINT = { color:'#ffffff', borderColor:'rgba(0,0,0,0.35)', borderSize:1.5, radius:3.5,
  activeColor:'#ffffff', activeBorderColor:'rgba(0,0,0,0.5)', activeBorderSize:2, activeRadius:5 };
const HIDDEN_POINT = { color:'transparent', borderColor:'transparent', activeColor:'transparent', activeBorderColor:'transparent' };
const darkStyles = {
  grid:{ horizontal:{color:'#1f1f24'}, vertical:{color:'#1f1f24'} },
  candle:{
    bar:{ upColor:'#089981',downColor:'#f23645',noChangeColor:'#89898b',
          upBorderColor:'#089981',downBorderColor:'#f23645',upWickColor:'#089981',downWickColor:'#f23645'},
    priceMark:{ high:{show:false}, low:{show:false}, last:{ text:{color:'#101013'} } },
    // legend OHLC native (custom): O/H/L/C + change abs/% berwarna up/down; ikut crosshair; offset di bawah
    // baris info-instrumen (overlay HTML) → legend indikator menumpuk otomatis di bawahnya (ala TradingView).
    // candleTooltipCustom DIBUNGKUS, jangan diserahkan sebagai nilai: deklarasinya ~220 baris di bawah
    // sini, jadi hari ini hanya tertahan hoisting satu blok inline. Kalau nilainya `undefined` saat
    // styles dibuat, klinecharts diam-diam kembali ke tooltip bawaan & legend O/H/L/C hilang tanpa
    // error. Dijaga tests/smoke/candle-tooltip.spec.js (dengan custom:undefined → 2/2 merah).
    tooltip:{ showRule:'always', showType:'standard', offsetTop:11, offsetLeft:120,
      text:{ size:11, family:AXIS_FONT, weight:'bold', marginLeft:0, marginRight:8, marginTop:2, marginBottom:2 },
      custom:(...a)=>candleTooltipCustom(...a) },
  },
  indicator:{ tooltip:{ showRule:'none' } },
  xAxis:{ axisLine:{color:'#434346'}, tickText:{color:'#89898b', size:10, family:AXIS_FONT}, tickLine:{color:'#434346'} },
  yAxis:{ axisLine:{color:'#434346'}, tickText:{color:'#89898b', size:10, family:AXIS_FONT}, tickLine:{color:'#434346'} },
  crosshair:{ horizontal:{ text:chTextStyle('#4a71ff') }, vertical:{ text:chTextStyle('#4a71ff') } },
  overlay:{ text:{color:'#fff', backgroundColor:'rgba(27,27,31,0.92)', borderColor:'rgba(0,0,0,0)'},
    point: OVERLAY_POINT },
};
const lightStyles = {
  grid:{ horizontal:{color:'#eceff3'}, vertical:{color:'#eceff3'} },
  candle:{
    bar:{ upColor:'#089981',downColor:'#f23645',noChangeColor:'#999',
          upBorderColor:'#089981',downBorderColor:'#f23645',upWickColor:'#089981',downWickColor:'#f23645'},
    priceMark:{ high:{show:false}, low:{show:false}, last:{ text:{color:'#fff'} } },
    // legend OHLC native (custom): O/H/L/C + change abs/% berwarna up/down; ikut crosshair; offset di bawah
    // baris info-instrumen (overlay HTML) → legend indikator menumpuk otomatis di bawahnya (ala TradingView).
    tooltip:{ showRule:'always', showType:'standard', offsetTop:11, offsetLeft:120,
      text:{ size:11, family:AXIS_FONT, weight:'bold', marginLeft:0, marginRight:8, marginTop:2, marginBottom:2 },
      custom:(...a)=>candleTooltipCustom(...a) },
  },
  indicator:{ tooltip:{ showRule:'none' } },
  xAxis:{ axisLine:{color:'#d6dbe2'}, tickText:{color:'#697280', size:10, family:AXIS_FONT}, tickLine:{color:'#d6dbe2'} },
  yAxis:{ axisLine:{color:'#d6dbe2'}, tickText:{color:'#697280', size:10, family:AXIS_FONT}, tickLine:{color:'#d6dbe2'} },
  crosshair:{ horizontal:{ text:chTextStyle('#3a5fe0') }, vertical:{ text:chTextStyle('#3a5fe0') } },
  overlay:{ text:{color:'#1e242e', backgroundColor:'rgba(200,208,220,0.92)', borderColor:'rgba(0,0,0,0)'},
    point: OVERLAY_POINT },
};
