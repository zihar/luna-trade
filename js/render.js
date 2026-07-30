// ===================== render =====================
function render(full){
  if(T==null) return;
  const boot=document.querySelector('.chart-boot'); if(boot) boot.remove();  // chart nyata siap → lepas placeholder
  const data=revealed(currentTF);
  // Bar Replay: forming bar (partial) valid sbg bar terakhir utk TF & cursor T saat ini?
  let hasPartial=false;
  if(replayMode && replayPartial && replayPartial.tf===currentTF && replayPartial.candle){
    const nextOpen = tfData[currentTF] && tfData[currentTF][data.length] ? tfData[currentTF][data.length].timestamp : null;
    if(replayPartial.candle.timestamp===nextOpen) hasPartial=true;
  }
  // Bar TUTUP: incremental. applyNewData HANYA saat full/boot/menyusut, atau saat partial lama harus
  // dibuang tanpa ada bar tutup baru yang menimpanya. Forming bar TAK PERNAH lewat applyNewData:
  // applyNewData menyentak viewport ke tepi kanan → pan/zoom user hilang tiap frame saat Play.
  // Dorong forming bar via updateData (sama seperti Live/pushFormingCandle) → posisi scroll
  // dipertahankan; auto-follow hanya terjadi bila user memang di tepi kanan (perilaku ala TradingView).
  // Jaring pengaman: klinecharts.updateData MEMBUANG datum yg timestamp-nya < bar terakhir di
  // chart (ChartStore.addData, tanpa error). Kalau bar terakhir di chart lebih baru dari bar
  // tutup yang mau di-push (mis. forming bar sempat melompat periode), push incremental menelan
  // bar itu diam-diam — dan karena lastLen tetap maju, ia TAK PERNAH dicoba lagi → lubang
  // permanen sampai reload. Deteksi & sembuhkan dgn satu applyNewData (viewport tersentak ke
  // tepi kanan, tapi ini jalur pemulihan data rusak, bukan jalur normal).
  let stale=false;
  if(data.length>lastLen && lastLen>=0){
    const cl=chart.getDataList();
    stale = cl.length>0 && data[lastLen].timestamp < cl[cl.length-1].timestamp;
  }
  const needFull = full || lastLen<0 || data.length<lastLen || stale
                 || (chartHasPartial && !hasPartial && data.length===lastLen);
  if(needFull){ chart.applyNewData(data); }
  else if(data.length>lastLen){ for(let k=lastLen;k<data.length;k++) chart.updateData(data[k]); }
  // Forming bar: timestamp selalu = open bar berikutnya → saat bar itu benar-benar menutup,
  // updateData(dataTutup) menimpanya di tempat (transisi partial→closed mulus, tak ada bar nyangkut).
  if(hasPartial) chart.updateData(replayPartial.candle);
  chartHasPartial=hasPartial;
  lastLen=data.length;
  drawPaperLines();
  drawPendingLines();
  drawAlertLines();
  updateOpenTradeBox();
  renderAcct();
  updateOrderBtns();
  refreshLotSuggestion();
  if(live) pushFormingCandle();   // re-append candle berjalan setelah data di-redraw
  updatePriceTimer();
  try{ repositionNewsMarkers(); }catch(e){}   // marker ikut pan/zoom/TF/playback
  try{ updateChartLegend(); }catch(e){}       // baris info instrumen match data yg dimuat (inst/TF)
}
// ---- sizing berbasis lot (ala TradeLocker), Risk% sebagai kalkulator ----
// logam (XAU/XAG): 1 lot = 100 oz (konvensi TradeLocker). units di-kawat tetap = oz (1 oz = 1 unit).
function unitsPer(){ return inst.includes('BTC')?1 : (inst.includes('XAU')||inst.includes('XAG'))?100 : 100000; }
// TP berbasis jarak (ticks) ala TradeLocker: RR diturunkan dari tpPips/slPips
function rrVal(){ const sp=+$('#slPips').value||0, tpp=+$('#tpPips').value||0; return sp>0 ? tpp/sp : 0; }
function lotUnitName(){ return inst.includes('BTC')?'BTC' : 'lots'; }
function lotStepSize(){ return inst.includes('BTC')?0.01 : 0.01; }
function lotDec(){ return inst.includes('BTC')?4 : 2; }
function currentLots(){ return Math.max(0,+$('#lotInput').value||0); }
function setLots(v){ const el=$('#lotInput'); if(el){ el.value=Math.max(0,v).toFixed(lotDec()); } renderOrderPanel(); try{renderSizing();}catch(e){} }
// bid/ask: mode Live + stream tersambung → harga pasar NYATA; selain itu (replay/paper) sintetis dari candle.
function curBidAsk(){
  if(live && priceConnected){ const t=liveTicks[inst]; if(t) return {bid:t.bid, ask:t.ask, mid:(t.bid+t.ask)/2}; }
  const c=currentCandle(); if(!c) return null; const pip=+$('#pipSize').value||instSpec().pip; const s=pip*1.6; return {bid:c.close-s/2, ask:c.close+s/2, mid:c.close};
}
function suggestLotsFromRisk(){
  const cur=currentCandle(); if(!cur) return null;
  const bal=+$('#balance').value||0, rp=+$('#riskPct').value||0;
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value;
  if(!(slp>0)) return null;
  const u=unitsFromRisk(bal,rp,cur.close,cur.close-slp*pip);
  return u/unitsPer();
}
// saran lot dari Risk% terus berjalan meski ada posisi terbuka — tiket berikutnya tetap perlu
// disarankan ukurannya (cermin Live). Hanya `lotsManual` & toggle Risk yang menghentikannya.
function refreshLotSuggestion(){ if(lotsManual||!$('#riskOn').checked) return; const s=suggestLotsFromRisk(); if(s!=null) setLots(s); }
// harga dgn pemisah ribuan (ala TradeLocker): 4,117.74 / 1.14088
function fmtPx(p){ if(p==null||isNaN(p)) return '—';
  return (+p).toLocaleString('en-US',{minimumFractionDigits:priceDecimals(),maximumFractionDigits:priceDecimals()}); }
const usdGrp=v=>'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
// render ticket order: simbol, tab arah, exec button, SL/TP sub, Init. Margin
function updateOrderBtns(){ renderOrderPanel(); }
// header price block: harga mid live + %change harian + bid/ask (instrumen aktif)
function renderHeaderPrice(){
  const box=$('#hdrPx'); if(!box) return;
  const lt=liveTicks[inst], q=quoteCache[inst], dec=priceDecimals(), pip=pipOf(inst);
  let bid, ask;
  if(lt){ bid=lt.bid; ask=lt.ask; }
  else if(q){ const s=pip*1.6; bid=q.last-s/2; ask=q.last+s/2; }
  const lastEl=$('#hdrLast'), chgEl=$('#hdrChg'), baEl=$('#hdrBa');
  if(bid==null||ask==null||!isFinite(bid)||!isFinite(ask)){
    box.classList.remove('has'); lastEl.textContent='—'; chgEl.textContent=''; chgEl.className='hdr-chg'; baEl.textContent=''; return;
  }
  box.classList.add('has');
  const mid=(bid+ask)/2, chg=q?q.chg:null;
  lastEl.textContent=fmtPx(mid);
  if(chg==null){ chgEl.textContent=''; chgEl.className='hdr-chg'; }
  else { const up=chg>=0; chgEl.textContent=(up?'▲ +':'▼ ')+chg.toFixed(2)+'%'; chgEl.className='hdr-chg '+(up?'up':'down'); }
  baEl.textContent=bid.toFixed(dec)+' / '+ask.toFixed(dec);
}
function renderOrderPanel(){
  document.querySelectorAll('.j-sym').forEach(s=>s.textContent=dispSym(inst));
  const flagHtml = ipkPair(inst);   // dual-chip identik picker (pengganti emoji generik)
  document.querySelectorAll('.j-flag').forEach(f=>f.innerHTML=flagHtml);
  const lu=$('#lotUnit'); if(lu) lu.textContent=lotUnitName();
  const cur=currentCandle(), ba=curBidAsk();
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal();
  const bal=+$('#balance').value||0, lots=currentLots(), units=lots*unitsPer();
  const isSell=orderDir==='short';
  // entry acuan: harga eksekusi (ask utk buy, bid utk sell)
  const entry = ba ? (isSell?ba.bid:ba.ask) : (cur?cur.close:null);
  // tombol eksekusi
  const ex=$('#execBtn');
  if(ex){ ex.className='op3-exec '+(isSell?'dir-sell':'dir-buy');
    ex.innerHTML = entry!=null ? `${isSell?'SELL':'BUY'} <span class="op3-exec-num">${lots.toFixed(lotDec())} @ ${fmtPx(entry)}</span>` : (isSell?'SELL':'BUY'); }
  // tombol harga mode simple (sell=bid, buy=ask)
  const dsx=$('#dealSellPx'), dbx=$('#dealBuyPx'), fb=cur?fmtPx(cur.close):'—';
  if(dsx) dsx.textContent = ba ? fmtPx(ba.bid) : fb;
  if(dbx) dbx.textContent = ba ? fmtPx(ba.ask) : fb;
  // simple: SL/TP/Risk OFF → dua tombol SELL|BUY; ada yg ON → satu arah (dir-pill + satu tombol)
  const anyStage = $('#riskOn').checked || $('#slOn').checked || $('#tpOn').checked;
  const dealTwo=$('#dealTwo'), dealOneWrap=$('#dealOneWrap'), dirPill=$('#dirPill');
  if(dealTwo && dealOneWrap){
    const expanded=!!$('#orderForm').querySelector('.op2.expanded');
    dealTwo.hidden=anyStage; dealOneWrap.hidden=!anyStage;
    const step=$('#lotStepper'), slot = expanded ? $('#expStepSlot') : (anyStage ? $('#oneStepSlot') : $('#dealStepSlot'));
    if(step && slot && step.parentElement!==slot) slot.appendChild(step);
    if(dirPill){ dirPill.className='op3-pill dir-pill '+(isSell?'dir-sell':'dir-buy'); dirPill.textContent=(isSell?'SELL':'BUY')+' ⇄'; dirPill.hidden=!anyStage; }
    const one=$('#dealOne');
    if(one){ one.className='op3-exec dir-'+(isSell?'sell':'buy');
      one.innerHTML = entry!=null ? `${isSell?'SELL':'BUY'} <span class="op3-exec-num">${lots.toFixed(lotDec())} @ ${fmtPx(entry)}</span>` : (isSell?'SELL':'BUY'); }
  }
  // chips & pill (simple) — cermin dari state kanonik
  const pill=$('#opTypePill'); if(pill) pill.textContent=(ordType()==='pending'?'PENDING':'MARKET')+' ⇄';
  const syncChip=(id,on)=>{ const c=$(id); if(c) c.classList.toggle('on',on); };
  syncChip('#chipRisk',$('#riskOn').checked); syncChip('#chipSL',$('#slOn').checked); syncChip('#chipTP',$('#tpOn').checked);
  // header SL/TP biru saat aktif + Trail toggle
  const slOn=$('#slOn').checked, tpOn=$('#tpOn').checked;
  const slc=$('#slCard'), tpc=$('#tpCard'), trb=$('#trailBtn');
  if(slc) slc.classList.toggle('on',slOn);
  if(tpc) tpc.classList.toggle('on',tpOn);
  if(trb) trb.classList.toggle('on',$('#trailOn').checked);
  // dim kolom SL/TP saat nonaktif
  document.querySelectorAll('.tl-cell.sl').forEach(c=>c.classList.toggle('off',!slOn));
  document.querySelectorAll('.tl-cell.tp').forEach(c=>c.classList.toggle('off',!tpOn));
  const set=(id,v)=>{ const e=$(id); if(e) e.textContent=v; };
  // field input SL/TP: set .value tapi JANGAN timpa field yg sedang diketik user
  const setF=(id,v)=>{ const e=$(id); if(e && e!==document.activeElement) e.value=v; };
  // editor "stage" (simple): tampil/sembunyi baris + nilai ticks/risk
  const sgRisk=$('#stageRisk'), sgSL=$('#stageSL'), sgTP=$('#stageTP');
  if(sgRisk) sgRisk.hidden=!$('#riskOn').checked;
  if(sgSL) sgSL.hidden=!slOn;
  if(sgTP) sgTP.hidden=!tpOn;
  set('#stgRiskV', (+$('#riskPct').value||0)+'%');
  set('#stgSLV', String(slp)); set('#stgTPV', String(+$('#tpPips').value||0));
  const sug=suggestLotsFromRisk(); set('#stgRiskOut', sug!=null?('≈ '+sug.toFixed(lotDec())+' '+lotUnitName()):'—');
  // grid Price / Ticks / P&L / Balance + output stage SL/TP
  if(entry!=null){
    const slDist=slp*pip, sl=isSell?entry+slDist:entry-slDist, tp=isSell?entry-slDist*rr:entry+slDist*rr;
    const loss=Math.abs(pnlUsd(orderDir,entry,sl,units)), rew=Math.abs(pnlUsd(orderDir,entry,tp,units));
    setF('#slPrice', fmtPx(sl)); setF('#tpPrice', fmtPx(tp));
    setF('#slPnl', loss.toFixed(2)); setF('#slPct', bal?(loss/bal*100).toFixed(2):'0.00');
    setF('#tpPnl', rew.toFixed(2)); setF('#tpPct', bal?(rew/bal*100).toFixed(2):'0.00');
    set('#stgSLOut', `${fmtPx(sl)} · −${usdGrp(loss)} / −${bal?(loss/bal*100).toFixed(2):'0.00'}%`);
    set('#stgTPOut', `${fmtPx(tp)} · +${usdGrp(rew)} / +${bal?(rew/bal*100).toFixed(2):'0.00'}%`);
  } else { ['#slPrice','#tpPrice','#slPnl','#slPct','#tpPnl','#tpPct'].forEach(id=>setF(id,'')); }
  // Init. Margin (tampil di simple & expand)
  document.querySelectorAll('.op3-margin').forEach(mEl=>{
    if(cur){ const margin=units*cur.close*quoteToUsd(cur.close)/100;   // leverage 100
      mEl.innerHTML=`<span class="mtxt">Init. Margin: <b>~${usdGrp(margin)}</b> <span class="muted">(${bal?(margin/bal*100).toFixed(2):'0.00'}%)</span></span>`;
    } else mEl.innerHTML='<span class="mtxt">Init. Margin: —</span>'; });
  try{ drawDraftLines(); }catch(e){}   // garis draft SL/TP di chart (sebelum order)
}

