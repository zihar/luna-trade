// ===================== setting chart (⚙ rail): candle, background, grid =====================
// bg & grid disimpan PER-TEMA (light/dark) supaya setting global tetap berfungsi di kedua tema
const CHART_DEFAULT={up:'#089981',down:'#f23645',upBorder:'#089981',downBorder:'#f23645',bgDark:'#101013',gridDark:'#1f1f24',bgLight:'#ffffff',gridLight:'#eceff3'};
let chartCfg; try{ chartCfg=Object.assign({},CHART_DEFAULT,JSON.parse(localStorage.getItem('br_chartcfg')||'{}')); }catch(e){ chartCfg=Object.assign({},CHART_DEFAULT); }
// tipe chart (klinecharts candle.type): candle_solid | candle_stroke | ohlc | area
let chartType; try{ chartType=localStorage.getItem('br_charttype')||'candle_solid'; }catch(e){ chartType='candle_solid'; }
if(!['candle_solid','candle_stroke','ohlc','area'].includes(chartType)) chartType='candle_solid';
// style bar candle dari chartCfg (border fallback ke warna body utk cfg lama tanpa key border)
function candleBarCfg(){ return {upColor:chartCfg.up,downColor:chartCfg.down,upBorderColor:chartCfg.upBorder||chartCfg.up,downBorderColor:chartCfg.downBorder||chartCfg.down,upWickColor:chartCfg.up,downWickColor:chartCfg.down}; }
// migrasi skema lama {bg,grid} (dulu dipakai utk dark) → kunci per-tema
if('bg' in chartCfg){ chartCfg.bgDark=chartCfg.bg; delete chartCfg.bg; }
if('grid' in chartCfg){ chartCfg.gridDark=chartCfg.grid; delete chartCfg.grid; }
function applyChartCfg(){
  // bg & grid per-tema → setting global berfungsi di light & dark
  const light=document.body.classList.contains('light');
  const bg   = light ? chartCfg.bgLight   : chartCfg.bgDark;
  const grid = light ? chartCfg.gridLight : chartCfg.gridDark;
  try{ chart.setStyles({
    grid:{horizontal:{color:grid},vertical:{color:grid}},
    candle:{type:chartType, bar:candleBarCfg()},
  }); }catch(e){}
  try{ secondaries.forEach(sc=>sc.chart.setStyles({grid:{horizontal:{color:grid},vertical:{color:grid}},candle:{type:chartType, bar:candleBarCfg()}})); }catch(e){}
  const c=document.querySelector('.center'), ch=document.getElementById('chart');
  if(c) c.style.background=bg; if(ch) ch.style.background=bg;
}
function saveChartCfg(){ try{localStorage.setItem('br_chartcfg',JSON.stringify(chartCfg));}catch(e){} applyChartCfg(); }
// Setting chart dibuka dari menu klik-kanan canvas (lihat handler contextmenu). Modal di tengah (gaya .dmodal,
// sama dgn setelan objek gambar), live-apply. `chartSet` = elemen scrim: Esc di draw-style-modal.js menutupnya
// lewat chartSet.classList.remove('show').
const chartSet=document.createElement('div'); chartSet.className='dmodal-scrim';
chartSet.innerHTML='<div class="dmodal" role="dialog" aria-modal="true" aria-label="Chart settings"></div>';
document.body.appendChild(chartSet);
chartSet.addEventListener('mousedown',e=>{ if(e.target===chartSet) chartSet.classList.remove('show'); });   // klik scrim = tutup
function showChartSet(){
  const light=document.body.classList.contains('light'), thm=light?'Light':'Dark';
  const bgKey=light?'bgLight':'bgDark', gridKey=light?'gridLight':'gridDark';
  const row=(label,key)=>`<label class="cs-row"><span>${label}</span><span class="cs-sw"><input type="color" data-k="${key}" value="${chartCfg[key]}" aria-label="${label}"></span></label>`;
  const panel=chartSet.querySelector('.dmodal');
  panel.innerHTML=`<div class="dm-head"><span class="dm-ico">${typeof GEAR_SVG!=='undefined'?GEAR_SVG:''}</span><span class="dm-title">Chart settings</span><button class="dm-x" title="Close" aria-label="Close">✕</button></div>`
    +`<div class="dm-body"><div class="pp-lbl">Candles</div><div class="cs-group">${row('Up body','up')}${row('Down body','down')}${row('Up border','upBorder')}${row('Down border','downBorder')}</div>`
    +`<div class="pp-lbl">Canvas (${thm} theme)</div><div class="cs-group">${row('Background',bgKey)}${row('Grid',gridKey)}</div></div>`
    +`<div class="dm-foot"><button class="dm-lock" id="csReset">Reset to default</button><button class="dm-close">Close</button></div>`;
  chartSet.classList.add('show');
  panel.querySelectorAll('input[data-k]').forEach(inp=>inp.oninput=()=>{ chartCfg[inp.dataset.k]=inp.value; saveChartCfg(); });
  panel.querySelector('#csReset').onclick=()=>{ chartCfg=Object.assign({},CHART_DEFAULT); saveChartCfg(); showChartSet(); };
  panel.querySelector('.dm-close').onclick=panel.querySelector('.dm-x').onclick=()=>chartSet.classList.remove('show');
}
applyChartCfg();   // terapkan cfg tersimpan saat startup

