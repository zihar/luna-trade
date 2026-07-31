// ===================== keyboard =====================
// Hotkey timeframe ala TradingView: ketik DIGIT di chart → buka dialog "Change interval"
// (konfirmasi eksplisit, TIDAK langsung ganti TF). Enter apply, Esc/klik-luar batal.
const MIN_TO_TF={}; for(const k in DUR){ const mn=DUR[k]/6e4; if(Number.isInteger(mn)) MIN_TO_TF[mn]=k; }
const TF_HUMAN={M1:'1 minute',M2:'2 minutes',M4:'4 minutes',M5:'5 minutes',M10:'10 minutes',M15:'15 minutes',M30:'30 minutes',H1:'1 hour',H2:'2 hours',H3:'3 hours',H4:'4 hours',H6:'6 hours',H8:'8 hours',H12:'12 hours',D:'1 day',W:'1 week',MN:'1 month'};
// string interval → kode TF (atau null bila tak tersedia). menit / Nm = menit, Nh = jam, Nd/Nw = day/week, NM (kapital) = month.
function parseInterval(s){
  s=(s||'').trim(); let m;
  if(/^\d*M$/.test(s)) return 'MN';
  if(m=s.match(/^(\d+)m?$/)) return MIN_TO_TF[+m[1]]||null;
  if(m=s.match(/^(\d+)h$/i)) return MIN_TO_TF[+m[1]*60]||null;
  if(/^\d*d$/i.test(s)) return 'D';
  if(/^\d*w$/i.test(s)) return 'W';
  return null;
}
const openIntervalDialog=(function(){
  const ov=document.createElement('div'); ov.className='ivl-overlay';
  ov.innerHTML=`<div class="ivl-card" role="dialog" aria-modal="true" aria-label="Change interval">`
    +`<div class="ivl-head"><span class="ivl-title">Change interval</span>`
    +`<svg class="ivl-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.4v.01"/><title>Type minutes (60 = 1 hour), or 4h · 1D · 1W · 1M. Enter to apply, Esc to cancel.</title></svg></div>`
    +`<input class="ivl-input" inputmode="text" autocomplete="off" spellcheck="false" maxlength="6" aria-label="Interval">`
    +`<div class="ivl-sub"></div></div>`;
  document.body.appendChild(ov);
  const card=ov.querySelector('.ivl-card'), input=ov.querySelector('.ivl-input'), sub=ov.querySelector('.ivl-sub');
  let curTf=null;
  function update(){
    input.value=input.value.replace(/[^0-9dwhmDWM]/g,'');
    curTf=parseInterval(input.value);
    if(curTf){ sub.textContent=TF_HUMAN[curTf]||curTf; input.classList.remove('invalid'); sub.classList.remove('invalid'); }
    else if(!input.value){ sub.textContent='Type an interval'; input.classList.remove('invalid'); sub.classList.remove('invalid'); }
    else { sub.textContent='Not available'; input.classList.add('invalid'); sub.classList.add('invalid'); }
  }
  function close(){ ov.classList.remove('show'); }
  function apply(){ if(curTf){ if(curTf!==currentTF) try{ switchTF(curTf); }catch(_){} close(); } }
  input.addEventListener('input',update);
  input.addEventListener('keydown',e=>{ e.stopPropagation();
    if(e.key==='Enter'){ e.preventDefault(); apply(); }
    else if(e.key==='Escape'){ e.preventDefault(); close(); } });
  ov.addEventListener('mousedown',e=>{ if(!card.contains(e.target)) close(); });
  return function(seed){ input.value=seed||''; ov.classList.add('show'); update();
    input.focus(); const n=input.value.length; try{ input.setSelectionRange(n,n); }catch(_){} };
})();
window.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  // shortcut drawing ala TradingView — Alt+huruf (Mac ⌥). Pakai e.code (fisik) agar OS/layout-independent.
  if(e.altKey && !e.ctrlKey && !e.metaKey){ const hit=SC_BY_CODE[e.code]; if(hit){ e.preventDefault(); activateShortcut(hit); return; } }
  // undo/redo objek gambar — Ctrl/⌘+Z, redo = Ctrl/⌘+Shift+Z atau Ctrl/⌘+Y
  if(e.ctrlKey||e.metaKey){
    const k=e.key.toLowerCase();
    if(k==='z'){ e.preventDefault(); e.shiftKey?redoDraw():undoDraw(); return; }
    if(k==='y'){ e.preventDefault(); redoDraw(); return; }
  }
  // Ketik DIGIT → buka dialog "Change interval" (konfirmasi, bukan ganti TF langsung).
  // Ketik HURUF / '/' → symbol search. Digit vs huruf → tak ada tabrakan namespace.
  // Ctrl/⌘ + huruf/digit = shortcut browser (⌘R refresh, ⌘L address bar, dst) → jangan intersepsi.
  if(!e.ctrlKey && !e.metaKey){
    if(e.key>='0' && e.key<='9'){ e.preventDefault(); openIntervalDialog(e.key); return; }
    if(!e.altKey && (e.key==='/' || /^[a-zA-Z]$/.test(e.key))){
      e.preventDefault();
      const seed = e.key==='/' ? '' : e.key;
      try{ openIpick(); const q=$('#ipickQ'); if(q){ q.value=seed; renderIpick(seed); } }catch(_){}
      return;
    }
  }
  if(e.key==='ArrowRight'){e.preventDefault();step(1)}
  else if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}
  else if(e.key===' '){e.preventDefault();togglePlay()}
  else if(e.key==='Delete'||e.key==='Backspace'){ const id=selectedId||hoverId; if(id){ e.preventDefault(); if(blockedByLock(id)) return; try{chart.removeOverlay(id);}catch(_){} } }
  else if(e.key==='Escape'){ clearMeasure(); if(!cancelInProgressDraw() && selectedId){ deselectOverlay(); } }
  // ('b'/'s' telanjang → submit order dihapus: huruf kini memicu symbol search, bukan eksekusi order)
});

