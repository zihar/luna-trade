// ===== Notif event ekonomi high-impact (OS Notification + fallback kartu on-chart) =====
// Sumber data: newsState (poll 60s, ter-scope instrumen aktif). Dua momen: reminder T-5mnt
// & saat rilis (actual+bias). Dedup per-event via id (time|name), anti-backlog saat load/switch,
// persist lintas-reload di br_newsNotified. Default ON; toggle bell di header News.
const NEWS_NOTIFY_LEAD=5;                              // menit sebelum rilis utk reminder
let _newsNotifyInst=null;                              // instrumen yg set notif-nya sudah di-seed
const _newsNotified={rem:new Set(), rel:new Set()};    // event id yg sudah dinotif per-kind (instrumen aktif)
let _newsPermAsked=false;                              // guard minta izin OS sekali/sesi
function newsNotifOn(){ return localStorage.getItem('br_newsNotify')!=='0'; }   // default ON
function evId(r){ return r.time+'|'+r.name; }
function newsNotifMap(){ try{ return JSON.parse(localStorage.getItem('br_newsNotified')||'{}'); }catch(e){ return {}; } }
function saveNewsNotif(inst){ const m=newsNotifMap();
  m[inst]={rem:[..._newsNotified.rem].slice(-80), rel:[..._newsNotified.rel].slice(-80)};   // cap agar tak tumbuh tanpa batas
  try{ localStorage.setItem('br_newsNotified', JSON.stringify(m)); }catch(e){} }
// Seed anti-backlog + muat dedup tersimpan. Event yg SUDAH rilis / sudah mepet (≤lead) saat
// load/ganti-instrumen ditandai "sudah dinotif" → hanya transisi BARU setelah ini yg menembak.
function seedNewsNotify(d){
  const inst=d.instrument;
  _newsNotified.rem.clear(); _newsNotified.rel.clear();
  const saved=newsNotifMap()[inst];
  if(saved){ (saved.rem||[]).forEach(x=>_newsNotified.rem.add(x)); (saved.rel||[]).forEach(x=>_newsNotified.rel.add(x)); }
  const now=Date.now();
  (d.releases||[]).forEach(r=>{
    if(String(r.impact||'').toLowerCase()!=='high') return;
    const id=evId(r);
    if(r.released) _newsNotified.rel.add(id);
    else if((Date.parse(r.time)-now)/60000 <= NEWS_NOTIFY_LEAD) _newsNotified.rem.add(id);
  });
  _newsNotifyInst=inst; saveNewsNotif(inst);
}
// Scan newsState: tembak reminder (≤lead, belum rilis) & notif rilis (actual masuk). Idempoten.
function checkNewsNotify(){
  if(!newsNotifOn() || !newsState || !Array.isArray(newsState.releases)) return;
  const inst=newsState.instrument;
  if(_newsNotifyInst!==inst){ seedNewsNotify(newsState); return; }   // siklus seed: jangan tembak backlog
  const now=Date.now();
  const freshRem={}, freshRel={};    // time → [release] event high-impact yg baru memicu (belum dinotif)
  for(const r of newsState.releases){
    if(String(r.impact||'').toLowerCase()!=='high') continue;
    const id=evId(r);
    if(!r.released){
      const mins=(Date.parse(r.time)-now)/60000;
      if(mins>0 && mins<=NEWS_NOTIFY_LEAD && !_newsNotified.rem.has(id)) (freshRem[r.time]=freshRem[r.time]||[]).push(r);
    }else if(!_newsNotified.rel.has(id)) (freshRel[r.time]=freshRel[r.time]||[]).push(r);
  }
  let dirty=false;
  // Gabung event ber-waktu-sama → satu notif per grup (mis. batch NFP jam 12:30).
  for(const t in freshRem){ const g=freshRem[t]; g.forEach(r=>_newsNotified.rem.add(evId(r))); dirty=true; fireNewsNotif('rem', g, (Date.parse(t)-now)/60000); }
  for(const t in freshRel){ const g=freshRel[t]; g.forEach(r=>_newsNotified.rel.add(evId(r))); dirty=true; fireNewsNotif('rel', g); }
  if(dirty) saveNewsNotif(inst);
}
// Kirim satu notif utk SEGRUP event (≥1) ber-waktu-sama: OS Notification (bila izin granted)
// + kartu on-chart (selalu, sbg jejak in-app). group = array release; n=1 → format tunggal.
function fireNewsNotif(kind, group, mins){
  const badge=newsBadge(newsState?newsState.instrument:newsCurrentInstrument());
  const curTxt=[...new Set(group.map(r=>r.currency).filter(Boolean))].join(', ');
  const n=group.length;
  let timeTxt='at '+fmtTzTime(group[0].time);   // jam EVENT dalam chartTZ; awalan "at" agar tak dikira jam kartu muncul (label relatif "in N min" bisa basi saat kartu persist)
  const dirOf=r=>{ const b=(r.verdict&&r.verdict.bias)||'neutral'; return b==='bullish'?'up':(b==='bearish'?'down':''); };
  let osMsg, metaTxt, titleTxt, body='';
  if(kind==='rem'){
    const m=Math.max(1,Math.round(mins)); metaTxt=`in ${m} min`;
    if(n===1){ const r=group[0]; titleTxt=`${r.name} (${r.currency})`; osMsg=`High-impact in ${m} min: ${r.name} (${r.currency})`; }
    else{
      titleTxt=`${n} high-impact events${curTxt?` (${curTxt})`:''}`;
      body=`<div class="nc-evlist">${group.map(r=>newsEsc(r.name)).join(' · ')}</div>`;
      osMsg=`${n} high-impact in ${m} min${curTxt?` (${curTxt})`:''}: ${group.map(r=>r.name).join(', ')}`;
    }
  }else{
    metaTxt='Released';
    const dlong=d=>d==='up'?'Bullish':'Bearish';
    if(n===1){ const r=group[0], d=dirOf(r);
      titleTxt=`${r.name}: ${r.actual||'?'} vs ${r.forecast||'?'}`;
      if(d) body=`<div class="nc-evrow"><span class="nc-bias ${d}">${newsEsc((r.currency||'')+' '+dlong(d))}</span></div>`;
      osMsg=`${r.name} released: ${r.actual||'?'} vs ${r.forecast||'?'} forecast`+(d?` → ${r.currency} ${dlong(d)}`:'');
    }else{
      titleTxt=`${n} high-impact released${curTxt?` (${curTxt})`:''}`;
      body=`<div class="nc-evlist">`+group.map(r=>{ const d=dirOf(r);
        return `<div class="nc-evline"><span class="nc-evn">${newsEsc(r.name)}</span><b>${newsEsc(r.actual||'?')}</b>`+(d?`<span class="nc-bias ${d}">${d==='up'?'Bull':'Bear'}</span>`:'')+`</div>`;
      }).join('')+`</div>`;
      osMsg=`${n} high-impact released${curTxt?` (${curTxt})`:''}: `+group.map(r=>`${r.name} ${r.actual||'?'}`).join(', ');
    }
  }
  try{ if(typeof Notification!=='undefined' && Notification.permission==='granted') new Notification('Luna Trade — High-impact', {body:osMsg}); }catch(e){}
  pushChartCard(`<div class="nc-top"><span class="nc-badge">🔔 ${newsEsc(badge)}</span>`
    +`<span class="nc-src">${newsEsc(metaTxt)}</span>`
    +`<span class="nc-time">${newsEsc(timeTxt)}</span>`
    +`<button class="nc-x" aria-label="Dismiss">✕</button></div>`
    +`<div class="nc-title">${newsEsc(titleTxt)}</div>`+body, 'nc-evt');
  try{ track('news_notify',{kind, count:n, name:group.map(r=>r.name).join(',')}); }catch(e){}
}
function renderNews(d){
  const body=$('#newsBody');
  const inst=d.instrument||'';
  const pretty=newsEsc(inst.replace('_','/'));
  // Bias summary = rilis terbaru yang MENGHASILKAN arah (bias non-netral). Event
  // high-impact netral (mis. ISM/FOMC) tak menimpa bias CPI/PPI/NFP sebelumnya;
  // bila belum ada rilis berarah, pakai rilis terakhir (netral) / pesan menunggu.
  let directional=null, lastReleased=null;
  for(const r of (d.releases||[])){
    if(!r.released) continue;
    lastReleased=r;
    if(r.verdict && r.verdict.bias && r.verdict.bias!=='neutral') directional=r;
  }
  const card = directional || lastReleased;
  const bias = card ? card.verdict.bias : 'neutral';
  const dirLbl = bias==='bullish'?'BULLISH':bias==='bearish'?'BEARISH':'NEUTRAL';
  const regime = d.regime==='strong-data-hawkish' ? 'strong data → USD ↑' : 'strong data → USD ↓';

  let html='';
  // 1) Bias summary (ramping)
  html+=`<div class="cal-bias ${bias}">
    <span class="cal-sym">◐ ${pretty}</span>
    <span class="cal-dir">${biasArrow(bias)} ${dirLbl}</span>
    <div class="cal-regime">Regime: <b>${regime}</b>${d.stale?' · Delayed data':''}</div>
  </div>`;

  // 2) Next-release hero (countdown live). Impact tak dibawa nextRelease → cocokkan ke releases.
  if(d.nextRelease){
    const nr=d.nextRelease;
    const match=(d.releases||[]).find(r=>r.time===nr.time && r.name===nr.name);
    const hi = match && String(match.impact).toLowerCase()==='high';
    const nc = nr.currency ? newsEsc(nr.currency)+' · ' : '';
    html+=`<div class="cal-hero ${hi?'imp-high':'imp-med'}">
      <div class="cal-hero-eyebrow">Next release</div>
      <div class="cal-hero-name">${nc}${newsEsc(nr.name)}</div>
      <div class="cal-cd" data-t="${newsEsc(nr.time)}">—</div>
      <div class="cal-hero-meta">${newsEsc(fmtLocalFull(nr.time))}
        <span class="cal-imp"><i></i><i></i>${hi?'<i></i>':''}</span>
        <span class="cal-implbl">${hi?'High':'Medium'}</span></div>
    </div>`;
  }

  // 3) Timeline harian
  const rels=d.releases||[];
  if(!rels.length){
    html+='<div class="news-empty">No high-impact events this week.</div>';
  }else{
    const nextKey = d.nextRelease ? d.nextRelease.time+'|'+d.nextRelease.name : null;
    let curDay=null;
    for(const r of rels){
      const dt=new Date(r.time);
      const dk=isNaN(dt)?'?':tzYMD(dt);   // grup harian dalam chartTZ (konsisten dgn jam yg ditampilkan)
      if(dk!==curDay){
        if(curDay!==null) html+='</div>';   // tutup group hari sebelumnya
        const dh = isNaN(dt) ? 'Scheduled' : newsEsc(calDayLabel(dt));
        const dd = isNaN(dt) ? '' : `<span class="cal-daydate">${newsEsc(calDayDate(dt))}</span>`;
        html+=`<div class="cal-daygroup"><div class="cal-dayhead"><span>${dh}</span>${dd}</div>`;
        curDay=dk;
      }
      const hi=String(r.impact).toLowerCase()==='high';
      const impCls=hi?'imp-high':'imp-med';
      const isNext = nextKey && (r.time+'|'+r.name)===nextKey;
      const tm=isNaN(dt)?'—':fmtTzTime(r.time);
      let fpa=`<span><i>F</i><b>${newsEsc(r.forecast||'—')}</b></span><span><i>P</i><b>${newsEsc(r.previous||'—')}</b></span>`;
      if(r.released) fpa+=`<span><i>A</i><b>${newsEsc(r.actual||'—')}</b></span>`;
      let extra='';
      if(r.released){
        const s=surpriseBits(r, inst);
        extra=`<div class="cal-surprise ${s.biasClass}">
          <span class="cal-delta">${s.glyph} ${s.delta?newsEsc(s.delta)+' ':''}${s.word}</span>
          ${s.biasClass!=='neutral'?`<span class="cal-biastag">→ ${newsEsc(s.biasLabel)}</span>`:''}
        </div>`;
      }else if(isNext && r.verdict && r.verdict.playbook){
        // Pre-scenario hanya di event "next" — identik utk semua rilis USD, jadi
        // menampilkannya di tiap baris cuma noise. Beri konteks di satu tempat.
        extra=`<div class="cal-pre">${newsEsc(r.verdict.playbook)}</div>`;
      }
      html+=`<div class="cal2-item ${impCls} ${r.released?'released':''}">
        <span class="cal-node${isNext?' is-next':''}"></span>
        <div class="cal2-top"><span class="cal-time">${newsEsc(tm)}</span>
          <span class="cal-cur">${newsEsc(r.currency||'')}</span>
          <span class="cal-imp"><i></i><i></i>${hi?'<i></i>':''}</span>
          <span class="cal-implbl">${hi?'High':'Medium'}</span></div>
        <div class="cal2-name">${newsEsc(r.name)}</div>
        <div class="cal-fpa">${fpa}</div>
        ${extra}
      </div>`;
    }
    if(curDay!==null) html+='</div>';   // tutup group terakhir
  }
  body.innerHTML=html;
  tickNewsCountdown();
}
// Update hitung-mundur hero tiap detik (interval 1s di setNewsOpen). Elemen absen → no-op.
function tickNewsCountdown(){
  const el=$('#newsBody .cal-hero .cal-cd'); if(!el) return;
  const t=new Date(el.dataset.t).getTime();
  el.textContent = isNaN(t) ? '—' : fmtCountdown(t-Date.now());
}
// Markets hidden-state ditangkap saat News dibuka, utk direstore persis saat News ditutup.
// null = News sedang tertutup / belum pernah dibuka di sesi render ini.
let newsPrevMarketsHidden=null;
function setNewsOpen(open){
  const np=$('#newspanel'), wl=$('#watchlist');
  if(open){
    if(!np.classList.contains('hidden')) return;   // sudah terbuka — no-op, jangan timpa prev state
    newsPrevMarketsHidden=wl.classList.contains('hidden');
    setColumnVisible(true);            // pastikan kolom kanan tampil (lebar, resize handle) — TANPA sentuh order dock
    wl.classList.add('hidden');        // sembunyikan Markets, News & Markets berbagi grid-area:markets (radio)
    $('#toggleMarkets').classList.remove('on');
    np.classList.remove('hidden');
    if(typeof loadNews==='function') loadNews();                                 // fresh saat buka
    // Minta izin OS lazily saat panel dibuka (gesture user). Sekali/sesi; hanya bila notif ON.
    try{ if(newsNotifOn() && !_newsPermAsked && typeof Notification!=='undefined' && Notification.permission==='default'){ Notification.requestPermission(); _newsPermAsked=true; } }catch(e){}
    setNewsTab(newsTab());             // sinkron UI tab (Calendar/News) ke preferensi tersimpan
    clearInterval(_newsCountdown); _newsCountdown=setInterval(tickNewsCountdown, 1000);   // countdown tiap detik
  }else{
    if(np.classList.contains('hidden')) return;    // sudah tertutup — no-op
    np.classList.add('hidden');
    const restoreHidden = newsPrevMarketsHidden===null ? true : newsPrevMarketsHidden;
    wl.classList.toggle('hidden', restoreHidden);
    setColumnVisible(!restoreHidden);
    $('#toggleMarkets').classList.toggle('on', !restoreHidden);
    localStorage.setItem('br_watchHidden', restoreHidden?'1':'0');
    newsPrevMarketsHidden=null;
    clearInterval(_newsCountdown); _newsCountdown=null;
  }
  try{chart.resize();}catch(e){}
  localStorage.setItem('br_newsOpen', open?'1':'0');
  $('#toggleNews').classList.toggle('on',open);
}
function toggleNews(){ setNewsOpen($('#newspanel').classList.contains('hidden')); }
function toggleOrder(){ const op=$('#orderpanel'); const hide=op.style.display!=='none'; op.style.display=hide?'none':''; $('#toggleOrder').classList.toggle('on',!hide); localStorage.setItem('br_orderHidden',hide?'1':'0'); try{ drawDraftLines(); }catch(e){} }
function toggleTrades(){ const b=$('#bottompanel'); const c=b.classList.toggle('collapsed');
  app.style.setProperty('--trades-h', c?'36px':savedTradesH()+'px');
  $('#bottomToggle').textContent=c?'⏶':'⏷'; $('#toggleTrades').classList.toggle('on',!c);
  localStorage.setItem('br_bottomHidden',c?'1':'0'); try{chart.resize();}catch(e){} if(!c){try{drawEquity();}catch(e){}} }
$('#toggleMarkets').onclick=toggleMarkets;
$('#toggleOrder').onclick=toggleOrder;
$('#toggleTrades').onclick=toggleTrades;
// Toggle marker on-chart — sinkron localStorage; off → sembunyikan layer & tutup popup.
(function initNewsMarkerToggle(){
  const cb=$('#newsMarkerToggle'); if(!cb) return;
  cb.checked=newsMarkersEnabled();
  cb.addEventListener('change', ()=>{
    localStorage.setItem('br_newsMarkers', cb.checked?'1':'0');
    if(typeof closeNewsPop==='function') closeNewsPop();
    renderNewsMarkers();   // enabled=false → renderNewsMarkers menyembunyikan & mengosongkan layer
  });
})();
// Toggle notif high-impact — default ON; menyalakan minta izin OS (gesture).
(function initNewsNotifyToggle(){
  const cb=$('#newsNotifyToggle'); if(!cb) return;
  cb.checked=newsNotifOn();
  cb.addEventListener('change', ()=>{
    localStorage.setItem('br_newsNotify', cb.checked?'1':'0');
    if(cb.checked){
      try{ if(typeof Notification!=='undefined' && Notification.permission==='default'){ Notification.requestPermission(); _newsPermAsked=true; } }catch(e){}
      toast('High-impact alerts on','info');
    }else toast('High-impact alerts off','info');
  });
})();
$('#bottomToggle').onclick=toggleTrades;
$('#marketsClose').onclick=toggleMarkets;     // sembunyikan dari header Markets
$('#toggleNews').onclick=toggleNews;
$('#newsClose').onclick=()=>setNewsOpen(false);
{ const c=$('#newsTabCalendar'), n=$('#newsTabNews');
  if(c) c.onclick=()=>setNewsTab('calendar');
  if(n) n.onclick=()=>setNewsTab('news'); }
document.querySelectorAll('.op-x').forEach(b=>b.onclick=toggleOrder);   // tutup dari header (sejajar chevron)

// --- drag order panel dari mana saja KECUALI kontrol (tombol/input/label/stepper) ---
(function(){ const op=$('#orderpanel'); if(!op) return;
  let drag=false,sx,sy,ox,oy;
  op.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,input,select,a,label,.op2-step')) return;   // kontrol = bukan drag
    if(op.dataset.dock!=='floating'){ setOrderDock(true,true); }
    const r=op.getBoundingClientRect();
    drag=true; sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
    op.style.left=ox+'px'; op.style.top=oy+'px';
    op.setPointerCapture(e.pointerId); e.preventDefault();
  });
  op.addEventListener('pointermove',e=>{ if(!drag) return;
    let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    nx=Math.max(0,Math.min(window.innerWidth - op.offsetWidth, nx));
    ny=Math.max(0,Math.min(window.innerHeight - 36, ny));
    op.style.left=nx+'px'; op.style.top=ny+'px';
    localStorage.setItem('br_opPos',JSON.stringify({x:nx,y:ny}));
  });
  const stop=()=>{ drag=false; };
  op.addEventListener('pointerup',stop); op.addEventListener('pointercancel',stop);
})();

// --- geser pembatas: lebar Markets & tinggi Trades ---
function makeResizer(handle, axis, varName, lsKey){
  let drag=false;
  handle.addEventListener('pointerdown',e=>{ drag=true; handle.classList.add('drag');
    handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove',e=>{ if(!drag) return;
    const r=app.getBoundingClientRect(); let v;
    if(axis==='x'){ v=Math.max(360, Math.min(r.width-260, r.right-e.clientX)); }
    else         { v=Math.max(80,  Math.min(r.height*0.75, r.bottom-e.clientY)); }
    v=Math.round(v); app.style.setProperty(varName, v+'px'); localStorage.setItem(lsKey, v);
    try{chart.resize();}catch(err){}
  });
  const stop=()=>{ if(!drag) return; drag=false; handle.classList.remove('drag'); try{chart.resize();}catch(err){} if(axis==='y'){try{drawEquity();}catch(err){}} };
  handle.addEventListener('pointerup',stop); handle.addEventListener('pointercancel',stop);
}
makeResizer($('#rhMarkets'),'x','--markets-w','br_marketsW');
makeResizer($('#rhTrades'), 'y','--trades-h', 'br_tradesH');

// sinkron state awal — default hidden (kecuali user pernah set tampil '0')
{ const wh=localStorage.getItem('br_watchHidden'); setMarketsHidden(wh===null?true:wh==='1'); }
if(localStorage.getItem('br_newsOpen')==='1') setNewsOpen(true);   // restore News state (radio dgn Markets)
{ const oh=localStorage.getItem('br_orderHidden'); const hideOrder=(oh===null?true:oh==='1');
  $('#orderpanel').style.display=hideOrder?'none':''; $('#toggleOrder').classList.toggle('on',!hideOrder); }
const _coll=$('#bottompanel').classList.contains('collapsed');
app.style.setProperty('--trades-h', _coll?'36px':savedTradesH()+'px');
$('#toggleTrades').classList.toggle('on',!_coll);

