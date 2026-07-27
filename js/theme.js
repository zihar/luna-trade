// ===================== tema gelap/terang =====================
function applyTheme(t){
  const light = t==='light';
  document.body.classList.toggle('light', light);
  drawTextColor = light?'#1e242e':'#e8edf2';
  drawTextMuted = light?'#697280':'#89898b';
  try{ chart.setStyles(light?lightStyles:darkStyles); }catch(e){}
  try{ secondaries.forEach(sc=>sc.chart.setStyles(light?lightStyles:darkStyles)); }catch(e){}
  try{ applyChartCfg(); }catch(e){}   // pertahankan warna chart kustom user di atas tema
  syncThemeUI(light);   // pemilih tema kini di dalam popup profil
  localStorage.setItem('br_theme', t);
  try{ drawEquity(); }catch(e){}   // warna kurva ikut tema
  try{ updateChartLegend(); }catch(e){}   // setStyles tema mereset offsetLeft OHLC → pasang ulang
}
// sinkronkan segmented control tema di popup profil (aman bila popup belum dibuat)
function syncThemeUI(light){
  document.querySelectorAll('#themeSeg button').forEach(btn=>{
    btn.classList.toggle('on', btn.dataset.theme===(light?'light':'dark'));
  });
}
applyTheme(localStorage.getItem('br_theme')||'dark');

// Skala HARGA via SHIFT + scroll wheel (drag vertikal sintetis pd sumbu — KLineCharts tak punya
// API zoom-harga). Plain wheel TIDAK di-intercept → zoom-waktu bawaan KLineCharts konsisten di
// seluruh chart (dulu: zona 70px kanan diam-diam jadi skala-harga → wheel terasa "loncat").
const AXIS_ZONE = 70; // lebar perkiraan sumbu harga (px) dari tepi kanan chart
// Pasang skala-harga (Shift+wheel) ke satu elemen chart (panel utama & sekunder).
function attachPriceWheelZoom(el){
  el.addEventListener('wheel',(e)=>{
    if(!e.shiftKey) return;              // tanpa Shift → biarkan zoom-waktu default (konsisten)
    e.preventDefault(); e.stopPropagation();
    const rect=el.getBoundingClientRect();
    const ax=rect.right-AXIS_ZONE/2;     // titik di dalam sumbu harga → picu gesture skala-harga KLineCharts
    const cy=e.clientY;
    const tgt=document.elementFromPoint(ax,cy); if(!tgt) return;
    const delta=e.deltaY>0?14:-14;       // scroll bawah = squeeze, atas = stretch
    const mk=(type,y,btn)=> new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:ax,clientY:y,buttons:btn,button:0});
    tgt.dispatchEvent(mk('mousedown',cy,1));
    tgt.dispatchEvent(mk('mousemove',cy+delta,1));
    tgt.dispatchEvent(mk('mouseup',cy+delta,0));
  },{passive:false,capture:true});
}
attachPriceWheelZoom($('#chart'));

