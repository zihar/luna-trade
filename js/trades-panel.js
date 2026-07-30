// ===================== panel Trades (tabel posisi ala TradeLocker) =====================
let activeTradeTab = localStorage.getItem('br_tradeTab') || 'positions';
const usdFmt = v => (v<0?'-$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const sideCls = d => d==='long'?'t-side-buy':'t-side-sell';
const sideTxt = d => '<span class="t-side-pill">'+(d==='long'?'Buy':'Sell')+'</span>';
function thRow(cols){ return '<tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr>'; }
function emptyRow(span,title,hint,icon){ return `<tr><td class="tp-empty" colspan="${span}">`+
  (icon?`<div class="tp-empty-ic">${icon}</div>`:'')+
  `<div class="tp-empty-t">${title}</div>`+
  (hint?`<div class="tp-empty-h">${hint}</div>`:'')+`</td></tr>`; }

function renderTrades(){
  if(spActive()){ spRenderTrades(); return; }   // posisi/closed live = server
  // jumlah di tab
  $('#tpNPos').textContent  = trades.length;
  $('#tpNPend').textContent = pending?1:0;
  // aktifkan tab + pane
  document.querySelectorAll('#tpTabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===activeTradeTab));
  const isStats = activeTradeTab==='stats';
  $('#paneTable').hidden = isStats;
  $('#paneStats').hidden = !isStats;
  if(isStats){ try{renderStats();}catch(e){} return; }

  const head=$('#tpHead'), body=$('#tpBody');
  const sym=dispSym(inst);
  const cur=currentCandle();
  if(activeTradeTab==='positions'){
    head.innerHTML=thRow(['Instrument','Side','Size','Entry / Market','Stop Loss','Take Profit','Margin','Profit & Loss','Actions']);
    if(!trades.length){ body.innerHTML=emptyRow(9,'No open positions','Pick an instrument in Markets, then Buy or Sell to open one.','☾'); return; }
    const t0=trades[0];
    const mkt=cur?cur.close:t0.entry;
    const pl=pnlUsd(t0.dir,t0.entry,mkt,t0.units||0);
    const margin=(t0.units||0)*t0.entry*quoteToUsd(t0.entry)/100;
    body.innerHTML=`<tr>
      <td><b>${sym}</b></td>
      <td class="${sideCls(t0.dir)}">${sideTxt(t0.dir)}</td>
      <td>${lotLabel(t0.units||0)}</td>
      <td>${fmt(t0.entry)} / ${fmt(mkt)}</td>
      <td>${fmt(t0.sl)}</td>
      <td>${fmt(t0.tp)}</td>
      <td>${usdFmt(margin)}</td>
      <td class="${pl>=0?'t-pos':'t-neg'}">${pl>=0?'+':''}${usdFmt(pl)}</td>
      <td class="t-act"><button data-act="close" data-id="${t0.id}">Close</button></td></tr>`;
  } else if(activeTradeTab==='pending'){
    head.innerHTML=thRow(['Instrument','Side','Type','Entry','Stop Loss','Take Profit','Size','Actions']);
    if(!pending){ body.innerHTML=emptyRow(8,'No pending orders','Switch the order ticket to Pending to place one away from price.'); return; }
    body.innerHTML=`<tr>
      <td><b>${sym}</b></td>
      <td class="${sideCls(pending.dir)}">${sideTxt(pending.dir)}</td>
      <td style="text-transform:capitalize">${pending.type}</td>
      <td>${fmt(pending.entry)}</td>
      <td>${fmt(pending.sl)}</td>
      <td>${fmt(pending.tp)}</td>
      <td>${lotLabel(pending.units||0)}</td>
      <td class="t-act"><button data-act="cancel">Cancel</button></td></tr>`;
  } else { // closed
    head.innerHTML=thRow(['Instrument','Side','Size','Entry','Exit','R','Profit & Loss','Closed (NY)']);
    if(!journal.length){ body.innerHTML=emptyRow(8,'No closed positions','Trades you close will show up here.'); return; }
    body.innerHTML=journal.slice().reverse().map(t=>`<tr>
      <td><b>${sym}</b></td>
      <td class="${sideCls(t.dir)}">${sideTxt(t.dir)}${t.partial?' ½':''}</td>
      <td>${t.units!=null?lotLabel(t.units):'—'}</td>
      <td>${fmt(t.entry)}</td>
      <td>${fmt(t.exit)}</td>
      <td class="${t.r>0?'t-pos':'t-neg'}">${t.r>0?'+':''}${t.r.toFixed(2)}R</td>
      <td class="${(t.pnlCcy||0)>=0?'t-pos':'t-neg'}">${t.pnlCcy!=null?((t.pnlCcy>=0?'+':'')+usdFmt(t.pnlCcy)):'—'}</td>
      <td style="color:var(--muted)">${nyTime(t.exitTime||t.time).slice(5)}</td></tr>`).join('');
  }
}
// kompat: pemanggil lama renderJournal() → render tabel posisi
function renderJournal(){ renderTrades(); }
// pindah tab
document.querySelectorAll('#tpTabs button').forEach(b=>b.onclick=()=>{
  activeTradeTab=b.dataset.tab; localStorage.setItem('br_tradeTab',activeTradeTab);
  if($('#bottompanel').classList.contains('collapsed')) toggleTrades();   // buka kalau ke-collapse
  renderTrades();
});
// aksi per baris (Close / Cancel)
$('#tpBody').addEventListener('click',e=>{ const b=e.target.closest('button[data-act]'); if(!b) return;
  const a=b.dataset.act;
  if(a==='close'){ const c=currentCandle(); if(c) closeTrade(+b.dataset.id, c.close, c.timestamp); }
  else if(a==='cancel') cancelPending();
});
// aksi tutup posisi akun live (server) per baris
$('#tpBody').addEventListener('click',e=>{ const b=e.target.closest('button[data-sp-close]'); if(b) spClose(+b.dataset.spClose); });
function saveJournal(){ localStorage.setItem('br_journal',JSON.stringify(journal)); }
function loadJournal(){ try{journal=JSON.parse(localStorage.getItem('br_journal'))||[]}catch(e){journal=[]} }
$('#resetBtn').onclick=()=>{ if(spActive()){ setStatus("Reset only applies in Bar Replay — live accounts can't be cleared.",true); return; } if(confirm('Delete all trade history?')){ journal=[]; resetTrade(); saveJournal(); renderStats(); renderTrades(); } };
function resetTrade(){
  clearPendingLines(); pending=null;
  trades=[]; replaySeq=0;
  try{ drawPaperLines(); }catch(e){}   // bersihkan garis/pill on-chart posisi replay
}

