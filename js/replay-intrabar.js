// ===== Bar Replay: eksekusi INTRA-BAR — fill SL/TP/pending & alert saat harga MENYENTUH level =====
// Bukan menunggu bar tutup. Telusuri sub-bar TF halus kronologis dari frontier fillT s/d toT, lalu
// checkPending→checkTrade→checkAlerts per sub-bar (urutan sentuh benar; SL prioritas dlm 1 sub-bar).
// fillT hanya-maju → Prev tak re-fire. Anti-lookahead: hanya sub-bar tutup ≤ toT. Khusus mode replay;
// jalur Live (SL/TP server-side + alert per-bar) tak disentuh. Fungsi cek dipakai apa adanya.
async function evalFills(toT){
  if(!replayMode || fillT==null){ fillT=toT; return; }   // masuk replay → set frontier tanpa fire
  if(toT<=fillT) return;                                   // mundur/diam → jangan re-fire
  const from=fillT;
  if(trade || pending || (alerts&&alerts.length)){
    let subs=null;
    const fineTF=pickFineTF(currentTF, DUR[currentTF]), arr=tfData[currentTF];
    if(fineTF && arr && arr.length){
      const fdur=DUR[fineTF], acc=[];
      let lo=0,h=arr.length; while(lo<h){const m=(lo+h)>>1; if(arr[m].timestamp<=toT) lo=m+1; else h=m;}
      for(let i=lo-1;i>=0;i--){                            // bar kasar beririsan (from,toT] — telusuri mundur
        const bOpen=arr[i].timestamp, bEnd=(i+1<arr.length?arr[i+1].timestamp:bOpen+DUR[currentTF]);
        if(bEnd<=from) break;                               // sudah sepenuhnya sebelum frontier → stop
        const win=await ensureFineWindow(fineTF,bOpen,bEnd);
        if(win && win.length){ for(const b of win){ const c=b.timestamp+fdur; if(c>from && c<=toT) acc.push(b); } }
        else if(bEnd>from && bEnd<=toT) acc.push(arr[i]);   // fetch sub-bar gagal → fallback bar kasar (tutup penuh ≤ toT, tanpa lookahead) drpd drop diam-diam
      }
      acc.sort((a,b)=>a.timestamp-b.timestamp); subs=acc;
    }
    if(subs==null){                                         // fallback: bar currentTF sendiri (≤M5 / fetch gagal)
      subs=[]; const d=DUR[currentTF];
      for(const b of (arr||[])){ const c=b.timestamp+d; if(c>from && c<=toT) subs.push(b); }
    }
    for(const b of subs){ checkPending(b); checkTrade(b); checkAlerts(b); }
  }
  if(toT>fillT) fillT=toT;                                  // frontier hanya-maju (anti dobel-fire saat konkuren)
}

// ---------- pending order (limit/stop) ----------
function placePending(dir){
  if(T==null){ setStatus('Load first.',true); return; }
  track('pending',{dir,inst});
  if(trade){ setStatus('Close position first (one position at a time).',true); return; }
  if(pending){ setStatus("There's already a pending — cancel it first.",true); return; }
  const cur=currentCandle(); if(!cur) return;
  const entry=+$('#pendEntry').value;
  if(!entry){ setStatus('Enter the pending Entry price first.',true); return; }
  const pip=+$('#pipSize').value, slp=+$('#slPips').value, rr=rrVal(), dist=slp*pip;
  const slOn=$('#slOn').checked, tpOn=$('#tpOn').checked;
  const sl = slOn ? (dir==='long'?entry-dist:entry+dist) : null;
  const tp = tpOn ? (dir==='long'?entry+dist*rr:entry-dist*rr) : null;
  const type = dir==='long' ? (entry<cur.close?'limit':'stop') : (entry>cur.close?'limit':'stop');
  pending={dir,type,entry,sl,tp,risk:dist,units:currentLots()*unitsPer(),
           trail: $('#trailOn').checked ? (+$('#trailPips').value||0)*pip : 0,
           time:cur.timestamp,lineEntry:null,lineSL:null,lineTP:null};   // waktu pembuatan → guard anti eval bar pra-pending saat re-tread
  clearDraftLines(); drawPendingLines(); updateOpenTradeBox();
  toast(dir.toUpperCase()+' '+type+' pending @ '+fmt(entry)+' — waiting to be touched.','success');
}
function drawPendingLines(){
  ['lineEntry','lineSL','lineTP'].forEach(k=>{ if(pending&&pending[k]){ try{chart.removeOverlay(pending[k]);}catch(e){} pending[k]=null; }});
  if(!pending) return;
  // drag Entry → geser SL & TP dengan delta yang sama (jaga jarak)
  pending.lineEntry=hline(pending.entry,'#4a71ff',v=>{ const d=v-pending.entry; pending.entry=v;
    if(pending.sl!=null){ pending.sl+=d; moveLine(pending.lineSL,pending.sl); }
    if(pending.tp!=null){ pending.tp+=d; moveLine(pending.lineTP,pending.tp); } });
  if(pending.sl!=null) pending.lineSL=hline(pending.sl,'#ff6f6f',v=>{ pending.sl=v; });
  if(pending.tp!=null) pending.lineTP=hline(pending.tp,'#54c88c',v=>{ pending.tp=v; });
}
function clearPendingLines(){ if(!pending) return; ['lineEntry','lineSL','lineTP'].forEach(k=>{ if(pending[k]){ try{chart.removeOverlay(pending[k]);}catch(e){} }}); }
function cancelPending(){ if(!pending) return; clearPendingLines(); pending=null; updateOpenTradeBox(); setStatus('Pending cancelled.'); }
function checkPending(c){
  if(!pending || trade) return;
  if(pending.time!=null && c.timestamp < pending.time) return;   // jangan isi dari bar SEBELUM pending dibuat (re-tread Prev)
  if(!(c.low<=pending.entry && pending.entry<=c.high)) return;   // belum tersentuh
  clearPendingLines();
  trade={dir:pending.dir,entry:pending.entry,sl:pending.sl,tp:pending.tp,risk:pending.risk,
         units:pending.units,trail:pending.trail,instrument:inst,time:c.timestamp,lineEntry:null,lineSL:null,lineTP:null};
  pending=null;
  drawPaperLines(); updateOpenTradeBox();
  toast('Pending executed @ '+fmt(trade.entry),'success');
}
// ---------- partial close ----------
function partialClose(frac){
  if(!trade) return;
  const cur=currentCandle(); if(!cur) return;
  const units=(trade.units||0)*frac, exit=cur.close, mul=trade.dir==='long'?1:-1;
  const pnlCcy=pnlUsd(trade.dir,trade.entry,exit,units);
  const r=((exit-trade.entry)*mul/(trade.risk||1e-9))*frac;
  let bal=(+$('#balance').value||0)+pnlCcy; $('#balance').value=bal.toFixed(2); localStorage.setItem('br_balance',bal.toFixed(2));
  journal.push({time:trade.time,exitTime:cur.timestamp,dir:trade.dir,entry:trade.entry,exit,r,units,pnlCcy,balanceAfter:bal,partial:true});
  trade.units-=units;
  saveJournal(); renderStats(); renderJournal(); updateOpenTradeBox(); renderAcct();
  toast('Partial close '+Math.round(frac*100)+'% @ '+fmt(exit),'success');
}
function closeTrade(exit,time){
  if(!trade) return;
  const mul=trade.dir==='long'?1:-1;
  const r=(exit-trade.entry)*mul/(trade.risk||1e-9);
  const units=trade.units||0;
  const pnlCcy=pnlUsd(trade.dir,trade.entry,exit,units);
  let bal=(+$('#balance').value||0)+pnlCcy;             // ledger: balance maju sesuai realized P&L
  $('#balance').value=bal.toFixed(2); localStorage.setItem('br_balance',bal.toFixed(2));
  journal.push({time:trade.time,exitTime:time,dir:trade.dir,entry:trade.entry,exit,r,units,pnlCcy,balanceAfter:bal});
  ['lineEntry','lineSL','lineTP'].forEach(k=>{ if(trade[k]){ try{chart.removeOverlay(trade[k]);}catch(e){} }});
  trade=null;
  saveJournal(); renderStats(); renderJournal(); updateOpenTradeBox(); renderAcct();
  try{ drawPaperLines(); }catch(e){}   // bersihkan garis/pill on-chart (paperLines[REPLAY_ID]) di semua jalur close
}
