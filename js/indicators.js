// ===================== indikator teknikal (ƒx) =====================
// Indikator bawaan KLineCharts di chart UTAMA. Overlay (MA/EMA/BOLL) numpang di pane
// candle; osilator (VOL/MACD/RSI) di sub-pane sendiri. Parameter (calcParams) bisa diedit
// per-indikator via skema `params` di IND_DEFS + editor gear ⚙ (default = default library).
const IND_DEFS=[
  {name:'MA',   label:'MA — Moving Average',       desc:'Trend-following average', overlay:true,
    params:{kind:'list', label:'Period', def:[5,10,30,60], min:1, max:400, step:1}},
  {name:'EMA',  label:'EMA — Exp. Moving Average', desc:'Weighted recent-price average', overlay:true,
    params:{kind:'list', label:'Period', def:[6,12,20], min:1, max:400, step:1}},
  {name:'BOLL', label:'BOLL — Bollinger Bands',    desc:'Volatility bands ±σ', overlay:true,
    params:{kind:'fixed', fields:[
      {label:'Period', def:20, min:1, max:400, step:1},
      {label:'StdDev', def:2,  min:0.1, max:10, step:0.1}]}},
  {name:'VOL',  label:'VOL — Volume',              desc:'Traded volume per bar', overlay:false,
    params:{kind:'list', label:'Period', def:[5,10,20], min:1, max:400, step:1}},
  {name:'MACD', label:'MACD',                      desc:'Momentum: MA convergence', overlay:false,
    params:{kind:'fixed', fields:[
      {label:'Short', def:12, min:1, max:400, step:1},
      {label:'Long',  def:26, min:1, max:400, step:1},
      {label:'Signal',def:9,  min:1, max:400, step:1}]}},
  {name:'RSI',  label:'RSI',                        desc:'Momentum oscillator 0–100', overlay:false,
    params:{kind:'list', label:'Period', def:[6,12,24], min:1, max:400, step:1}},
  {name:'QT', label:'QT Fractal — Quarterly Theory', desc:'Quarterly Theory fractal', overlay:true,
    params:{kind:'controls', controls:[
      {type:'select', label:'Level', options:['Auto (by TF)','Session','Daily','Weekly','Monthly'], def:0},
      {type:'number', label:'Cycles', def:4, min:1, max:20, step:1},
      {type:'bool',   label:'Fill',   def:0},
      {type:'bool',   label:'Label',  def:1},
    ]}},
];
const activeInd={};   // name -> paneId ('candle_pane' utk overlay, id sub-pane utk osilator)
const indParams={};   // name -> calcParams[] efektif (kosong/absen = pakai default skema)
function indDef(name){ return IND_DEFS.find(d=>d.name===name); }
function defParams(name){ const d=indDef(name); if(!d||!d.params) return null;
  if(d.params.kind==='controls') return d.params.controls.map(c=>c.def);
  return d.params.kind==='list' ? d.params.def.slice() : d.params.fields.map(f=>f.def); }
function effParams(name){ const p=indParams[name]; return (p&&p.length) ? p.slice() : defParams(name); }
function persistInd(){ try{ localStorage.setItem('br_indicators',
  JSON.stringify(Object.keys(activeInd).map(n=>({name:n, calcParams:indParams[n]||null, hidden:!!hiddenInd[n]})))); }catch(e){} }
function savedInd(){ try{ const a=JSON.parse(localStorage.getItem('br_indicators')||'[]'); if(!Array.isArray(a)) return [];
  return a.map(el=> typeof el==='string' ? {name:el, calcParams:null, hidden:false} : {name:el.name, calcParams:el.calcParams||null, hidden:!!el.hidden}).filter(x=>x&&x.name); }catch(e){ return []; } }
function addInd(name){
  const def=indDef(name); if(!def||activeInd[name]) return;
  try{
    const cp=effParams(name);
    const val = cp ? {name, calcParams:cp} : name;
    const pid = def.overlay ? chart.createIndicator(val, true, {id:'candle_pane'}) : chart.createIndicator(val);
    activeInd[name] = def.overlay ? 'candle_pane' : pid;   // overlay: paneId candle konstan; sub-pane: id dinamis
    if(cp) indParams[name]=cp.slice();
    try{ renderIndLegends(); }catch(e){}
  }catch(e){}
}
function setIndParams(name, calcParams){
  indParams[name]=calcParams.slice();
  try{ chart.overrideIndicator({name, calcParams}, activeInd[name]); }catch(e){}
  persistInd();
}
function removeInd(name){
  const pid=activeInd[name]; if(pid==null) return;
  try{ chart.removeIndicator(pid, name); }catch(e){}
  delete activeInd[name];
  delete hiddenInd[name]; try{ renderIndLegends(); }catch(e){}
}
function removeAllInd(){
  Object.keys(activeInd).forEach(removeInd);
  persistInd(); updateIndBadge(); try{ renderIndModalState(); renderIndLegends(); }catch(e){}
}
function updateIndBadge(){
  const n=Object.keys(activeInd).length, b=$('#indBadge'), btn=$('#indBtn');
  if(b){ b.textContent=n; b.hidden=(n===0); }
  if(btn) btn.classList.toggle('on', n>0);
}
// ===== legend on-chart per-indikator (ala TradingView) =====
// Dibangun HTML overlay penuh (legend indikator native dimatikan via styles). Nilai live &
// posisi pane dibaca lewat API publik klinecharts 9.8.10 (getIndicatorByPaneId/getSize),
// semua try/catch → gagal = degradasi anggun (angka/posisi diabaikan, kontrol tetap jalan).
const hiddenInd={};   // name -> true bila plot di-hide (pane tetap ada)
let indLegendWrap=null;
function ensureIndLegendWrap(){
  if(indLegendWrap && indLegendWrap.isConnected) return indLegendWrap;
  const host=document.getElementById('chart'); if(!host) return null;
  indLegendWrap=document.createElement('div'); indLegendWrap.className='ind-legends';
  host.appendChild(indLegendWrap); return indLegendWrap;
}
function indLegPaneId(name){ return activeInd[name]; }   // 'candle_pane' utk overlay; id sub-pane utk osilator
function legParamsText(name){ const p=effParams(name); const d=indDef(name);
  if(!p||!p.length) return '';
  if(d.params && d.params.kind==='controls') return '';   // QT: params non-numerik → tak ditampilkan
  return p.join(' '); }
function renderIndLegends(){
  const wrap=ensureIndLegendWrap(); if(!wrap) return;
  const names=Object.keys(activeInd);
  wrap.innerHTML=names.map(name=>{
    const d=indDef(name); const hid=!!hiddenInd[name];
    return `<div class="ind-leg${hid?' hidden':''}" data-leg="${name}">`+
      `<div class="ind-leg-head">`+
        `<span class="ind-leg-name">${d?d.name:name}</span>`+
        `<span class="ind-leg-params">${legParamsText(name)}</span>`+
        `<span class="ind-leg-vals"></span>`+
        `<span class="ind-leg-btns">`+
          `<button class="ind-leg-btn leg-eye" data-leg-act="eye" title="${hid?'Show':'Hide'}" aria-label="${hid?'Show':'Hide'}">${hid?EYEOFF_SVG:EYE_SVG}</button>`+
          `<button class="ind-leg-btn leg-gear" data-leg-act="gear" title="Settings" aria-label="Settings">${GEAR_SVG}</button>`+
          `<button class="ind-leg-btn leg-rm" data-leg-act="rm" title="Remove" aria-label="Remove">${XMARK_SVG}</button>`+
        `</span>`+
      `</div>`+
    `</div>`;
  }).join('');
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg;
    el.querySelectorAll('[data-leg-act]').forEach(btn=>btn.onclick=(ev)=>{
      ev.stopPropagation();
      const act=btn.dataset.legAct;
      if(act==='gear') openIndEditor(name);
      else if(act==='eye') toggleIndVisible(name);
      else if(act==='rm'){ removeInd(name); persistInd(); updateIndBadge(); try{ renderIndModalState(); }catch(e){} }
    });
  });
  positionIndLegends();
  try{ updateIndLegendValues(null); }catch(e){}
  requestAnimationFrame(()=>{ try{ positionIndLegends(); }catch(e){} });
}
function positionIndLegends(){
  const wrap=indLegendWrap; if(!wrap) return;
  // overlay indikator (candle pane) di-stack di bawah baris info instrumen (top ~30px).
  // osilator: top = top pane-nya (getSize('root')). Fallback: sembunyikan bila getSize gagal.
  let overlayTop=30;
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg; const pid=indLegPaneId(name); const d=indDef(name);
    if(d && d.overlay){ el.style.top=overlayTop+'px'; el.style.display=''; overlayTop+=el.offsetHeight+2; return; }
    let top=null;
    try{ const b=chart.getSize(pid,'root'); if(b && isFinite(b.top)) top=b.top; }catch(e){}
    if(top==null){ el.style.display='none'; return; }
    el.style.display=''; el.style.top=(top+4)+'px';
  });
}
function lastBarIndex(){ try{ const dl=chart.getDataList(); return dl.length?dl.length-1:null; }catch(e){ return null; } }
function indLineColors(){ try{ const s=chart.getStyles(); const l=s&&s.indicator&&s.indicator.lines;
  return Array.isArray(l)? l.map(x=>x&&x.color).filter(Boolean) : []; }catch(e){ return []; } }
function fmtIndNum(name,v){ if(v==null||!isFinite(v)) return null;
  const d=indDef(name); const dec=(d&&d.overlay)?decimalsFor(inst):2; return (+v).toFixed(dec); }
function updateIndLegendValues(di){
  const wrap=indLegendWrap; if(!wrap) return;
  if(di==null) di=lastBarIndex(); if(di==null) return;
  const colors=indLineColors();
  wrap.querySelectorAll('.ind-leg').forEach(el=>{
    const name=el.dataset.leg; const box=el.querySelector('.ind-leg-vals'); if(!box) return;
    if(hiddenInd[name]){ box.innerHTML=''; box.style.display='none'; return; }   // hidden → tanpa nilai live
    let html=''; let li=0;
    try{
      const ind=chart.getIndicatorByPaneId(indLegPaneId(name), name);
      const row=ind && ind.result ? ind.result[di] : null;
      if(ind && row){
        (ind.figures||[]).forEach(fig=>{
          if(!fig || fig.key==null) return;
          const raw=row[fig.key]; const num=fmtIndNum(name, raw);
          const isLine=(fig.type==null || fig.type==='line');
          const col=isLine ? (colors[li%Math.max(1,colors.length)]||'var(--muted)') : 'var(--muted)';
          if(isLine) li++;
          if(num!=null) html+=`<span style="color:${col}">${num}</span>`;
        });
      }
    }catch(e){}
    box.innerHTML=html;
    box.style.display = html ? '' : 'none';
  });
}
function toggleIndVisible(name){
  if(!activeInd[name]) return;
  hiddenInd[name] = !hiddenInd[name];
  try{ chart.overrideIndicator({name, visible: !hiddenInd[name]}, indLegPaneId(name)); }catch(e){}
  persistInd();
  // update baris terkait DI TEMPAT (bukan rebuild innerHTML penuh) → tombol tak berkedip & state hover tak reset
  const el = indLegendWrap && indLegendWrap.querySelector('.ind-leg[data-leg="'+name+'"]');
  if(!el){ renderIndLegends(); return; }
  const hid=!!hiddenInd[name]; el.classList.toggle('hidden', hid);
  const eye=el.querySelector('.leg-eye');
  if(eye){ const lbl=hid?'Show':'Hide'; eye.innerHTML=hid?EYEOFF_SVG:EYE_SVG; eye.title=lbl; eye.setAttribute('aria-label',lbl); }
  if(hid){ const vb=el.querySelector('.ind-leg-vals'); if(vb){ vb.innerHTML=''; vb.style.display='none'; } }
  else updateIndLegendValues(null);
}
try{ chart.subscribeAction('onCrosshairChange', d=>{
  try{ const di=(d && typeof d.dataIndex==='number') ? d.dataIndex : null; updateIndLegendValues(di); }catch(e){}
}); }catch(e){}
// posisi sub-pane bergeser saat resize / tambah-hapus pane / scroll → reposisi legend.
try{ const host=document.getElementById('chart');
  if(host && window.ResizeObserver){ new ResizeObserver(()=>{ try{ positionIndLegends(); }catch(e){} }).observe(host); }
}catch(e){}
try{ chart.subscribeAction('onScroll', ()=>{ try{ positionIndLegends(); updateIndLegendValues(null); }catch(e){} }); }catch(e){}
try{ chart.subscribeAction('onZoom',   ()=>{ try{ positionIndLegends(); updateIndLegendValues(null); }catch(e){} }); }catch(e){}
// editor parameter per-indikator: modal gaya .dmodal (scrim "live" = tanpa blur/gelap supaya efek ke chart terlihat).
// Buka via gear ⚙ di legend on-chart. indEditorEl = panel .dmodal di dalam scrim indEditorScrim.
let indEditorEl=null, indEditorScrim=null, indEditorName=null;
function openIndEditor(name){
  const def=indDef(name); if(!def||!def.params) return;
  if(!activeInd[name]){ addInd(name); persistInd(); renderIndModalState(); updateIndBadge(); }
  if(!indEditorEl){
    indEditorScrim=document.createElement('div'); indEditorScrim.className='dmodal-scrim live';
    indEditorScrim.innerHTML='<div class="dmodal ind-editor" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(indEditorScrim); indEditorEl=indEditorScrim.firstChild;
    indEditorScrim.addEventListener('mousedown',e=>{ if(e.target===indEditorScrim) closeIndEditor(); });
  }
  indEditorName=name; renderIndEditor();
  indEditorScrim.classList.add('show');
}
function closeIndEditor(){ if(indEditorScrim) indEditorScrim.classList.remove('show'); indEditorName=null; }
// kerangka modal: header (judul+✕) + body + footer (Reset kiri, Close kanan); handler Reset/Close dipasang di sini.
function ieShell(def,body){
  indEditorEl.setAttribute('aria-label',def.label+' settings');
  indEditorEl.innerHTML=`<div class="dm-head"><span class="dm-title">${def.label}</span><button class="dm-x" title="Close" aria-label="Close">✕</button></div>`
    +`<div class="dm-body">${body}</div><div class="dm-foot"><button class="dm-ghost ie-reset">Reset to default</button><button class="dm-close">Close</button></div>`;
  indEditorEl.querySelector('.dm-x').onclick=indEditorEl.querySelector('.dm-close').onclick=closeIndEditor;
}
function renderIndEditor(){
  const name=indEditorName, def=indDef(name), p=def.params; const cp=(effParams(name)||[]).slice();
  if(p.kind==='controls'){
    // skema heterogen (select/number/bool) → kelas .ie-ctrl (BUKAN .ie-num) supaya tak kesedot
    // handler numerik generik di bawah (yg asumsikan array numerik homogen utk MA/EMA/dst).
    const rows=p.controls.map((c,i)=>{
      const v=cp[i]!=null?cp[i]:c.def;
      if(c.type==='select'){
        const opts=c.options.map((o,oi)=>`<option value="${oi}"${oi===v?' selected':''}>${o}</option>`).join('');
        return `<div class="pp-lbl">${c.label}</div><div class="pp-row"><select class="ie-ctrl" data-i="${i}">${opts}</select></div>`;
      }
      if(c.type==='bool'){
        return `<div class="pp-row ie-boolrow"><label><input type="checkbox" class="ie-ctrl" data-i="${i}"${v?' checked':''}> ${c.label}</label></div>`;
      }
      return `<div class="pp-lbl">${c.label}</div><div class="pp-row"><input type="number" class="ie-ctrl" data-i="${i}" min="${c.min}" max="${c.max}" step="${c.step||1}" value="${v}"></div>`;
    }).join('');
    ieShell(def,rows);
    indEditorEl.querySelectorAll('.ie-ctrl').forEach(el=>{
      const i=+el.dataset.i, c=p.controls[i];
      if(c.type==='select'){
        el.onchange=()=>{ const cur=(effParams(name)||[]).slice(); cur[i]=+el.value; setIndParams(name,cur); };
      } else if(c.type==='bool'){
        el.onchange=()=>{ const cur=(effParams(name)||[]).slice(); cur[i]=el.checked?1:0; setIndParams(name,cur); };
      } else {
        let deb=null;
        el.oninput=()=>{ clearTimeout(deb); deb=setTimeout(()=>{
          if(name!==indEditorName) return;   // editor sudah ganti indikator sebelum timer fire
          const val=parseFloat(el.value); if(!isFinite(val)) return;   // input kosong/NaN → jangan terapkan
          const cur=(effParams(name)||[]).slice(); cur[i]=Math.min(c.max,Math.max(c.min,val)); setIndParams(name,cur);
        },150); };
      }
    });
    indEditorEl.querySelector('.ie-reset').onclick=()=>{ setIndParams(name, defParams(name)); renderIndEditor(); };
    return;
  }
  let body='';
  if(p.kind==='fixed'){
    body=p.fields.map((f,i)=>`<div class="pp-lbl">${f.label}</div><div class="pp-row"><input type="number" class="ie-num" data-i="${i}" min="${f.min}" max="${f.max}" step="${f.step||1}" value="${cp[i]!=null?cp[i]:f.def}"></div>`).join('');
  } else {
    const rows=cp.map((v,i)=>`<div class="pp-row ie-listrow"><input type="number" class="ie-num" data-i="${i}" min="${p.min}" max="${p.max}" step="${p.step||1}" value="${v}"><button class="ie-x" data-i="${i}" title="Remove"${cp.length<=1?' disabled':''}>×</button></div>`).join('');
    body=`<div class="pp-lbl">${p.label}</div>${rows}<div class="pp-row"><button class="ie-add">+ Add</button></div>`;
  }
  ieShell(def,body);
  const readNums=()=>[...indEditorEl.querySelectorAll('.ie-num')].map(inp=>parseFloat(inp.value));
  const clampField=(i,val)=>{ const f=(p.kind==='fixed')?p.fields[i]:p; return Math.min(f.max,Math.max(f.min,val)); };
  // basis array TERKINI dari input DOM (bukan closure cp yg basi setelah edit) → +Add/remove tak buang edit.
  // fallback ke nilai terakhir yg diterapkan bila ada input kosong/NaN.
  const curArr=()=>{ const a=readNums(); return a.some(v=>!isFinite(v)) ? (effParams(name)||[]).slice() : a.map((v,i)=>clampField(i,v)); };
  let deb=null;
  indEditorEl.querySelectorAll('.ie-num').forEach(inp=>inp.oninput=()=>{
    clearTimeout(deb); deb=setTimeout(()=>{
      if(name!==indEditorName) return;   // editor sudah ganti indikator sebelum timer fire → jangan tulis silang
      const arr=readNums(); if(arr.some(v=>!isFinite(v))) return;   // input kosong/NaN → jangan terapkan
      setIndParams(name, arr.map((v,i)=>clampField(i,v)));
    },150);
  });
  if(p.kind==='list'){
    indEditorEl.querySelectorAll('.ie-x').forEach(x=>x.onclick=()=>{ const arr=curArr(); if(arr.length<=1) return; arr.splice(+x.dataset.i,1); setIndParams(name,arr); renderIndEditor(); });
    const add=indEditorEl.querySelector('.ie-add'); if(add) add.onclick=()=>{ const arr=curArr(); arr.push(arr[arr.length-1]||p.def[0]||14); setIndParams(name,arr); renderIndEditor(); };
  }
  indEditorEl.querySelector('.ie-reset').onclick=()=>{ setIndParams(name, defParams(name)); renderIndEditor(); };
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && indEditorScrim&&indEditorScrim.classList.contains('show')) closeIndEditor(); });
// ===== modal Indicators (search + kategori) — pengganti dropdown ƒx lama =====
let indModalCat='All', indModalQ='';
function indCatOf(d){ return d.overlay?'Overlays':'Oscillators'; }
function openIndModal(){ const m=$('#indModal'); if(!m) return; m.hidden=false; renderIndModal();
  const s=$('#indSearch'); if(s){ s.value=indModalQ; setTimeout(()=>s.focus(),0); } }
function closeIndModal(){ const m=$('#indModal'); if(m) m.hidden=true; }
function renderIndModal(){
  const cats=['All','Overlays','Oscillators'];
  const cbox=$('#indCats'); if(cbox) cbox.innerHTML=cats.map(c=>`<div class="ind-cat${c===indModalCat?' on':''}" data-cat="${c}">${c}</div>`).join('');
  renderIndModalState();
  const cb=$('#indCats'); if(cb) cb.querySelectorAll('.ind-cat').forEach(el=>el.onclick=()=>{ indModalCat=el.dataset.cat; renderIndModal(); });
}
function renderIndModalState(){
  const list=$('#indList'); if(!list) return;
  const q=indModalQ.trim().toLowerCase();
  const items=IND_DEFS.filter(d=>{
    if(indModalCat!=='All' && indCatOf(d)!==indModalCat) return false;
    if(!q) return true;
    return (d.name+' '+d.label+' '+(d.desc||'')).toLowerCase().includes(q);
  });
  const qEsc=indModalQ.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));   // echo aman (hindari self-XSS)
  list.innerHTML = items.length ? items.map(d=>
    `<div class="ind-row${activeInd[d.name]?' on':''}" data-ind="${d.name}">`+
      `<div class="ind-row-main"><div class="ind-row-name">${d.label}</div>`+
      `<div class="ind-row-desc">${d.desc||''}</div></div>`+
      `<span class="ind-row-badge">Added &#10003;</span>`+
    `</div>`).join('') : `<div class="ind-empty">No indicators match "${qEsc}"</div>`;
  list.querySelectorAll('.ind-row').forEach(el=>el.onclick=()=>{
    const name=el.dataset.ind;
    if(activeInd[name]) removeInd(name); else addInd(name);
    persistInd(); updateIndBadge(); renderIndModalState();
    track('indicator',{name, on: !!activeInd[name]});
  });
}
savedInd().forEach(s=>{ if(s.calcParams) indParams[s.name]=s.calcParams.slice(); addInd(s.name);
  if(s.hidden && activeInd[s.name]){ hiddenInd[s.name]=true; try{ chart.overrideIndicator({name:s.name, visible:false}, activeInd[s.name]); }catch(e){} } });
updateIndBadge(); try{ renderIndLegends(); }catch(e){}   // pulihkan indikator tersimpan (termasuk status hidden)
(function(){
  const btn=$('#indBtn'), modal=$('#indModal'); if(!btn||!modal) return;
  btn.onclick=(e)=>{ e.stopPropagation(); openIndModal(); };
  const x=$('#indModalX'); if(x) x.onclick=closeIndModal;
  modal.addEventListener('mousedown',e=>{ if(e.target===modal) closeIndModal(); });   // klik backdrop
  const s=$('#indSearch'); if(s) s.oninput=()=>{ indModalQ=s.value; renderIndModalState(); };
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !modal.hidden) closeIndModal(); });
})();

