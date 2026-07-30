// ===== Bar Replay: eksekusi INTRA-BAR — fill SL/TP/pending & alert saat harga MENYENTUH level =====
// Bukan menunggu bar tutup. Telusuri sub-bar TF halus kronologis dari frontier fillT s/d toT, lalu
// checkPending→checkTrades→checkAlerts per sub-bar (urutan sentuh benar; SL prioritas dlm 1 sub-bar).
// fillT hanya-maju → Prev tak re-fire. Anti-lookahead: hanya sub-bar tutup ≤ toT. Khusus mode replay;
// jalur Live (SL/TP server-side + alert per-bar) tak disentuh. Fungsi cek dipakai apa adanya.
async function evalFills(toT){
  if(!replayMode || fillT==null){ fillT=toT; return; }   // masuk replay → set frontier tanpa fire
  if(toT<=fillT) return;                                   // mundur/diam → jangan re-fire
  const from=fillT;
  if(trades.length || pending || (alerts&&alerts.length)){
    let subs=null;
    const fineTF=pickFineTF(currentTF, DUR[currentTF]), arr=tfData[currentTF];
    if(fineTF && arr && arr.length){
      const fdur=DUR[fineTF], acc=[];
      let lo=0,h=arr.length; while(lo<h){const m=(lo+h)>>1; if(arr[m].timestamp<=toT) lo=m+1; else h=m;}
      for(let i=lo-1;i>=0;i--){                            // bar kasar beririsan (from,toT] — telusuri mundur
        const bOpen=arr[i].timestamp, bEnd=barEndAt(currentTF,i,arr);
        if(bEnd<=from) break;                               // sudah sepenuhnya sebelum frontier → stop
        const win=await ensureFineWindow(fineTF,bOpen,bEnd);
        if(win && win.length){ for(const b of win){ const c=b.timestamp+fdur; if(c>from && c<=toT) acc.push(b); } }
        else if(bEnd>from && bEnd<=toT) acc.push(arr[i]);   // fetch sub-bar gagal → fallback bar kasar (tutup penuh ≤ toT, tanpa lookahead) drpd drop diam-diam
      }
      acc.sort((a,b)=>a.timestamp-b.timestamp); subs=acc;
    }
    if(subs==null){                                         // fallback: bar currentTF sendiri (≤M5 / fetch gagal)
      subs=[];
      const src=arr||[];
      for(let i=0;i<src.length;i++){ const c=barEndAt(currentTF,i,src); if(c>from && c<=toT) subs.push(src[i]); }
    }
    for(const b of subs){ checkPending(b,b.timestamp); checkTrades(b,b.timestamp); checkAlerts(b); }
  }
  if(toT>fillT) fillT=toT;                                  // frontier hanya-maju (anti dobel-fire saat konkuren)
}

// ---------- pending order (limit/stop) ----------
function placePending(dir){
  if(T==null){ setStatus('Load first.',true); return; }
  track('pending',{dir,inst});
  // pending boleh berdampingan dengan posisi terbuka (cermin Live); tetap satu slot pending saja.
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
           time:cur.timestamp,fillFrom:cur.timestamp,lineEntry:null,lineSL:null,lineTP:null};   // waktu pembuatan → guard anti eval bar pra-pending saat re-tread
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
function checkPending(c, close){
  if(!pending) return;
  if(pending.fillFrom!=null && c.timestamp < pending.fillFrom) return;   // jangan isi dari bar SEBELUM pending dibuat (re-tread Prev)
  if(!(c.low<=pending.entry && pending.entry<=c.high)) return;   // belum tersentuh
  clearPendingLines();
  const no=++replaySeq;
  trades.push({id:-no,no,dir:pending.dir,entry:pending.entry,sl:pending.sl,tp:pending.tp,
    risk:pending.risk,units:pending.units,trail:pending.trail,instrument:inst,
    time:c.timestamp,fillFrom:c.timestamp});
  const entry=pending.entry; pending=null;
  drawPaperLines(); updateOpenTradeBox();
  toast('Pending executed @ '+fmt(entry),'success');
}
function closeTrade(id,exit,time){
  const i=trades.findIndex(t=>t.id===id); if(i<0) return;
  const t=trades[i];
  const mul=t.dir==='long'?1:-1;
  const r=(exit-t.entry)*mul/(t.risk||1e-9);
  const units=t.units||0;
  const pnlCcy=pnlUsd(t.dir,t.entry,exit,units);
  let bal=(+$('#balance').value||0)+pnlCcy;             // ledger: balance maju sesuai realized P&L
  $('#balance').value=bal.toFixed(2); localStorage.setItem('br_balance',bal.toFixed(2));
  journal.push({time:t.time,exitTime:time,dir:t.dir,entry:t.entry,exit,r,units,pnlCcy,balanceAfter:bal});
  trades.splice(i,1);
  saveJournal(); renderStats(); renderJournal(); updateOpenTradeBox(); renderAcct();
  try{ drawPaperLines(); }catch(e){}   // bersihkan garis/pill on-chart di semua jalur close
}
// Tutup semua posisi replay di harga pasar saat ini (cermin spCloseAll di Live).
function closeAllReplay(){
  const c=currentCandle(); if(!c) return;
  trades.slice().forEach(t=>closeTrade(t.id,c.close,c.timestamp));
}
