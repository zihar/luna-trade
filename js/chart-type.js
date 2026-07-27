// ===================== chart type switcher (candle/hollow/bar/area) =====================
(function(){
  const CHART_TYPES=[
    {v:'candle_solid', label:'Candles'},
    {v:'candle_stroke',label:'Hollow candles'},
    {v:'ohlc',         label:'Bars'},
    {v:'area',         label:'Area'},
  ];
  const btn=$('#ctBtn'), menu=$('#ctMenu'); if(!btn||!menu) return;
  const label=()=>{ const t=CHART_TYPES.find(t=>t.v===chartType); return t?t.label:'Candles'; };
  function render(){
    menu.innerHTML='<div class="ind-grp">Chart type</div>'+CHART_TYPES.map(t=>
      `<div class="ind-item${t.v===chartType?' on':''}" data-ct="${t.v}"><span class="ind-check">✓</span>${t.label}</div>`).join('');
    menu.querySelectorAll('.ind-item').forEach(el=>el.onclick=()=>{
      chartType=el.dataset.ct;
      try{ localStorage.setItem('br_charttype',chartType); }catch(e){}
      try{ applyChartCfg(); }catch(e){}
      render(); btn.title='Chart type: '+label();
      try{ track('charttype',{type:chartType}); }catch(e){}
      menu.classList.remove('open'); btn.setAttribute('aria-expanded','false');
    });
  }
  btn.title='Chart type: '+label();
  btn.onclick=(e)=>{ e.stopPropagation(); const open=menu.classList.toggle('open'); btn.setAttribute('aria-expanded',open?'true':'false'); if(open) render(); };
  document.addEventListener('mousedown',e=>{ if(menu.classList.contains('open')&&!menu.contains(e.target)&&!btn.contains(e.target)){ menu.classList.remove('open'); btn.setAttribute('aria-expanded','false'); } }, true);
})();

