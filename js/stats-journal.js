// ===================== stats & journal =====================
function renderStats(){
  if(spActive()){ spRenderStats(); return; }   // statistik live = server
  const n=journal.length, wins=journal.filter(t=>t.r>0).length;
  const totR=journal.reduce((s,t)=>s+t.r,0);
  const gW=journal.filter(t=>t.r>0).reduce((s,t)=>s+t.r,0);
  const gL=Math.abs(journal.filter(t=>t.r<0).reduce((s,t)=>s+t.r,0));
  $('#stTrades').textContent=n;
  $('#stWin').textContent=n?Math.round(wins/n*100)+'%':'—';
  const rEl=$('#stR'); rEl.textContent=(totR>=0?'+':'')+totR.toFixed(1); rEl.className='v '+(totR>=0?'pos':'neg');
  $('#stPF').textContent=gL?(gW/gL).toFixed(2):(gW?'∞':'—');
  // ---- metrik $ (hanya record yang punya pnlCcy/balanceAfter; back-compat record lama dilewati) ----
  const pnlRecs=journal.filter(t=>t.pnlCcy!=null);
  const net=pnlRecs.reduce((s,t)=>s+t.pnlCcy,0);
  const netEl=$('#stNet');
  if(pnlRecs.length){ netEl.textContent=(net>=0?'+$':'-$')+Math.abs(net).toFixed(2); netEl.className='v '+(net>=0?'pos':'neg'); }
  else { netEl.textContent='—'; netEl.className='v'; }
  // max drawdown ($) dari kurva equity
  const recs=journal.filter(t=>t.balanceAfter!=null);
  let dd=0;
  if(recs.length){ const start=recs[0].balanceAfter-(recs[0].pnlCcy||0); let peak=start;
    recs.forEach(t=>{ peak=Math.max(peak,t.balanceAfter); dd=Math.max(dd,peak-t.balanceAfter); }); }
  $('#stDD').textContent=recs.length?'$'+dd.toFixed(2):'—';
  // expectancy = rata-rata R per trade
  $('#stExp').textContent=n?((totR/n>=0?'+':'')+(totR/n).toFixed(2)+'R'):'—';
  drawEquity();
}
function drawEquity(){
  const cv=$('#equityCurve'); if(!cv) return;
  const ctx=cv.getContext('2d'); const dpr=window.devicePixelRatio||1;
  const w=cv.clientWidth||300, h=cv.clientHeight||96;
  cv.width=w*dpr; cv.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  const recs=journal.filter(t=>t.balanceAfter!=null);
  if(!recs.length){ ctx.fillStyle=getCSS('--muted'); ctx.font='11px '+getCSS('--font-num');
    ctx.fillText('Belum ada trade selesai (mode $).',8,h/2); return; }
  const start=recs[0].balanceAfter-(recs[0].pnlCcy||0);
  const pts=[start,...recs.map(r=>r.balanceAfter)];
  const mn=Math.min(...pts), mx=Math.max(...pts), rng=(mx-mn)||1;
  const X=i=>2+i/(pts.length-1||1)*(w-4);
  const Y=v=>h-5-(v-mn)/rng*(h-10);
  // baseline modal awal
  ctx.strokeStyle=getCSS('--border'); ctx.setLineDash([4,4]); ctx.beginPath();
  ctx.moveTo(0,Y(start)); ctx.lineTo(w,Y(start)); ctx.stroke(); ctx.setLineDash([]);
  // garis equity
  ctx.strokeStyle=getCSS('--accent'); ctx.lineWidth=1.6; ctx.beginPath();
  pts.forEach((v,i)=> i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v))); ctx.stroke();
}
function getCSS(v){ return getComputedStyle(document.body).getPropertyValue(v).trim()||'#4a71ff'; }
// bar metrik akun: Balance (realized) · Open P/L (floating) · Equity
function renderAcct(){
  if(spActive()){ spRenderAcct(); return; }   // akun live = server
  const bal=+$('#balance').value||0;
  let openPnl=0; { const cur=currentCandle();
    if(cur) trades.forEach(t=>{ openPnl+=pnlUsd(t.dir,t.entry,replayMarkPx(t.dir,cur.close),t.units||0); }); }
  const eq=bal+openPnl;
  const usd=v=>'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  $('#acBal').textContent=usd(bal);
  const o=$('#acOpen'); o.textContent=(openPnl>=0?'+':'-')+usd(Math.abs(openPnl)); o.className=openPnl>=0?'pos':'neg';
  $('#acEq').textContent=usd(eq);
  let margin=0; trades.forEach(t=>{ margin+=(t.units||0)*t.entry*quoteToUsd(t.entry)/100; });   // leverage 100
  const m=$('#acMargin'); if(m) m.textContent=usd(margin);
  const fm=$('#acFree'); if(fm) fm.textContent=usd(eq-margin);
}
