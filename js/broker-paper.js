// ===================== broker abstraction (Fase 0) =====================
// Fasad order: seluruh UI memanggil broker.* sehingga aksi order ditulis sekali.
// ReplayBroker membungkus engine lokal yang sudah ada (R-based, simulasi).
// LiveBroker (eksekusi nyata ke OANDA) menyusul di Fase 2 — stub agar toggle siap.
const ReplayBroker = {
  mode:'replay',
  market(dir){ openTrade(dir); },
  closeMarket(){ if(trades.length) closeAllReplay(); if(pending) cancelPending(); },
  hasOpen(){ return trades.length>0; },
};
// ===================== Live Paper account (server, Fase 2b) =====================
// Saat BUKAN Bar Replay → akun aktif = saldo dummy server per-user. Order MARKET
// dikirim ke server; account bar + Positions/Closed ditarik dari server (polling).
// Saat Bar Replay → semua client-side (kode lama), server tak disentuh.
const SP = { account:null, positions:[], closed:[], timer:null };
function spActive(){ return !replayMode; }   // live-paper aktif saat bukan replay

async function spSync(){
  if(!spActive()) return;
  try{
    const [a,p,j] = await Promise.all([
      fetch('/api/account').then(r=>r.ok?r.json():null),
      fetch('/api/positions').then(r=>r.ok?r.json():null),
      fetch('/api/journal').then(r=>r.ok?r.json():null),
    ]);
    if(a) SP.account=a;
    if(p) SP.positions=p.positions||[];
    if(j) SP.closed=j.trades||[];
  }catch(e){}
  try{ renderAcct(); renderTrades(); drawPaperLines(); }catch(e){}
}
function spStartPolling(){ if(SP.timer) return; spSync(); SP.timer=setInterval(spSync,1500); }
function spStopPolling(){ if(SP.timer){ clearInterval(SP.timer); SP.timer=null; } }

// formatter sadar-instrumen (posisi server bisa beda pair dari chart aktif)
function decimalsFor(i){ return symDecimals(i); }   // delegasi ke sumber tunggal (baca IPK_META)
function fmtFor(i,v){ return v==null||isNaN(v)?'—':(+v).toFixed(decimalsFor(i)); }
function unitsPerFor(i){ return i.includes('BTC')?1 : (i.includes('XAU')||i.includes('XAG'))?100 : 100000; }
function lotLabelFor(i,u){ if(i.includes('BTC')) return u.toFixed(4)+' BTC'; if(i.includes('XAU')||i.includes('XAG')) return (u/100).toFixed(2)+' lot'; return (u/100000).toFixed(2)+' lot'; }

function uuid(){ try{ return crypto.randomUUID(); }catch(e){ return String(Date.now())+Math.random().toString(16).slice(2); } }
const ServerPaperBroker = {
  mode:'paper-live',
  async market(dir){
    const units = currentLots()*unitsPer();
    if(!(units>0)){ setStatus('Lot must be greater than 0.',true); return; }
    // SL/TP harga absolut (server akan memantau & auto-close). Dihitung dari estimasi entry FE.
    const ba=curBidAsk(), cur=currentCandle();
    const entry = ba ? (dir==='short'?ba.bid:ba.ask) : (cur?cur.close:null);
    const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal(), dist=slp*pip;
    const body={instrument:inst, side:dir==='long'?'buy':'sell', units, clientTag:uuid()};
    if(entry!=null && slp>0){
      if($('#slOn').checked) body.sl=+(dir==='long'?entry-dist:entry+dist).toFixed(priceDecimals());
      if($('#tpOn').checked) body.tp=+(dir==='long'?entry+dist*rr:entry-dist*rr).toFixed(priceDecimals());
    }
    const btn=$('#execBtn'); if(btn) btn.disabled=true;
    try{
      const r=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){ toast(d.error||'Order failed','error'); }
      else { clearDraftLines(); toast((dir==='long'?'BUY':'SELL')+' '+lotLabel(units)+' '+dispSym(inst)+' @ '+fmtFor(inst,d.entry),'success'); await spSync(); }
    }catch(e){ toast('Could not connect to the server','error'); }
    if(btn) btn.disabled=false;
  },
  closeMarket(){ spCloseAll(); },
  hasOpen(){ return SP.positions.length>0; },
};
async function spClose(id){
  try{
    const r=await fetch('/api/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) setStatus(d.error||'Close failed',true);
    else { toast('Closed #'+id+'  '+((d.pnlCcy>=0?'+':'')+usdFmt(d.pnlCcy)), d.pnlCcy>=0?'success':'info'); await spSync(); }
  }catch(e){ setStatus('Could not connect to the server',true); }
}
async function spCloseAll(){ for(const p of SP.positions.slice()){ await spClose(p.id); } }

function spRenderAcct(){
  const a=SP.account, usd=v=>'$'+(+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if(!a){ $('#acBal').textContent='—'; const o=$('#acOpen'); o.textContent='$0.00'; o.className=''; $('#acEq').textContent='—'; $('#acMargin').textContent='$0.00'; $('#acFree').textContent='—'; return; }
  $('#acBal').textContent=usd(a.balance);
  const o=$('#acOpen'); o.textContent=(a.unrealizedPl>=0?'+':'-')+usd(Math.abs(a.unrealizedPl)); o.className=a.unrealizedPl>=0?'pos':'neg';
  $('#acEq').textContent=usd(a.equity);
  $('#acMargin').textContent=usd(a.marginUsed);
  $('#acFree').textContent=usd(a.marginAvailable);
}
function spRenderTrades(){
  $('#tpNPos').textContent = SP.positions.length;
  $('#tpNPend').textContent = 0;
  document.querySelectorAll('#tpTabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===activeTradeTab));
  const isStats = activeTradeTab==='stats';
  $('#paneTable').hidden = isStats; $('#paneStats').hidden = !isStats;
  if(isStats){ spRenderStats(); return; }
  const head=$('#tpHead'), body=$('#tpBody');
  if(activeTradeTab==='positions'){
    head.innerHTML=thRow(['Instrument','Side','Size','Entry / Market','SL / TP','Margin','Profit & Loss','Actions']);
    if(!SP.positions.length){ body.innerHTML=emptyRow(8,'No open positions','Pick an instrument in Markets, then Buy or Sell to open one.','☾'); return; }
    body.innerHTML=SP.positions.map(p=>`<tr>
      <td><b>${dispSym(p.instrument)}</b></td>
      <td class="${sideCls(p.dir)}">${sideTxt(p.dir)}</td>
      <td>${lotLabelFor(p.instrument,p.units)}</td>
      <td>${fmtFor(p.instrument,p.entry)} / ${fmtFor(p.instrument,p.price)}</td>
      <td><span class="t-neg">${p.sl!=null?fmtFor(p.instrument,p.sl):'—'}</span> / <span class="t-pos">${p.tp!=null?fmtFor(p.instrument,p.tp):'—'}</span></td>
      <td>${usdFmt(p.margin)}</td>
      <td class="${p.unrealizedPl>=0?'t-pos':'t-neg'}">${p.unrealizedPl>=0?'+':''}${usdFmt(p.unrealizedPl)}</td>
      <td class="t-act"><button data-sp-close="${p.id}">Close</button></td></tr>`).join('');
  } else if(activeTradeTab==='pending'){
    head.innerHTML=thRow(['Instrument','Side','Type','Entry','Size','Actions']);
    body.innerHTML=emptyRow(6,'No pending orders','Live accounts are market-only — pending orders aren\'t available here.');
  } else { // closed
    head.innerHTML=thRow(['Instrument','Side','Size','Entry','Exit','Profit & Loss','Closed (NY)']);
    if(!SP.closed.length){ body.innerHTML=emptyRow(7,'No closed positions','Trades you close will show up here.'); return; }
    body.innerHTML=SP.closed.map(t=>`<tr>
      <td><b>${dispSym(t.instrument)}</b></td>
      <td class="${sideCls(t.dir)}">${sideTxt(t.dir)}</td>
      <td>${lotLabelFor(t.instrument,t.units)}</td>
      <td>${fmtFor(t.instrument,t.entry)}</td>
      <td>${fmtFor(t.instrument,t.exit)}</td>
      <td class="${t.pnlCcy>=0?'t-pos':'t-neg'}">${t.pnlCcy>=0?'+':''}${usdFmt(t.pnlCcy)}</td>
      <td style="color:var(--muted)">${nyTime(t.exitTime||t.openTime).slice(5)}</td></tr>`).join('');
  }
}
function spRenderStats(){
  const J=SP.closed, n=J.length, wins=J.filter(t=>t.pnlCcy>0).length;
  const gW=J.filter(t=>t.pnlCcy>0).reduce((s,t)=>s+t.pnlCcy,0);
  const gL=Math.abs(J.filter(t=>t.pnlCcy<0).reduce((s,t)=>s+t.pnlCcy,0));
  const net=J.reduce((s,t)=>s+t.pnlCcy,0);
  $('#stTrades').textContent=n;
  $('#stWin').textContent=n?Math.round(wins/n*100)+'%':'—';
  const rEl=$('#stR'); rEl.textContent='—'; rEl.className='v';                 // R butuh SL (n/a di paper market)
  $('#stPF').textContent=gL?(gW/gL).toFixed(2):(gW?'∞':'—');
  const netEl=$('#stNet'); if(n){ netEl.textContent=(net>=0?'+$':'-$')+Math.abs(net).toFixed(2); netEl.className='v '+(net>=0?'pos':'neg'); } else { netEl.textContent='—'; netEl.className='v'; }
  const recs=J.slice().reverse().filter(t=>t.balanceAfter!=null);             // SP.closed terbaru dulu → kronologis
  let dd=0; if(recs.length){ let peak=recs[0].balanceAfter-(recs[0].pnlCcy||0); recs.forEach(t=>{ peak=Math.max(peak,t.balanceAfter); dd=Math.max(dd,peak-t.balanceAfter); }); }
  $('#stDD').textContent=recs.length?'$'+dd.toFixed(2):'—';
  $('#stExp').textContent='—';
  // equity curve dari balanceAfter (kronologis)
  const cv=$('#equityCurve'); if(cv){ const ctx=cv.getContext('2d'), dpr=window.devicePixelRatio||1, w=cv.clientWidth||300, h=cv.clientHeight||96;
    cv.width=w*dpr; cv.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    if(!recs.length){ ctx.fillStyle=getCSS('--muted'); ctx.font='11px '+getCSS('--font-num'); ctx.fillText('Belum ada trade selesai.',8,h/2); }
    else { const start=recs[0].balanceAfter-(recs[0].pnlCcy||0), pts=[start,...recs.map(r=>r.balanceAfter)];
      const mn=Math.min(...pts), mx=Math.max(...pts), rng=(mx-mn)||1, X=i=>2+i/(pts.length-1||1)*(w-4), Y=v=>h-5-(v-mn)/rng*(h-10);
      ctx.strokeStyle=getCSS('--border'); ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(0,Y(start)); ctx.lineTo(w,Y(start)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle=getCSS('--accent'); ctx.lineWidth=1.6; ctx.beginPath(); pts.forEach((v,i)=> i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v))); ctx.stroke(); }
  }
}
// applyPaperMode mengaktifkan broker + render path sesuai mode (replay vs live).
function applyPaperMode(){
  if(replayMode){ broker=ReplayBroker; spStopPolling(); }
  else { broker=ServerPaperBroker; spStartPolling(); }
  try{ renderAcct(); renderTrades(); drawPaperLines(); }catch(e){}
}
let broker = ReplayBroker;

// dispatch BUY/SELL menurut jenis order (market via broker, atau pending lokal)
let orderDir = 'short';   // arah terpilih di tab Sell/Buy (default Sell, ala TradeLocker)
function ordType(){ const b=document.querySelector('#ordType button.on'); return b?b.dataset.t:'market'; }
function submitOrder(dir){
  if(spActive()){   // akun live: market-only (pending belum didukung server)
    if(ordType()==='pending'){ setStatus("Pending orders aren't supported on live accounts (market only).",true); return; }
    broker.market(dir); return;
  }
  if(ordType()==='pending') placePending(dir); else broker.market(dir);
}
// tab Sell | Buy → pilih arah
document.querySelectorAll('#dirSeg button').forEach(b=>b.onclick=()=>{
  orderDir=b.dataset.d;
  document.querySelectorAll('#dirSeg button').forEach(x=>x.classList.toggle('on',x===b));
  renderOrderPanel();
});
// tombol eksekusi besar (SELL/BUY 0.xx @ harga)
$('#execBtn').onclick=()=>submitOrder(orderDir);
$('#closeAllBtn').onclick=()=>{ if(spActive()){ spCloseAll(); return; } try{ broker.closeMarket(); }catch(e){} };
// tab Market | Pending
document.querySelectorAll('#ordType button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#ordType button').forEach(x=>x.classList.toggle('on',x===b));
  const pend=b.dataset.t==='pending';
  $('#pendEntryFld').style.display=pend?'':'none';
  if(pend && !$('#pendEntry').value){ const cur=currentCandle(); if(cur) $('#pendEntry').value=cur.close.toFixed(priceDecimals()); }
  renderOrderPanel();
});
// Risk checkbox → sizing by Risk% (lot auto) vs manual lot
$('#riskOn').onchange=()=>{ lotsManual=!$('#riskOn').checked; if(!lotsManual) refreshLotSuggestion(); renderSizing(); };
$('#slOn').onchange=$('#tpOn').onchange=()=>renderOrderPanel();   // klik label (#slCard/#tpCard) toggle native
$('#trailBtn').onclick=()=>{ const c=$('#trailOn'); c.checked=!c.checked; renderOrderPanel(); };
// lot stepper
function bumpLot(dir){ lotsManual=true; $('#riskOn').checked=false; const st=lotStepSize();
  setLots(Math.max(st, +(currentLots()+dir*st).toFixed(6))); }
$('#lotUp').onclick=()=>bumpLot(1);
$('#lotDown').onclick=()=>bumpLot(-1);
$('#lotInput').addEventListener('input',()=>{ lotsManual=true; $('#riskOn').checked=false; renderOrderPanel(); renderSizing(); });
// expand/collapse detail SL/TP
function setOpExpanded(on){ const op=$('#orderForm').querySelector('.op2'); if(!op) return;
  op.classList.toggle('expanded',on);
  // pindahkan stepper bersama ke slot mode aktif (satu node DOM, hindari ID ganda)
  const step=$('#lotStepper'), slot=on?$('#expStepSlot'):$('#dealStepSlot');
  if(step && slot && step.parentElement!==slot) slot.appendChild(step);
  renderOrderPanel(); }
$('#op2Expand').onclick=()=>setOpExpanded(true);
$('#op2Collapse').onclick=()=>setOpExpanded(false);
// mode simple: dua tombol harga = eksekusi satu klik
$('#dealSell').onclick=()=>submitOrder('short');
$('#dealBuy').onclick=()=>submitOrder('long');
// toggle arah (muncul saat SL/TP/Risk ON) + tombol eksekusi satu-arah
$('#dirPill').onclick=()=>{ orderDir = orderDir==='short'?'long':'short';
  document.querySelectorAll('#dirSeg button').forEach(x=>x.classList.toggle('on',x.dataset.d===orderDir));
  renderOrderPanel(); try{drawDraftLines();}catch(e){} };
$('#dealOne').onclick=()=>submitOrder(orderDir);
// mode simple: pill Market/Pending menyetir state kanonik (#ordType)
$('#opTypePill').onclick=()=>{
  const pend=ordType()!=='pending';
  document.querySelectorAll('#ordType button').forEach(x=>x.classList.toggle('on',x.dataset.t===(pend?'pending':'market')));
  $('#pendEntryFld').style.display=pend?'':'none';
  if(pend && !$('#pendEntry').value){ const cur=currentCandle(); if(cur) $('#pendEntry').value=cur.close.toFixed(priceDecimals()); }
  renderOrderPanel();
};
// mode simple: chip RISK/SL/TP membalik checkbox kanonik + panggil handler-nya
$('#chipRisk').onclick=()=>{ const c=$('#riskOn'); c.checked=!c.checked; c.onchange(); renderOrderPanel(); };
$('#chipSL').onclick=()=>{ const c=$('#slOn'); c.checked=!c.checked; renderOrderPanel(); };
$('#chipTP').onclick=()=>{ const c=$('#tpOn'); c.checked=!c.checked; renderOrderPanel(); };
// stepper editor stage (simple): ubah input kanonik (slPips/tpPips/riskPct) + re-render
document.querySelectorAll('.op3-stage-step button').forEach(b=>b.onclick=()=>{
  const key=b.dataset.stg, dir=+b.dataset.d, isPct=key==='riskPct', step=isPct?0.1:1;
  const el=$('#'+key); if(!el) return;
  let v=(+el.value||0)+dir*step; v=Math.max(isPct?0.1:1, v);
  el.value = isPct? v.toFixed(1) : String(Math.round(v));
  el.dispatchEvent(new Event('input',{bubbles:true}));
  renderOrderPanel(); renderSizing();
});
function updateOpenTradeBox(){
  // box status di atas order panel dihapus — P&L posisi ditampilkan langsung di chart.
  // Fungsi dipertahankan hanya untuk efek samping refresh sizing & daftar trade.
  renderSizing();
  try{renderTrades();}catch(e){}
}

