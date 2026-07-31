// ===================== setting objek gambar: modal Style/Text (double-click / klik-kanan) =====================
const PALETTE=['#ffffff','#4a71ff','#54c88c','#ff6f6f','#f5a623','#a78bfa','#22d3ee','#89898b'];
const objPop=document.createElement('div'); objPop.className='objpop'; document.body.appendChild(objPop);   // dipakai popup posisi (showPosPopup)
makeDraggable(objPop, '.pp-grip');
// objek yang mendukung teks (tab Text) & subset yang menghormati alignment saat render
const DM_TEXT_OBJS=new Set(['text','callout','rect','trendline']);
const DM_ALIGN_OBJS=new Set(['text','rect','trendline']);   // callout selalu kiri-atas → tanpa chip align
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
// dispatcher: posisi long/short pakai popup zona sendiri, sisanya modal Style/Text
function openObjSettings(o, cx, cy, tab){
  if(!o||DRAW_DEFAULT[o.name]===undefined) return;
  if(o.name==='longPosition'||o.name==='shortPosition'){ showPosPopup(o, cx, cy); return; }
  openDrawModal(o, tab);
}
function openDrawModal(o, tab){
  if(!o||DRAW_DEFAULT[o.name]===undefined) return;
  const name=o.name, st=dstyle(o), isFib=(name==='fib3');
  const hasText=DM_TEXT_OBJS.has(name), hasAlign=DM_ALIGN_OBJS.has(name);
  const active=(tab==='text'&&hasText)?'text':'style';
  const cols=PALETTE.map(c=>`<button class="sw ${st.color===c?'on':''}" data-col="${c}" style="background:${c}"></button>`).join('');
  const ws=[1,2,3,4].map(w=>`<button class="pp-chip ${(+st.size)===w?'on':''}" data-w="${w}">${w}px</button>`).join('');
  const ss=[['solid','Solid'],['dashed','Dash'],['dotted','Dot']].map(p=>`<button class="pp-chip ${st.style===p[0]?'on':''}" data-st="${p[0]}">${p[1]}</button>`).join('');
  const stylePane=`<div class="dm-pane" data-pane="style">`
    +(isFib?'':`<div class="pp-lbl">Color</div><div class="pp-row">${cols}</div>`)
    +`<div class="pp-lbl">Thickness</div><div class="pp-row">${ws}</div>`
    +`<div class="pp-lbl">Line style</div><div class="pp-row">${ss}</div>`
    +(isFib?`<div class="pp-row" style="margin-top:2px"><button class="pp-chip" id="dmFib">⚙ Level &amp; Color</button></div>`:'')
    +`</div>`;
  let textPane='';
  if(hasText){
    const talign=st.textAlign||(DRAW_DEFAULT[name]&&DRAW_DEFAULT[name].textAlign)||'center';
    const tvalign=st.textValign||(DRAW_DEFAULT[name]&&DRAW_DEFAULT[name].textValign)||'middle';
    const has=[['left','Left'],['center','Center'],['right','Right']].map(p=>`<button class="pp-chip ${talign===p[0]?'on':''}" data-ha="${p[0]}">${p[1]}</button>`).join('');
    const vas=[['top','Top'],['middle','Middle'],['bottom','Bottom']].map(p=>`<button class="pp-chip ${tvalign===p[0]?'on':''}" data-va="${p[0]}">${p[1]}</button>`).join('');
    textPane=`<div class="dm-pane" data-pane="text"><textarea class="dm-ta" placeholder="Add text">${dmEsc(o.extendData)}</textarea>`
      +(hasAlign?`<div class="pp-lbl">Horizontal</div><div class="pp-row">${has}</div><div class="pp-lbl">Vertical</div><div class="pp-row">${vas}</div>`:'')
      +`</div>`;
  }
  const panel=drawModal.querySelector('.dmodal');
  panel.innerHTML=`<div class="dm-head">${OBJ_ICON[name]?`<span class="dm-ico">${OBJ_ICON[name]}</span>`:''}<span class="dm-title">${dmEsc(OBJ_TITLE[name]||name)}</span><button class="dm-x" title="Close" aria-label="Close">✕</button></div>`
    +`<div class="dm-tabs"><button class="dm-tab" data-tab="style">Style</button>${hasText?`<button class="dm-tab" data-tab="text">Text</button>`:''}</div>`
    +`<div class="dm-body">${stylePane}${textPane}</div>`
    +`<div class="dm-foot"><button class="dm-lock"></button><button class="dm-del">${TRASH_SVG}<span>Delete</span></button><button class="dm-close">Close</button></div>`;
  const mark=(sel,el)=>{ panel.querySelectorAll(sel).forEach(x=>x.classList.remove('on')); el.classList.add('on'); };
  const dmSwitch=(t)=>{ panel.querySelectorAll('.dm-tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
    panel.querySelectorAll('.dm-pane').forEach(p=>{ p.hidden=(p.dataset.pane!==t); }); };
  panel.querySelectorAll('.dm-tab').forEach(b=>b.onclick=()=>dmSwitch(b.dataset.tab));
  panel.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{color:b.dataset.col}); mark('[data-col]',b); });
  panel.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{size:+b.dataset.w}); mark('[data-w]',b); });
  panel.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{style:b.dataset.st}); mark('[data-st]',b); });
  panel.querySelectorAll('[data-ha]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textAlign:b.dataset.ha}); mark('[data-ha]',b); });
  panel.querySelectorAll('[data-va]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{textValign:b.dataset.va}); mark('[data-va]',b); });
  const ta=panel.querySelector('.dm-ta');
  if(ta) ta.addEventListener('input',()=>{ try{chart.overrideOverlay({id:o.id,extendData:ta.value});}catch(e){} });   // live update di canvas
  const fb=panel.querySelector('#dmFib'); if(fb) fb.onclick=()=>{ closeDrawModal(); showFibPop(Math.round(window.innerWidth/2-90), 90); };
  panel.querySelector('.dm-del').onclick=()=>{ const id=o.id; dmTarget=null; closeDrawModal(); try{chart.removeOverlay(id);}catch(e){} };
  // Lock objek: terkunci = tak bisa digeser & tak bisa terhapus (js/draw-lock.js). Delete dimatikan
  // selama terkunci supaya "buka kunci" jadi langkah sadar, bukan klik yang sama dua kali.
  const lockBtn=panel.querySelector('.dm-lock');
  const syncLock=()=>{ const on=isLocked(o.id);
    lockBtn.textContent = on?'Unlock':'Lock';
    lockBtn.classList.toggle('on',on);
    const del=panel.querySelector('.dm-del');
    del.disabled=on; del.title = on?'Unlock to delete':'';
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
// popup khusus Long/Short Position: warna & transparansi zona Profit & Stop terpisah (per objek)
function showPosPopup(o, cx, cy){
  const st=dstyle(o);
  const tA=st.tgtAlpha!=null?st.tgtAlpha:12, sA=st.stopAlpha!=null?st.stopAlpha:12;
  objPop.innerHTML=GRIP+
     `<div class="pp-lbl">Profit / Target</div>`
    +`<div class="pp-row"><input type="color" class="pp-color" id="ppTgtC" value="${st.tgtColor||'#089981'}"></div>`
    +`<div class="pp-slider"><input type="range" id="ppTgtA" min="0" max="100" value="${tA}"><span class="pp-sval" id="ppTgtAV">${tA}%</span></div>`
    +`<div class="pp-lbl">Stop / Loss</div>`
    +`<div class="pp-row"><input type="color" class="pp-color" id="ppStopC" value="${st.stopColor||'#f23645'}"></div>`
    +`<div class="pp-slider"><input type="range" id="ppStopA" min="0" max="100" value="${sA}"><span class="pp-sval" id="ppStopAV">${sA}%</span></div>`
    +`<div class="pp-act"><button id="ppDel">🗑 Delete</button></div>`;
  objPop.style.left=Math.min(cx,window.innerWidth-204)+'px';
  objPop.style.top =Math.min(cy,window.innerHeight-240)+'px';
  objPop.classList.add('show');
  objPop.querySelector('#ppTgtC').oninput =e=>setObjStyle(o.id,{tgtColor:e.target.value});
  objPop.querySelector('#ppStopC').oninput=e=>setObjStyle(o.id,{stopColor:e.target.value});
  objPop.querySelector('#ppTgtA').oninput =e=>{ objPop.querySelector('#ppTgtAV').textContent=e.target.value+'%'; setObjStyle(o.id,{tgtAlpha:+e.target.value}); };
  objPop.querySelector('#ppStopA').oninput=e=>{ objPop.querySelector('#ppStopAV').textContent=e.target.value+'%'; setObjStyle(o.id,{stopAlpha:+e.target.value}); };
  objPop.querySelector('#ppDel').onclick=()=>{ const id=o.id; hideObjPopup(); try{chart.removeOverlay(id);}catch(e){} };
}
function hideObjPopup(){ objPop.classList.remove('show'); }
document.addEventListener('mousedown',e=>{ if(objPop.classList.contains('show')&&!objPop.contains(e.target)) hideObjPopup(); }, true);

// ===================== editor level Fibonacci (tambah/hapus/ubah nilai) =====================
const fibPop=document.createElement('div'); fibPop.className='fibpop'; document.body.appendChild(fibPop);
makeDraggable(fibPop, '.pp-grip');
function showFibPop(cx,cy){
  const rows=fibLevels.map((lv,i)=>`<div class="fp-row"><input type="color" class="fp-color" value="${lv.color||fibColor(lv.value,i)}" data-ci="${i}" title="Level color"><input type="number" step="0.001" value="${lv.value}" data-i="${i}"><button class="fp-x" data-i="${i}" title="Delete level">✕</button></div>`).join('');
  fibPop.innerHTML=GRIP+`<div class="pp-lbl">Fibonacci Levels</div>${rows}`
    +`<div class="fp-bg"><label><input type="checkbox" id="fpBgOn"${fibBg.on?' checked':''}> Background</label>`
    +`<input type="range" id="fpBgOp" min="0" max="100" value="${fibBg.opacity}"${fibBg.on?'':' disabled'}><span id="fpBgVal">${fibBg.opacity}%</span></div>`
    +`<div class="fp-act"><button id="fpAdd">+ Add</button><button id="fpReset">Reset</button></div>`;
  fibPop.style.left=Math.min(cx,window.innerWidth-190)+'px';
  fibPop.style.top =Math.min(Math.max(cy,8),window.innerHeight-300)+'px';
  fibPop.classList.add('show');
  fibPop.querySelectorAll('input[data-i]').forEach(inp=>inp.onchange=()=>{ const v=parseFloat(inp.value); if(!isNaN(v)){ fibLevels[+inp.dataset.i].value=v; saveFibLevels(); } });
  fibPop.querySelectorAll('input[data-ci]').forEach(inp=>inp.oninput=()=>{ fibLevels[+inp.dataset.ci].color=inp.value; saveFibLevels(); });
  fibPop.querySelectorAll('.fp-x').forEach(b=>b.onclick=()=>{ fibLevels.splice(+b.dataset.i,1); if(!fibLevels.length) fibLevels=[{value:0,color:fibColor(0,0)}]; saveFibLevels(); showFibPop(fibPop.offsetLeft,fibPop.offsetTop); });
  const bgOn=fibPop.querySelector('#fpBgOn'), bgOp=fibPop.querySelector('#fpBgOp'), bgVal=fibPop.querySelector('#fpBgVal');
  bgOn.onchange=()=>{ fibBg.on=bgOn.checked; bgOp.disabled=!fibBg.on; saveFibBg(); };
  bgOp.oninput=()=>{ fibBg.opacity=+bgOp.value; bgVal.textContent=fibBg.opacity+'%'; saveFibBg(); };
  fibPop.querySelector('#fpAdd').onclick=()=>{ fibLevels.push({value:0.618,color:fibColor(0.618,fibLevels.length)}); saveFibLevels(); showFibPop(fibPop.offsetLeft,fibPop.offsetTop); };
  fibPop.querySelector('#fpReset').onclick=()=>{ fibLevels=defaultFibLevels(); saveFibLevels(); showFibPop(fibPop.offsetLeft,fibPop.offsetTop); };
}
function hideFibPop(){ fibPop.classList.remove('show'); }
document.addEventListener('mousedown',e=>{ if(fibPop.classList.contains('show')&&!fibPop.contains(e.target)) hideFibPop(); }, true);
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeDrawModal(); hideObjPopup(); hideFibPop(); chartSet.classList.remove('show'); } });

