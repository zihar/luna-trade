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

