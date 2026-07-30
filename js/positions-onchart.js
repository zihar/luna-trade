// ===== garis + pill posisi PAPER on-chart (per posisi, instrumen aktif) =====
// garis = overlay klinecharts (tradeLevel, warna candle POS_GREEN/POS_RED); pill/label/tombol = node DOM di #posLayer.
// Node DOM disinkronkan posisi-Y-nya oleh createPointFigures overlay (auto ikut pan/zoom/drag).
let paperLines={};   // posId -> {entry,sl,tp}  (id overlay garis)
let posDom={};       // posId -> {entry,sl,tp}  (elemen DOM)
let posLayerEl=null;
function posById(id){ return currentPositions().find(x=>x.id===id); }
// Sumber posisi on-chart terpadu: Live → SP.positions; Replay → trades (dibungkus jadi posisi).
// id replay NEGATIF (-1,-2,…); id Live berasal dari rowid SQLite → selalu ≥1, jadi tandanya
// cukup sebagai diskriminator (menggantikan sentinel REPLAY_ID lama).
function isReplayId(id){ return id<0; }
function tradeById(id){ return trades.find(t=>t.id===id)||null; }
function replayPosView(t){
  const cur=currentCandle(), mid=cur?cur.close:t.entry, price=replayMarkPx(t.dir,mid), units=t.units||0;
  return { id:t.id, no:t.no, src:'replay', instrument:t.instrument||inst,
    dir:t.dir, units, entry:t.entry, price, sl:t.sl, tp:t.tp,
    unrealizedPl: pnlUsd(t.dir,t.entry,price,units),
    margin: units*t.entry*quoteToUsd(t.entry)/100 };
}
function currentPositions(){ return spActive() ? (SP.positions||[]) : trades.map(replayPosView); }
function posPnlStr(v){ return (v>=0?'+':'-')+'$'+Math.abs(+v||0).toFixed(2); }
function posLayer(){
  const host=document.getElementById('chart');
  if(posLayerEl && posLayerEl.parentNode===host) return posLayerEl;
  posLayerEl=document.createElement('div'); posLayerEl.id='posLayer';
  posLayerEl.addEventListener('click', onPosLayerClick);
  posLayerEl.addEventListener('mousedown', onPosLevelDragStart);
  if(host) host.appendChild(posLayerEl); posDom={};   // host baru → node lama tak valid
  return posLayerEl;
}
function ensurePosNodes(id){
  let rec=posDom[id]; if(rec && rec.entry.parentNode) return rec;
  const layer=posLayer();
  const mk=kind=>{ const el=document.createElement('div'); el.className='pos-node '+kind; el.dataset.pid=id; el.dataset.active='0'; el.style.display='none'; layer.appendChild(el); return el; };
  return posDom[id]={ entry:mk('entry'), sl:mk('sl'), tp:mk('tp') };
}
function removePosNodes(id){ const rec=posDom[id]; if(!rec) return; ['entry','sl','tp'].forEach(k=>{ if(rec[k]&&rec[k].parentNode) rec[k].parentNode.removeChild(rec[k]); }); delete posDom[id]; }
// dipanggil dari createPointFigures overlay tiap repaint → tempatkan node di y garis; sembunyikan bila di luar pane
function syncPosNodeY(id,kind,y,h){ const rec=posDom[id]; if(!rec||!rec[kind]) return; const el=rec[kind];
  const on = el.dataset.active==='1' && y!=null && y>=-6 && (h==null||y<=h+6);
  el.style.display = on?'':'none'; if(on) el.style.top=y+'px';
}
// warna garis (teks kini di DOM)
function posLineInfo(p,kind){
  if(kind==='entry'){ const pnl=+p.unrealizedPl||0; return {lineColor:'#4a71ff', color:pnl>=0?POS_GREEN:POS_RED}; }
  if(kind==='sl') return {lineColor:POS_RED, color:POS_RED};
  return {lineColor:POS_GREEN, color:POS_GREEN};
}
function posExtend(p,kind){ const i=posLineInfo(p,kind); return {posId:p.id,kind,color:i.color,lineColor:i.lineColor}; }
// dampak $/% level SL/TP utk label expanded
function posLvlImpact(p,kind,val){
  const bal=+$('#balance').value||0, units=p.units||0, dec=decimalsFor(p.instrument);
  const v=val!=null?val:p[kind], amt=Math.abs(pnlUsd(p.dir,p.entry,v,units)), pct=bal?amt/bal*100:0, s=kind==='sl'?'-':'';
  return { price:(+v).toFixed(dec), usd:s+'$'+amt.toFixed(2), pct:s+pct.toFixed(2)+'%' };
}
// isi konten node DOM (collapsed vs expanded) berdasarkan state server + editPos bila sedang diedit
function renderPosDom(p){
  if(!p) return; const rec=ensurePosNodes(p.id);
  const editing = editingPosId===p.id, ep = editing?editPos:null;
  const pnl=+p.unrealizedPl||0, isSell=p.dir==='short';
  let chips='';
  if(ep){ if(!ep.slOn) chips+=`<button class="pos-add sl" data-add="sl">+ SL</button>`;
          if(!ep.tpOn) chips+=`<button class="pos-add tp" data-add="tp">+ TP</button>`; }
  rec.entry.innerHTML =
    `<span class="pos-pill ${pnl>=0?'up':'down'}" data-open="1" title="Kelola posisi">`+
      `<span class="pos-arrow">${isSell?'▼':'▲'}</span><span class="pos-pnl">${posPnlStr(pnl)}</span>`+
      `<button class="pos-x" data-close="1" title="Close position">×</button></span>`+chips;
  rec.entry.dataset.active='1';
  ['sl','tp'].forEach(k=>{
    if(!editing && pendingLevel && pendingLevel.id===p.id && pendingLevel.kind===k) return;  // preview drag menunggu konfirmasi → jangan timpa
    const active = ep ? !!ep[k+'On'] : (p[k]!=null);
    if(!active){ rec[k].dataset.active='0'; rec[k].style.display='none'; rec[k].innerHTML=''; return; }
    if(editing){ const im=posLvlImpact({dir:p.dir,entry:p.entry,units:p.units,instrument:p.instrument,sl:ep.sl,tp:ep.tp},k);
      rec[k].innerHTML=`<span class="pos-tag"><span class="grip">⋮⋮</span>${k.toUpperCase()} ${im.usd} / ${im.pct}`+
        `<button class="pos-x" data-del="${k}" title="Remove ${k.toUpperCase()}">×</button></span>`;
    } else { rec[k].innerHTML=`<span class="pos-tag">${k.toUpperCase()}</span>`; }
    rec[k].dataset.active='1';
  });
}
function onPosLayerClick(e){
  const node=e.target.closest('.pos-node'); if(!node) return; const id=+node.dataset.pid;
  if(e.target.closest('[data-close]')){ e.stopPropagation(); confirmClosePos(id,e.target); return; }
  const del=e.target.closest('[data-del]'); if(del){ e.stopPropagation(); stageLevel(id,del.getAttribute('data-del'),false); return; }
  const add=e.target.closest('[data-add]'); if(add){ e.stopPropagation(); stageLevel(id,add.getAttribute('data-add'),true); return; }
  if(e.target.closest('[data-open]')){ openPositionEditor(id); }
}
// hapus/tambah level = staged (butuh Confirm panel); pastikan editor terbuka utk posisi ini
function stageLevel(id,k,on){ if(editingPosId!==id) openPositionEditor(id); if(!editPos) return;
  editPos[k+'On']=on; drawStagedLines(); renderPosEdit(); renderPosDom(posById(id)); }
let posConfirmEl=null;
function miniConfirm(msg,yesLabel,onYes,onNo,anchor){
  if(!posConfirmEl){ posConfirmEl=document.createElement('div'); posConfirmEl.className='objpop pos-confirm'; document.body.appendChild(posConfirmEl); makeDraggable(posConfirmEl,'.pp-grip'); }
  posConfirmEl.innerHTML=GRIP+`<div class="pc-msg">${msg}</div><div class="pc-act"><button class="pc-no">Cancel</button><button class="pc-yes">${yesLabel}</button></div>`;
  const hide=()=>posConfirmEl.classList.remove('show');
  posConfirmEl.querySelector('.pc-no').onclick=()=>{ hide(); if(onNo) onNo(); };
  posConfirmEl.querySelector('.pc-yes').onclick=()=>{ hide(); if(onYes) onYes(); };
  const r=anchor?anchor.getBoundingClientRect():null;
  posConfirmEl.style.left=Math.max(8,Math.min(r?r.left:lastPtr.x, innerWidth-190))+'px';
  posConfirmEl.style.top=((r?r.bottom:lastPtr.y)+6)+'px';
  posConfirmEl.classList.add('show');
}
function confirmClosePos(id,anchor){
  if(isReplayId(id)){ const t=tradeById(id); if(!t) return;
    miniConfirm('Close replay position?','Close',()=>{ const c=currentCandle();
      if(c) closeTrade(id, replayMarkPx(t.dir,c.close), c.timestamp); drawPaperLines(); },null,anchor); return; }
  miniConfirm(`Close position #${id}?`,'Close',()=>spClose(id),null,anchor);
}
// ---- drag SL/TP di view-mode: preview saat digeser, konfirmasi saat dilepas ----
let pendingLevel=null;   // {id,kind,v} — garis yg sedang menunggu konfirmasi (jangan di-reset spSync)
function previewPosLevel(id,kind,v){
  const rec=posDom[id], p=posById(id); if(!rec||!rec[kind]||!p) return;
  const im=posLvlImpact(p,kind,v);
  rec[kind].innerHTML=`<span class="pos-tag drag">${kind.toUpperCase()} ${im.usd} / ${im.pct}</span>`;
  rec[kind].dataset.active='1';
}
function savePosLevel(id,kind,v){
  const p=posById(id); if(!p) return;
  if(isReplayId(id)){ const t=tradeById(id); if(!t) return; t[kind]=+v; if(kind==='sl') recalcRisk(t);
    toast(kind.toUpperCase()+' updated','success'); drawPaperLines(); updateOpenTradeBox(); return; }
  const body={ id, sl: kind==='sl'?+v:(p.sl!=null?+p.sl:null), tp: kind==='tp'?+v:(p.tp!=null?+p.tp:null) };
  fetch('/api/position/sltp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(async r=>{ const d=await r.json().catch(()=>({}));
      if(!r.ok){ toast(d.error||'Could not update '+kind.toUpperCase(),'error'); drawPaperLines(); return; }
      toast(kind.toUpperCase()+' updated','success'); await spSync(); drawPaperLines(); })
    .catch(()=>{ toast('Could not connect to the server','error'); drawPaperLines(); });
}
function confirmPosLevel(id,kind,v){
  const p=posById(id); if(!p) return; const dec=decimalsFor(p.instrument);
  if(p[kind]!=null && (+v).toFixed(dec)===(+p[kind]).toFixed(dec)){ drawPaperLines(); return; }   // nilai tak berubah (mis. klik garis tanpa geser) → jangan munculkan konfirmasi
  pendingLevel={id,kind,v};
  const rec=posDom[id];
  miniConfirm(`Change ${kind.toUpperCase()} to ${(+v).toFixed(dec)}?`,'Save',
    ()=>{ pendingLevel=null; savePosLevel(id,kind,v); },
    ()=>{ pendingLevel=null; drawPaperLines(); },
    rec&&rec[kind]);
}
// ---- drag label SL/TP berbasis DOM (gagang besar, mudah ditarik) → geser garis + preview, konfirmasi saat lepas ----
let posLevelDrag=null;   // {id,kind,startY,moved}
function priceFromClientY(clientY){
  const chEl=document.getElementById('chart'); if(!chEl) return null;
  const y=clientY-chEl.getBoundingClientRect().top;
  let cv=chart.convertFromPixel({x:60,y},{paneId:'candle_pane',absolute:true}); if(Array.isArray(cv)) cv=cv[0];
  return cv&&cv.value!=null ? cv.value : null;
}
function onPosLevelDragStart(e){
  if(e.button!==0) return;
  const node=e.target.closest('.pos-node.sl, .pos-node.tp'); if(!node) return;
  if(e.target.closest('.pos-x, .pos-add')) return;   // tombol → bukan drag
  if(node.classList.contains('draft')){   // chip draft tiket order → drag = ubah pips (sama mudahnya spt chip posisi)
    e.preventDefault();
    posLevelDrag={draft:true, kind:node.classList.contains('sl')?'sl':'tp', startY:e.clientY, moved:false};
    window.addEventListener('mousemove',onPosLevelDragMove);
    window.addEventListener('mouseup',onPosLevelDragEnd);
    return;
  }
  const id=+node.dataset.pid, kind=node.classList.contains('sl')?'sl':'tp';
  const editing=(editingPosId===id && !!editPos);   // panel Edit terbuka → drag = staged ke editPos (bukan mini-confirm)
  if(editing){ if(editPos[kind]==null || !editPos[kind+'On']) return; }   // level staged tak aktif → tak ada yg digeser
  else if(!(paperLines[id]&&paperLines[id][kind])) return;
  e.preventDefault();
  posLevelDrag={id,kind,startY:e.clientY,moved:false,editing};
  window.addEventListener('mousemove',onPosLevelDragMove);
  window.addEventListener('mouseup',onPosLevelDragEnd);
}
function onPosLevelDragMove(e){
  const d=posLevelDrag; if(!d) return;
  if(!d.moved && Math.abs(e.clientY-d.startY)<3) return;   // ambang kecil supaya klik biasa tetap = buka panel
  d.moved=true;
  const v=priceFromClientY(e.clientY); if(v==null||!(v>0)) return;
  if(d.draft){   // chip draft → hitung ticks dari entry pasar terkini, set pips (garis+chip auto-redraw)
    const ba=curBidAsk(), cur=currentCandle(), entry= ba?(orderDir==='short'?ba.bid:ba.ask):(cur?cur.close:null);
    if(entry==null) return;
    const pip=+$('#pipSize').value||instSpec().pip, ticks=Math.max(1, Math.round(Math.abs(v-entry)/pip));
    draftDragKind=d.kind; $(d.kind==='sl'?'#slPips':'#tpPips').value=ticks; renderOrderPanel(); try{renderSizing();}catch(_){}
    return;
  }
  const ov=paperLines[d.id]&&paperLines[d.id][d.kind];
  if(ov) try{chart.overrideOverlay({id:ov, points:[{value:v}], extendData:posExtend(d.editing?editPos:posById(d.id),d.kind)});}catch(_){}
  if(d.editing && editPos){ editPos[d.kind]=v; renderPosEdit(); try{renderPosDom(posById(d.id));}catch(_){}}   // staged: input panel + label ikut geser
  else { pendingLevel={id:d.id,kind:d.kind,v}; previewPosLevel(d.id,d.kind,v); }
}
function onPosLevelDragEnd(e){
  window.removeEventListener('mousemove',onPosLevelDragMove);
  window.removeEventListener('mouseup',onPosLevelDragEnd);
  const d=posLevelDrag; posLevelDrag=null; if(!d) return;
  if(d.draft){ draftDragKind=null; try{drawDraftLines();}catch(_){} return; }   // lepas → chip balik ke label ringkas
  if(d.editing){ return; }   // staged → disimpan lewat Confirm panel (tanpa mini-confirm)
  if(!d.moved){ openPositionEditor(d.id); return; }   // tak digeser → klik = buka panel
  const v=pendingLevel&&pendingLevel.v; if(v==null){ drawPaperLines(); return; }
  confirmPosLevel(d.id,d.kind,v);
}
function clearPaperLines(){ Object.values(paperLines).forEach(rec=>['entry','sl','tp'].forEach(k=>{ if(rec[k]){try{chart.removeOverlay(rec[k]);}catch(e){}} })); paperLines={}; Object.keys(posDom).forEach(id=>removePosNodes(+id)); }
// buat overlay garis posisi; SL/TP draggable (entry tidak). Drag = staged (butuh konfirmasi):
//  - panel Edit terbuka → stage ke editPos, simpan via Confirm panel
//  - view-mode → preview label saat digeser, konfirmasi mini saat dilepas
function posLevel(p,kind,draggable){
  const value = kind==='entry'?p.entry : kind==='sl'?p.sl : p.tp;
  if(kind==='entry'){
    // Entry: klik → editor. Drag hanya untuk posisi replay (id negatif) → geser
    // entry trade secara live tanpa konfirmasi (meniru perilaku lama tradeLevel entry).
    return chart.createOverlay({ name:'tradeLevel', points:[{value}], lock:!draggable, extendData:posExtend(p,kind),
      onClick:()=>{ openPositionEditor(p.id); return false; },
      onPressedMoving:(e)=>{ const t=tradeById(p.id); if(!t) return false;
        const v=e.overlay.points[0]&&e.overlay.points[0].value; if(v==null) return false;
        t.entry=v; try{renderPosDom(posById(p.id));}catch(_){} updateOpenTradeBox(); return false; },
    });
  }
  return chart.createOverlay({ name:'tradeLevel', points:[{value}], lock:!draggable,
    extendData:posExtend(p,kind),
    onClick:()=>{ openPositionEditor(p.id); return false; },
    onPressedMoving:(e)=>{ const v=e.overlay.points[0]&&e.overlay.points[0].value; if(v==null) return false;
      if(editingPosId===p.id && editPos){ editPos[kind]=v; renderPosEdit(); try{renderPosDom(posById(editingPosId));}catch(_){}} // panel: staged
      else { pendingLevel={id:p.id,kind,v}; previewPosLevel(p.id,kind,v); }   // view: preview (belum simpan) + lindungi garis dari refresh spSync tiap tick
      return false; },
    onPressedMoveEnd:(e)=>{ if(editingPosId===p.id) return false;   // panel yg simpan (Confirm)
      const v=e.overlay.points[0]&&e.overlay.points[0].value; if(v==null) return false;
      confirmPosLevel(p.id,kind,v); return false; },
  });
}
function drawPaperLines(){
  const cur=currentPositions().filter(p=>p.instrument===inst);
  const keep=new Set(cur.map(p=>p.id));
  if(pendingLevel && !keep.has(pendingLevel.id)) pendingLevel=null;
  Object.keys(paperLines).forEach(idStr=>{ if(!keep.has(+idStr)){ ['entry','sl','tp'].forEach(k=>{ if(paperLines[idStr][k]){try{chart.removeOverlay(paperLines[idStr][k]);}catch(e){}} }); delete paperLines[idStr]; removePosNodes(+idStr); if(+idStr===editingPosId) closePositionEditor(); } });
  cur.forEach(p=>{
    const rec=paperLines[p.id]||(paperLines[p.id]={entry:null,sl:null,tp:null});
    // entry (garis biru + pill P&L live di DOM)
    if(rec.entry) try{chart.overrideOverlay({id:rec.entry, points:[{value:p.entry}], extendData:posExtend(p,'entry')});}catch(e){}
    else rec.entry=posLevel(p,'entry', isReplayId(p.id));   // entry replay bisa di-drag; entry live tidak
    // posisi yg sedang diedit: garis SL/TP staged dikelola panel/drag → jangan disentuh; segarkan panel + node DOM
    if(editingPosId===p.id){ if(editPos){ editPos.price=+p.price; renderPosEdit(); } renderPosDom(p); return; }
    // lainnya: garis SL/TP = state server. Garis BISA digeser langsung (ala TradingView):
    // drag garis → onPressedMoving preview + onPressedMoveEnd konfirmasi mini; klik (tanpa geser) → panel.
    // Label DOM (gagang kecil) tetap bisa ditarik juga sebagai alternatif.
    ['sl','tp'].forEach(k=>{ const has=p[k]!=null;
      if(pendingLevel && pendingLevel.id===p.id && pendingLevel.kind===k) return;   // sedang menunggu konfirmasi → jangan reset garis/label
      if(has){ if(rec[k]) try{chart.overrideOverlay({id:rec[k], points:[{value:p[k]}], extendData:posExtend(p,k)});}catch(e){} else rec[k]=posLevel(p,k,true); }
      else if(rec[k]){ try{chart.removeOverlay(rec[k]);}catch(e){} rec[k]=null; }
    });
    renderPosDom(p);
  });
}
// ===== Edit Open Position (staged, ala TradeLocker): panel + garis SL/TP draggable =====
let editingPosId=null, editPos=null, posEditEl=null;
function closePositionEditor(){
  const wasId=editingPosId; editingPosId=null; editPos=null;
  if(posEditEl) posEditEl.classList.remove('show');
  if(wasId!=null && paperLines[wasId]){ ['sl','tp'].forEach(k=>{ if(paperLines[wasId][k]){try{chart.removeOverlay(paperLines[wasId][k]);}catch(e){} paperLines[wasId][k]=null; } }); }
  drawPaperLines();   // gambar ulang dari state server (batalkan staged)
}
// drag popup config: satu listener di elemen popup (delegasi) → tahan rebuild innerHTML.
// Drag hanya dari handleSel; kontrol interaktif dikecualikan. Non-persisten (show menimpa left/top).
function makeDraggable(el, handleSel){
  let drag=false, sx=0, sy=0, ox=0, oy=0;
  el.addEventListener('pointerdown', e=>{
    if(!e.target.closest(handleSel)) return;
    if(e.target.closest('button,input,select,textarea,label,a')) return;   // klik kontrol ≠ drag
    const r=el.getBoundingClientRect();
    drag=true; sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
    el.style.left=ox+'px'; el.style.top=oy+'px';
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    el.classList.add('dragging'); e.preventDefault();
  });
  el.addEventListener('pointermove', e=>{ if(!drag) return;
    let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    nx=Math.max(0, Math.min(window.innerWidth - el.offsetWidth, nx));
    ny=Math.max(0, Math.min(window.innerHeight - 36, ny));   // sisakan ≥36px agar handle popup tinggi tetap terjangkau
    el.style.left=nx+'px'; el.style.top=ny+'px';
  });
  const stop=e=>{ if(!drag) return; drag=false; el.classList.remove('dragging');
    try{ el.releasePointerCapture(e.pointerId); }catch(_){} };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
const GRIP='<div class="pp-grip"></div>';   // bilah pegangan drag untuk popup tanpa header
function buildPosEditPanel(){
  if(posEditEl) return;
  posEditEl=document.createElement('div'); posEditEl.className='objpop pos-edit2';
  posEditEl.innerHTML=
    `<div class="pe-head"><span class="pe-pen">✎</span><span class="pe-title">Edit Open Position</span><span class="pe-dir" id="peDir">—</span><button class="op-chev op-x" id="peClose" title="Close">✕</button></div>`+
    `<div class="pe-inst"><span class="pe-inst-l"><span class="pe-flag" id="peFlag"></span> <b id="peSym">—</b></span><span class="pe-inst-r" id="peInstR">—</span></div>`+
    `<div class="tl-sltp"><div class="tl-head">`+
      `<button type="button" class="tl-trail" id="peTrail" title="Trailing (segera)">Trail</button>`+
      `<label class="tl-toggle" id="peSLtog">Stop Loss<input type="checkbox" id="peSLon"></label>`+
      `<label class="tl-toggle" id="peTPtog">Take Profit<input type="checkbox" id="peTPon"></label></div>`+
    `<div class="tl-grid">`+
      // Price — satu-satunya field editable; Ticks & P&L dihitung balik sbg readout
      `<div class="tl-cell sl"><input class="tl-in" id="peSLprice" type="text" inputmode="decimal" placeholder="—" title="Harga Stop Loss"></div>`+
      `<div class="tl-lbl">Price</div>`+
      `<div class="tl-cell tp"><input class="tl-in" id="peTPprice" type="text" inputmode="decimal" placeholder="—" title="Harga Take Profit"></div>`+
      // Ticks (readout)
      `<div class="tl-cell sl ro"><input class="tl-in" id="peSLticks" type="text" readonly tabindex="-1" placeholder="—"></div>`+
      `<div class="tl-lbl">Ticks</div>`+
      `<div class="tl-cell tp ro"><input class="tl-in" id="peTPticks" type="text" readonly tabindex="-1" placeholder="—"></div>`+
      // P&L ($) / Balance (%) (readout)
      `<div class="tl-cell sl grp-solo ro neg"><div class="tl-kv"><input class="tl-in" id="peSLpnl" type="text" readonly tabindex="-1" placeholder="—"><i>$</i></div><div class="tl-kv"><input class="tl-in" id="peSLpct" type="text" readonly tabindex="-1" placeholder="—"><i>%</i></div></div>`+
      `<div class="tl-lbl grp-solo two"><span>P&L</span><span>Balance</span></div>`+
      `<div class="tl-cell tp grp-solo ro pos"><div class="tl-kv"><input class="tl-in" id="peTPpnl" type="text" readonly tabindex="-1" placeholder="—"><i>$</i></div><div class="tl-kv"><input class="tl-in" id="peTPpct" type="text" readonly tabindex="-1" placeholder="—"><i>%</i></div></div>`+
    `</div></div>`+
    `<div class="pe-act"><button id="peDiscard">Discard</button><button id="peConfirm" class="primary">Confirm</button></div>`;
  document.body.appendChild(posEditEl);
  const $$=s=>posEditEl.querySelector(s);
  $$('#peClose').onclick=closePositionEditor; $$('#peDiscard').onclick=closePositionEditor; $$('#peConfirm').onclick=commitPosSLTP;
  $$('#peSLon').onchange=()=>{ if(editPos){ editPos.slOn=$$('#peSLon').checked; drawStagedLines(); renderPosEdit(); } };
  $$('#peTPon').onchange=()=>{ if(editPos){ editPos.tpOn=$$('#peTPon').checked; drawStagedLines(); renderPosEdit(); } };
  $$('#peSLprice').oninput=()=>{ if(editPos){ const v=+$$('#peSLprice').value; if(isFinite(v)&&v>0){ editPos.sl=v; drawStagedLines(); renderPosEdit(true); } } };
  $$('#peTPprice').oninput=()=>{ if(editPos){ const v=+$$('#peTPprice').value; if(isFinite(v)&&v>0){ editPos.tp=v; drawStagedLines(); renderPosEdit(true); } } };
  $$('#peTrail').onclick=()=>{ if(editPos){ editPos.trail=!editPos.trail; renderPosEdit(); } };
  makeDraggable(posEditEl, '.pe-head');
}
function drawStagedLines(){
  if(!editPos) return; const rec=paperLines[editPos.id]||(paperLines[editPos.id]={entry:null,sl:null,tp:null});
  ['sl','tp'].forEach(k=>{ const on=editPos[k+'On'];
    if(on && editPos[k]!=null){ if(rec[k]) try{chart.overrideOverlay({id:rec[k], points:[{value:editPos[k]}], extendData:posExtend(editPos,k)});}catch(e){} else rec[k]=posLevel(editPos,k,true); }
    else if(rec[k]){ try{chart.removeOverlay(rec[k]);}catch(e){} rec[k]=null; } });
}
function renderPosEdit(skipPriceInputs){
  if(!editPos || !posEditEl) return;
  const $$=s=>posEditEl.querySelector(s);
  const dec=decimalsFor(editPos.instrument), pip=pipOf(editPos.instrument), bal=+$('#balance').value||0, isSell=editPos.dir==='short';
  $$('#peDir').textContent=isSell?'SELL':'BUY'; $$('#peDir').className='pe-dir '+(isSell?'sell':'buy');
  $$('#peFlag').innerHTML = ipkPair(editPos.instrument);   // dual-chip identik picker
  $$('#peSym').textContent=dispSym(editPos.instrument);
  const mkt=+editPos.price, mktCls=(isSell? mkt<=editPos.entry : mkt>=editPos.entry)?'t-pos':'t-neg';
  $$('#peInstR').innerHTML=`${lotLabelFor(editPos.instrument,editPos.units)} / ${(+editPos.entry).toFixed(dec)} → <span class="${mktCls}">${mkt.toFixed(dec)}</span>`;
  $$('#peSLon').checked=editPos.slOn; $$('#peTPon').checked=editPos.tpOn;
  $$('#peSLtog').classList.toggle('on',editPos.slOn); $$('#peTPtog').classList.toggle('on',editPos.tpOn);
  $$('#peTrail').classList.toggle('on',editPos.trail);
  posEditEl.querySelectorAll('.tl-cell.sl').forEach(c=>c.classList.toggle('off',!editPos.slOn));
  posEditEl.querySelectorAll('.tl-cell.tp').forEach(c=>c.classList.toggle('off',!editPos.tpOn));
  if(!skipPriceInputs){ $$('#peSLprice').value=(+editPos.sl).toFixed(dec); $$('#peTPprice').value=(+editPos.tp).toFixed(dec); }
  $$('#peSLticks').value=Math.round(Math.abs(editPos.sl-editPos.entry)/pip);
  $$('#peTPticks').value=Math.round(Math.abs(editPos.tp-editPos.entry)/pip);
  const slLoss=Math.abs(pnlUsd(editPos.dir,editPos.entry,editPos.sl,editPos.units)), tpRew=Math.abs(pnlUsd(editPos.dir,editPos.entry,editPos.tp,editPos.units));
  $$('#peSLpnl').value='−'+slLoss.toFixed(2); $$('#peSLpct').value='−'+(bal?(slLoss/bal*100).toFixed(2):'0.00');
  $$('#peTPpnl').value='+'+tpRew.toFixed(2); $$('#peTPpct').value='+'+(bal?(tpRew/bal*100).toFixed(2):'0.00');
}
function commitPosSLTP(){
  if(!editPos) return;
  if(isReplayId(editPos.id)){ const t=tradeById(editPos.id);
    if(t){ t.sl=editPos.slOn?+editPos.sl:null; t.tp=editPos.tpOn?+editPos.tp:null; recalcRisk(t); }
    toast('SL/TP updated','success'); closePositionEditor(); drawPaperLines(); updateOpenTradeBox(); return; }
  const body={ id:editPos.id, sl: editPos.slOn?editPos.sl:null, tp: editPos.tpOn?editPos.tp:null };
  fetch('/api/position/sltp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(async r=>{ const d=await r.json().catch(()=>({}));
      if(!r.ok){ toast(d.error||'Could not update SL/TP','error'); return; }
      toast('SL/TP updated','success'); closePositionEditor(); await spSync(); drawPaperLines(); })
    .catch(()=>toast('Could not connect to the server','error'));
}
function openPositionEditor(id){
  const p=posById(id); if(!p) return;
  const pip=pipOf(p.instrument), isSell=p.dir==='short', hasNone=(p.sl==null&&p.tp==null);
  editingPosId=id;
  editPos={ id, dir:p.dir, instrument:p.instrument, entry:+p.entry, units:p.units, price:+p.price,
    slOn: p.sl!=null||hasNone, tpOn: p.tp!=null||hasNone, trail:false,
    sl: p.sl!=null?+p.sl : (isSell? +p.entry+100*pip : +p.entry-100*pip),
    tp: p.tp!=null?+p.tp : (isSell? +p.entry-200*pip : +p.entry+200*pip) };
  const rec=paperLines[id]||(paperLines[id]={entry:null,sl:null,tp:null});
  ['sl','tp'].forEach(k=>{ if(rec[k]){try{chart.removeOverlay(rec[k]);}catch(e){} rec[k]=null;} });
  buildPosEditPanel(); drawStagedLines();
  // jaga agar panel tak menutupi kolom label inline (pill + SL/TP) di tepi kiri chart
  const x=Math.min(Math.max(lastPtr.x+8, 224), innerWidth-330), y=Math.min(lastPtr.y+8, innerHeight-330);
  posEditEl.style.left=Math.max(8,x)+'px'; posEditEl.style.top=Math.max(8,y)+'px';
  posEditEl.classList.add('show'); renderPosEdit(); renderPosDom(p);
}
function recalcRisk(t){
  if(!t) return;
  // lot tetap (sizing berbasis lot ala TradeLocker) — geser SL hanya ubah jarak risiko/$ & R, bukan ukuran lot
  if(t.sl!=null) t.risk=Math.abs(t.entry-t.sl)||t.risk;
}
function checkTrades(c, close){
  if(!trades.length) return;
  const h=synthHalfSpread();
  trades.slice().forEach(t=>{
    if(t.fillFrom!=null && c.timestamp < t.fillFrom) return;
    // low/high candle adalah MID → seri bid = mid-½s, seri ask = mid+½s (cermin paper_monitor.go:
    // long dinilai di bid, short di ask). Harga exit = level SL/TP itu sendiri.
    let exit=null;
    if(t.dir==='long'){
      if(t.sl!=null && c.low-h<=t.sl) exit=t.sl;
      else if(t.tp!=null && c.high-h>=t.tp) exit=t.tp;
    } else {
      if(t.sl!=null && c.high+h>=t.sl) exit=t.sl;
      else if(t.tp!=null && c.low+h<=t.tp) exit=t.tp;
    }
    if(exit!==null){ closeTrade(t.id,exit,c.timestamp); return; }
    if(t.trail>0 && t.sl!=null){
      const ns = t.dir==='long' ? (c.high-h)-t.trail : (c.low+h)+t.trail;
      const better = t.dir==='long' ? ns>t.sl : ns<t.sl;
      if(better) t.sl=ns;
    }
  });
}
// dipanggil tiap bar baru terungkap (juga dari jalur LIVE, js/live-refresh.js — di sana
// `trades` selalu kosong sehingga dua cek pertama no-op dan hanya checkAlerts yang bekerja).
function onNewBar(c){ const close=stepBarTs(currentTF,c.timestamp,1); checkPending(c,close); checkTrades(c,close); checkAlerts(c); }
