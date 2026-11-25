// ===================== setting objek gambar: modal Style/Text (double-click / klik-kanan) =====================
const PALETTE=['#ffffff','#4a71ff','#54c88c','#ff6f6f','#f5a623','#a78bfa','#22d3ee','#89898b'];
// objek yang mendukung teks (tab Text) & subset yang menghormati alignment saat render
const DM_LINE_TEXT=Object.keys(LINE_TEXT);   // garis bertekst (js/draw-text-style.js)
const DM_BOX_TEXT=Object.keys(BOX_TEXT);     // bentuk bertekst di dalam kotak pembatas (rect/circle/ellipse)
const DM_TEXT_OBJS=new Set(['text','callout','trendline',...DM_BOX_TEXT,...DM_LINE_TEXT]);
const DM_ALIGN_OBJS=new Set(['text','trendline',...DM_BOX_TEXT,...DM_LINE_TEXT]);   // callout selalu kiri-atas → tanpa chip align
const ADDTEXT_CLICK=new Set(['rect','trendline','callout']);   // klik saat kosong → langsung tambah teks (undangan "+ Add text" di canvas)
// judul objek utk header modal (diambil dari daftar tool; definisi belakang menang → arrow=shape)
const OBJ_TITLE=(()=>{ const m={}; try{ DRAW_GROUPS.forEach(g=>g.tools.forEach(t=>{ m[t.name]=t.title; })); }catch(e){} return m; })();
// ikon tipe objek utk header modal (SVG dari daftar tool → header memberi tahu objek apa yg diedit)
const OBJ_ICON=(()=>{ const m={}; try{ DRAW_GROUPS.forEach(g=>g.tools.forEach(t=>{ if(t.svg) m[t.name]=t.svg; })); }catch(e){} return m; })();
// TRASH_SVG sudah didefinisikan di rail drawing (dipakai ulang utk tombol Delete modal)
function dmEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// modal terpusat: satu instance, isi dibangun ulang per objek
const drawModal=document.createElement('div'); drawModal.className='dmodal-scrim';
drawModal.innerHTML='<div class="dmodal" role="dialog" aria-modal="true"></div>';
document.body.appendChild(drawModal);
let dmTarget=null;
drawModal.addEventListener('mousedown',e=>{ if(e.target===drawModal) closeDrawModal(); });   // klik scrim = tutup
function closeDrawModal(){
  if(!drawModal.classList.contains('show')) return;
  const o=dmTarget; dmTarget=null;
  drawModal.classList.remove('show');
  // 'text' kosong = tak bermakna → hapus objeknya (mirror perilaku editor lama)
  if(o){ try{ const ov=chart.getOverlayById(o.id);
    if(ov && o.name==='text' && (ov.extendData==null||String(ov.extendData).trim()==='')) chart.removeOverlay(o.id); }catch(e){} }
  scheduleSaveDraws();
}
// dispatcher: semua objek (termasuk long/short) kini memakai modal yang sama; isi tab-nya yang beda
function openObjSettings(o, cx, cy, tab){
  if(!o||DRAW_DEFAULT[o.name]===undefined) return;
  openDrawModal(o, tab);
}
const POS_OBJS=new Set(['longPosition','shortPosition']);
// bentuk tertutup ber-fill (shapeFill, js/overlays-custom.js): bagian Background di tab Style
const FILL_OBJS=new Set(['rect','circle','ellipse','callout','parallelStraightLine','priceChannelLine']);
function fillHTML(st){
  const cur=(st.fillColor||'#4a71ff').toLowerCase(), alpha=st.fillAlpha!=null?st.fillAlpha:10, inList=PALETTE.includes(cur);
  const sw=PALETTE.map(c=>`<button class="sw ${cur===c?'on':''}" data-fcol="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  return `<div class="pp-lbl">Background</div>`
    +`<div class="pp-row">${sw}<label class="sw sw-custom ${inList?'':'on'}" title="Custom color"><input type="color" data-fcol-in value="${cur}" aria-label="Custom background color"></label></div>`
    +`<div class="dm-slider"><span>Opacity</span><input type="range" data-falpha min="0" max="100" value="${alpha}" aria-label="Background opacity"><span class="dm-sval">${alpha}%</span></div>`;
}
function wireFill(panel, o){
  const off=()=>panel.querySelectorAll('[data-fcol], [data-fcol-in]').forEach(x=>(x.closest('.sw')||x).classList.remove('on'));
  const r=panel.querySelector('[data-falpha]');
  // channel default tanpa isi (alpha 0): memilih warna pada alpha 0 = jelas ingin tampak → naikkan ke 20%
  const setCol=c=>{ const p={fillColor:c}; if(!(+dstyle(o).fillAlpha>0)){ p.fillAlpha=20; if(r){ r.value=20; r.parentElement.querySelector('.dm-sval').textContent='20%'; } } setObjStyle(o.id,p); };
  panel.querySelectorAll('[data-fcol]').forEach(b=>b.onclick=()=>{ setCol(b.dataset.fcol); off(); b.classList.add('on'); });
  const ci=panel.querySelector('[data-fcol-in]');
  if(ci) ci.oninput=()=>{ setCol(ci.value); off(); ci.closest('.sw').classList.add('on'); };
  if(r) r.oninput=()=>{ r.parentElement.querySelector('.dm-sval').textContent=r.value+'%'; setObjStyle(o.id,{fillAlpha:+r.value}); };
}
// swatch zona Profit & Stop: default TradingView-ish di urutan pertama, sisanya turunan palet Luna
const POS_TGT_COLORS=['#089981','#54c88c','#22d3ee','#4a71ff','#a78bfa','#f5a623'];
const POS_STOP_COLORS=['#f23645','#ff6f6f','#f5a623','#a78bfa','#89898b','#ffffff'];
// satu zona (Profit/Stop): swatch warna + slider transparansi. kind: 'tgt' | 'stop'
function posZoneHTML(st, kind){
  const tgt=kind==='tgt', key=tgt?'tgtColor':'stopColor', akey=tgt?'tgtAlpha':'stopAlpha';
  const cur=(st[key]||(tgt?'#089981':'#f23645')).toLowerCase();
  const alpha=st[akey]!=null?st[akey]:12;
  const list=tgt?POS_TGT_COLORS:POS_STOP_COLORS, inList=list.includes(cur);
  const sw=list.map(c=>`<button class="sw ${cur===c?'on':''}" data-pcol="${kind}" data-pc="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  return `<div class="pp-lbl">${tgt?'Profit zone':'Stop zone'}</div>`
    +`<div class="pp-row">${sw}<label class="sw sw-custom ${inList?'':'on'}" title="Custom color"><input type="color" data-pcol-in="${kind}" value="${cur}" aria-label="Custom color"></label></div>`
    +`<div class="dm-slider"><span>Opacity</span><input type="range" data-palpha="${kind}" min="0" max="100" value="${alpha}" aria-label="${tgt?'Profit':'Stop'} zone opacity"><span class="dm-sval">${alpha}%</span></div>`;
}
function posStylePaneHTML(o){
  const st=dstyle(o);
  return `<div class="dm-pane" data-pane="style">${posZoneHTML(st,'tgt')}<div class="dm-gap"></div>${posZoneHTML(st,'stop')}</div>`;
}
// tab Inputs (key internal 'levels'): akun/risiko per objek + Entry/TP/SL ala TradingView
// (js/draw-position-inputs.js). Semua field type=text (jebakan locale input number, lihat draw-coords.js).
function posInputsPaneHTML(o){
  if(!posLevels(o)) return '';
  const inp=(id,label,w)=>`<span class="dm-co-f"${w?` style="flex:0 0 ${w}px"`:''}><input class="dm-co" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="${id}" aria-label="${label}"></span>`;
  const row=(label,body)=>`<div class="pp-lbl">${label}</div><div class="dm-co-row">${body}</div>`;
  const tp2=(k,label)=>row(label,`<span class="dm-co-x">Ticks</span>${inp('pp'+k+'Ticks',label+' ticks')}<span class="dm-co-x">Price</span>${inp('pp'+k,label+' price')}`);
  return `<div class="dm-pane dm-pos-in" data-pane="levels">`
    +row('Account size',inp('ppAcc','Account size'))
    +row('Lot size',inp('ppLot','Lot size'))
    +row('Risk',inp('ppRisk','Risk')+`<select class="dm-co dm-co-sel" id="ppRiskUnit" aria-label="Risk unit"><option value="%">%</option><option value="USD">USD</option></select>`)
    +row('Entry price',inp('ppEntry','Entry price'))
    +tp2('Tp','Profit level')+tp2('Sl','Stop level')
    +row('Qty precision',inp('ppQtyPrec','Qty precision'))
    +`<div class="dm-co-qty" id="ppQty"></div></div>`;
}
function wirePosPanes(panel, o){
  const kinds={tgt:['tgtColor','tgtAlpha'],stop:['stopColor','stopAlpha']};
  panel.querySelectorAll('[data-pcol]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.pcol; setObjStyle(o.id,{[kinds[k][0]]:b.dataset.pc});
    panel.querySelectorAll(`[data-pcol="${k}"], [data-pcol-in="${k}"]`).forEach(x=>(x.closest('.sw')||x).classList.remove('on')); b.classList.add('on'); });
  panel.querySelectorAll('[data-pcol-in]').forEach(i=>i.oninput=()=>{
    const k=i.dataset.pcolIn; setObjStyle(o.id,{[kinds[k][0]]:i.value});
    panel.querySelectorAll(`[data-pcol="${k}"]`).forEach(x=>x.classList.remove('on')); i.closest('.sw').classList.add('on'); });
  panel.querySelectorAll('[data-palpha]').forEach(r=>r.oninput=()=>{
    r.parentElement.querySelector('.dm-sval').textContent=r.value+'%'; setObjStyle(o.id,{[kinds[r.dataset.palpha][1]]:+r.value}); });
  wirePosInputs(panel, o);
}
// Enter / blur = tulis. Tak valid → field merah & kembali ke nilai objek; objek tak bergerak.
// Sukses → SEMUA field disegarkan (ticks↔price, Qty ikut berubah).
function wirePosInputs(panel, o){
  if(!panel.querySelector('#ppAcc')) return;
  const num=v=>String(+(+v).toFixed(8));
  const int=t=>{ const n=parseCoordNum(t); return Number.isInteger(n)?n:NaN; };
  const F={
    '#ppAcc':    [()=>num(posSettings(o).account), t=>setPosSettings(o,{account:parseCoordNum(t)})],
    '#ppLot':    [()=>num(posSettings(o).lot),     t=>setPosSettings(o,{lot:parseCoordNum(t)})],
    '#ppRisk':   [()=>num(posSettings(o).risk),    t=>setPosSettings(o,{risk:parseCoordNum(t)})],
    '#ppEntry':  [()=>coordPriceText(posLevels(o).entry), t=>applyPosEntry(o,parseCoordNum(t))],
    '#ppTpTicks':[()=>String(posCalc(o).tpTicks),  t=>applyPosTicks(o,'tp',int(t))],
    '#ppTp':     [()=>coordPriceText(posLevels(o).tp), t=>applyPosLevel(o,'tp',parseCoordNum(t))],
    '#ppSlTicks':[()=>String(posCalc(o).slTicks),  t=>applyPosTicks(o,'sl',int(t))],
    '#ppSl':     [()=>coordPriceText(posLevels(o).sl), t=>applyPosLevel(o,'sl',parseCoordNum(t))],
    '#ppQtyPrec':[()=>String(posSettings(o).qtyPrec), t=>setPosSettings(o,{qtyPrec:int(t)})],
  };
  const unit=panel.querySelector('#ppRiskUnit'), qty=panel.querySelector('#ppQty');
  const refresh=()=>{
    if(!posLevels(o)) return;
    Object.keys(F).forEach(sel=>{ const i=panel.querySelector(sel); if(i){ const t=F[sel][0](); i.value=t; i.dataset.base=t; } });
    const s=posSettings(o), c=posCalc(o);
    unit.value=s.riskUnit;
    if(c) qty.textContent=`Qty ${c.qtyLots.toFixed(s.qtyPrec)} ${s.lot===1?'units':'lot'}`;
  };
  Object.keys(F).forEach(sel=>{
    const inp=panel.querySelector(sel); if(!inp) return;
    const commit=()=>{
      if(inp.value===inp.dataset.base) return;
      const ok=F[sel][1](inp.value);
      if(ok){ inp.classList.remove('bad'); scheduleSaveDraws(); } else inp.classList.add('bad');
      refresh();
    };
    inp.oninput=()=>inp.classList.remove('bad');
    inp.onkeydown=e=>{ if(e.key!=='Escape') e.stopPropagation();   // hotkey chart (digit→interval, Delete) tak boleh ikut; Esc tetap menutup modal
      if(e.key==='Enter'){ e.preventDefault(); commit(); } };
    inp.onblur=commit;
  });
  // ganti satuan risk → angka dikonversi supaya nominal USD-nya tetap
  unit.onchange=()=>{
    const s=posSettings(o), to=unit.value;
    setPosSettings(o,{risk:convertRisk(s.risk,s.riskUnit,to,s.account), riskUnit:to});
    refresh();
  };
  unit.onkeydown=e=>{ if(e.key!=='Escape') e.stopPropagation(); };
  refresh();
}
function openDrawModal(o, tab){
  if(!o||DRAW_DEFAULT[o.name]===undefined) return;
  const name=o.name, st=dstyle(o), isFib=(name==='fib3');
  const hasText=DM_TEXT_OBJS.has(name), hasAlign=DM_ALIGN_OBJS.has(name);
  const hasAlert=ALERTABLE.has(name), isPos=POS_OBJS.has(name);
  // objek 'text': teks ADALAH objeknya → tak ada garis utk di-style; warna/ukuran ada di tab Text
  // (dulu chip Thickness 1–4px di tab Style menulis `size` = ukuran font → teks mikroskopis)
  const hasStyle=(name!=='text');
  const coordsPane=isPos?posInputsPaneHTML(o):coordsPaneHTML(o), hasCoords=!!coordsPane;   // js/draw-coords.js (posisi: tab Inputs)
  const coordsTab=isPos?'levels':'coords', coordsLabel=isPos?'Inputs':'Coordinates';
  const active=(tab==='text'&&hasText)?'text':((tab==='coords'||tab==='levels')&&hasCoords)?coordsTab:(tab==='alert'&&hasAlert)?'alert':hasStyle?'style':'text';
  const cols=PALETTE.map(c=>`<button class="sw ${st.color===c?'on':''}" data-col="${c}" style="background:${c}"></button>`).join('');
  const ws=[1,2,3,4].map(w=>`<button class="pp-chip ${(+st.size)===w?'on':''}" data-w="${w}">${w}px</button>`).join('');
  const ss=[['solid','Solid'],['dashed','Dash'],['dotted','Dot']].map(p=>`<button class="pp-chip ${st.style===p[0]?'on':''}" data-st="${p[0]}">${p[1]}</button>`).join('');
  const stylePane=!hasStyle?'':isPos?posStylePaneHTML(o):`<div class="dm-pane" data-pane="style">`
    +(isFib?'':`<div class="pp-lbl">Color</div><div class="pp-row">${cols}</div>`)
    +`<div class="pp-lbl">Thickness</div><div class="pp-row">${ws}</div>`
    +`<div class="pp-lbl">Line style</div><div class="pp-row">${ss}</div>`
    +(FILL_OBJS.has(name)?fillHTML(st):'')
    +(isFib?`<div class="pp-row" style="margin-top:2px"><button class="pp-chip" id="dmFib">⚙ Level &amp; Color</button></div>`:'')
    +`</div>`;
  let textPane='';
  if(hasText){
    const talign=st.textAlign||(DRAW_DEFAULT[name]&&DRAW_DEFAULT[name].textAlign)||'center';
    const tvalign=st.textValign||(DRAW_DEFAULT[name]&&DRAW_DEFAULT[name].textValign)||'middle';
    const has=[['left','Left'],['center','Center'],['right','Right']].map(p=>`<button class="pp-chip ${talign===p[0]?'on':''}" data-ha="${p[0]}">${p[1]}</button>`).join('');
    const vas=[['top','Top'],['middle','Middle'],['bottom','Bottom']].map(p=>`<button class="pp-chip ${tvalign===p[0]?'on':''}" data-va="${p[0]}">${p[1]}</button>`).join('');
    textPane=`<div class="dm-pane" data-pane="text"><textarea class="dm-ta" placeholder="Add text">${dmEsc(o.extendData)}</textarea>`
      +textStylePaneHTML(o)
      +(hasAlign?`<div class="pp-lbl">Horizontal</div><div class="pp-row">${has}</div><div class="pp-lbl">Vertical</div><div class="pp-row">${vas}</div>`:'')
      +`</div>`;
  }
  const alertPane=hasAlert?alertPaneHTML(o):'';
  const panel=drawModal.querySelector('.dmodal');
  panel.innerHTML=`<div class="dm-head">${OBJ_ICON[name]?`<span class="dm-ico">${OBJ_ICON[name]}</span>`:''}<span class="dm-title">${dmEsc(OBJ_TITLE[name]||name)}</span><button class="dm-x" title="Close" aria-label="Close">✕</button></div>`
    +`<div class="dm-tabs">${hasStyle?`<button class="dm-tab" data-tab="style">Style</button>`:''}${hasText?`<button class="dm-tab" data-tab="text">Text</button>`:''}${hasCoords?`<button class="dm-tab" data-tab="${coordsTab}">${coordsLabel}</button>`:''}${hasAlert?`<button class="dm-tab" data-tab="alert">Alert</button>`:''}</div>`
    +`<div class="dm-body">${stylePane}${textPane}${coordsPane}${alertPane}</div>`
    +`<div class="dm-foot"><button class="dm-lock"></button><button class="dm-del">${TRASH_SVG}<span>Delete</span></button><button class="dm-close">Close</button></div>`;
  const mark=(sel,el)=>{ panel.querySelectorAll(sel).forEach(x=>x.classList.remove('on')); el.classList.add('on'); };
  const dmSwitch=(t)=>{ panel.querySelectorAll('.dm-tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
    panel.querySelectorAll('.dm-pane').forEach(p=>{ p.hidden=(p.dataset.pane!==t); }); };
  panel.querySelectorAll('.dm-tab').forEach(b=>b.onclick=()=>dmSwitch(b.dataset.tab));
  if(hasAlert) wireAlertPane(panel, o);
  if(isPos) wirePosPanes(panel, o); else if(hasCoords) wireCoordsPane(panel, o);
  panel.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{color:b.dataset.col}); mark('[data-col]',b); });
  panel.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{size:+b.dataset.w}); mark('[data-w]',b); });
  panel.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{style:b.dataset.st}); mark('[data-st]',b); });
  panel.querySelectorAll('[data-ha]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textAlign:b.dataset.ha}); mark('[data-ha]',b); });
  panel.querySelectorAll('[data-va]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textValign:b.dataset.va}); mark('[data-va]',b); });
  if(hasText) wireTextStylePane(panel, o);
  if(FILL_OBJS.has(name)) wireFill(panel, o);
  const ta=panel.querySelector('.dm-ta');
  if(ta) ta.addEventListener('input',()=>{ try{chart.overrideOverlay({id:o.id,extendData:ta.value});}catch(e){} });   // live update di canvas
  const fb=panel.querySelector('#dmFib'); if(fb) fb.onclick=()=>{ closeDrawModal(); showFibPop(); };
  panel.querySelector('.dm-del').onclick=()=>{ const id=o.id; dmTarget=null; closeDrawModal(); try{chart.removeOverlay(id);}catch(e){} };
  // Lock objek: terkunci = tak bisa digeser & tak bisa terhapus (js/draw-lock.js). Delete dimatikan
  // selama terkunci supaya "buka kunci" jadi langkah sadar, bukan klik yang sama dua kali.
  const lockBtn=panel.querySelector('.dm-lock');
  const syncLock=()=>{ const on=isLocked(o.id);
    lockBtn.textContent = on?'Unlock':'Lock';
    lockBtn.classList.toggle('on',on);
    const del=panel.querySelector('.dm-del');
    del.disabled=on; del.title = on?'Unlock to delete':'';
    // Koordinat ikut mati saat terkunci: menggeser objek lewat angka sama saja dengan menyeretnya.
    panel.querySelectorAll('.dm-pane[data-pane="coords"] input.dm-co, .dm-pane[data-pane="coords"] button.dm-co-st, .dm-pane[data-pane="levels"] .dm-co')
      .forEach(el=>{ el.disabled=on; });
  };
  lockBtn.onclick=()=>{ toggleDrawLock(o.id); syncLock(); };
  syncLock();
  panel.querySelector('.dm-close').onclick=closeDrawModal;
  panel.querySelector('.dm-x').onclick=closeDrawModal;
  dmTarget=o;
  drawModal.classList.add('show');
  // tinggi konsisten antar-tab: samakan min-height tiap pane ke pane tertinggi
  // (di-set per-pane, bukan body, agar tak terpengaruh padding body saat box-sizing:border-box)
  try{ const panes=[...panel.querySelectorAll('.dm-pane')]; let maxH=0;
    panes.forEach(p=>{ const h0=p.hidden; p.hidden=false; p.style.minHeight=''; maxH=Math.max(maxH,p.offsetHeight); p.hidden=h0; });
    if(maxH) panes.forEach(p=>{ p.style.minHeight=maxH+'px'; }); }catch(e){}
  dmSwitch(active);
  if(active==='text'&&ta){ ta.focus(); const L=ta.value.length; try{ta.setSelectionRange(L,L);}catch(e){} }
}
// ===================== editor level Fibonacci (tambah/hapus/ubah nilai) =====================
// modal gaya .dmodal (scrim "live": tanpa blur supaya efek level ke chart terlihat). fibPop = scrim; Esc via handler di bawah.
const fibPop=document.createElement('div'); fibPop.className='dmodal-scrim live';
fibPop.innerHTML='<div class="dmodal fib-modal" role="dialog" aria-modal="true" aria-label="Fibonacci levels"></div>';
document.body.appendChild(fibPop);
fibPop.addEventListener('mousedown',e=>{ if(e.target===fibPop) hideFibPop(); });
function showFibPop(){
  const panel=fibPop.querySelector('.dmodal');
  const rows=fibLevels.map((lv,i)=>`<div class="fp-row"><input type="color" class="fp-color" value="${lv.color||fibColor(lv.value,i)}" data-ci="${i}" title="Level color" aria-label="Level color"><input type="number" step="0.001" value="${lv.value}" data-i="${i}" aria-label="Level value"><button class="fp-x" data-i="${i}" title="Delete level" aria-label="Delete level">✕</button></div>`).join('');
  panel.innerHTML=`<div class="dm-head"><span class="dm-title">Fibonacci levels</span><button class="dm-x" title="Close" aria-label="Close">✕</button></div>`
    +`<div class="dm-body"><div class="pp-lbl">Levels</div><div class="fp-list">${rows}</div><button class="fp-add" id="fpAdd">+ Add level</button>`
    +`<div class="pp-lbl fp-gap">Background</div><div class="fp-bg"><label><input type="checkbox" id="fpBgOn"${fibBg.on?' checked':''}> Fill between levels</label>`
    +`<input type="range" id="fpBgOp" min="0" max="100" value="${fibBg.opacity}"${fibBg.on?'':' disabled'}><span id="fpBgVal">${fibBg.opacity}%</span></div></div>`
    +`<div class="dm-foot"><button class="dm-ghost" id="fpReset">Reset to default</button><button class="dm-close">Close</button></div>`;
  fibPop.classList.add('show');
  panel.querySelector('.dm-x').onclick=panel.querySelector('.dm-close').onclick=hideFibPop;
  panel.querySelectorAll('input[data-i]').forEach(inp=>inp.onchange=()=>{ const v=parseFloat(inp.value); if(!isNaN(v)){ fibLevels[+inp.dataset.i].value=v; saveFibLevels(); } });
  panel.querySelectorAll('input[data-ci]').forEach(inp=>inp.oninput=()=>{ fibLevels[+inp.dataset.ci].color=inp.value; saveFibLevels(); });
  panel.querySelectorAll('.fp-x').forEach(b=>b.onclick=()=>{ fibLevels.splice(+b.dataset.i,1); if(!fibLevels.length) fibLevels=[{value:0,color:fibColor(0,0)}]; saveFibLevels(); showFibPop(); });
  const bgOn=panel.querySelector('#fpBgOn'), bgOp=panel.querySelector('#fpBgOp'), bgVal=panel.querySelector('#fpBgVal');
  bgOn.onchange=()=>{ fibBg.on=bgOn.checked; bgOp.disabled=!fibBg.on; saveFibBg(); };
  bgOp.oninput=()=>{ fibBg.opacity=+bgOp.value; bgVal.textContent=fibBg.opacity+'%'; saveFibBg(); };
  panel.querySelector('#fpAdd').onclick=()=>{ fibLevels.push({value:0.618,color:fibColor(0.618,fibLevels.length)}); saveFibLevels(); showFibPop(); };
  panel.querySelector('#fpReset').onclick=()=>{ fibLevels=defaultFibLevels(); saveFibLevels(); showFibPop(); };
}
function hideFibPop(){ fibPop.classList.remove('show'); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeDrawModal(); hideFibPop(); chartSet.classList.remove('show'); } });

