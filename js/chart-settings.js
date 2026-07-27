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
// Setting chart dibuka dari menu klik-kanan canvas (lihat handler contextmenu), di posisi kursor.
const chartSet=document.createElement('div'); chartSet.className='objpop'; document.body.appendChild(chartSet);
makeDraggable(chartSet, '.pp-grip');
function showChartSet(cx,cy){
  const row=(label,key)=>`<div class="pp-lbl">${label}</div><div class="pp-row"><input type="color" data-k="${key}" value="${chartCfg[key]}" class="pp-color"></div>`;
  // bg & grid → edit kunci tema yang sedang aktif
  const light=document.body.classList.contains('light'), thm=light?'light':'dark';
  const bgKey=light?'bgLight':'bgDark', gridKey=light?'gridLight':'gridDark';
  chartSet.innerHTML=GRIP+`<div class="pp-lbl" style="font-weight:600;color:var(--txt)">⚙ Setting chart</div>`
    +row('Candle naik','up')+row('Candle turun','down')+row('Border naik','upBorder')+row('Border turun','downBorder')+row('Background ('+thm+')',bgKey)+row('Grid ('+thm+')',gridKey)+`<div class="pp-act"><button id="csReset">Reset default</button></div>`;
  chartSet.style.left=Math.min(cx,window.innerWidth-220)+'px';
  chartSet.style.top=Math.max(8,Math.min(cy,window.innerHeight-320))+'px';
  chartSet.classList.add('show');
  chartSet.querySelectorAll('input[data-k]').forEach(inp=>inp.oninput=()=>{ chartCfg[inp.dataset.k]=inp.value; saveChartCfg(); });
  chartSet.querySelector('#csReset').onclick=()=>{ chartCfg=Object.assign({},CHART_DEFAULT); saveChartCfg(); showChartSet(chartSet.offsetLeft,chartSet.offsetTop); };
}
document.addEventListener('mousedown',e=>{ if(chartSet.classList.contains('show')&&!chartSet.contains(e.target)) chartSet.classList.remove('show'); }, true);
applyChartCfg();   // terapkan cfg tersimpan saat startup

