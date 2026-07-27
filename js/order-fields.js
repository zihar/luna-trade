// ===================== init =====================
$('#balance').value = localStorage.getItem('br_balance')||10000;
$('#riskPct').value  = localStorage.getItem('br_riskPct')||1;
$('#balance').addEventListener('input',()=>{ localStorage.setItem('br_balance',$('#balance').value); renderSizing(); renderAcct(); refreshLotSuggestion(); });
$('#riskPct').addEventListener('input', ()=>{ localStorage.setItem('br_riskPct',$('#riskPct').value);  renderSizing(); refreshLotSuggestion(); });
['slPips','tpPips','pipSize'].forEach(id=>$('#'+id).addEventListener('input',()=>{ renderOrderPanel(); renderSizing(); refreshLotSuggestion(); }));
// Field SL/TP bisa diisi manual: Price / P&L($) / Balance(%) → dihitung balik ke ticks (lot tetap)
(function(){
  const num=s=>{ const v=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isFinite(v)?v:NaN; };
  const ctx=()=>{ const cur=currentCandle(), ba=curBidAsk(), isSell=orderDir==='short';
    const entry=ba?(isSell?ba.bid:ba.ask):(cur?cur.close:null);
    const pip=+$('#pipSize').value||instSpec().pip, units=currentLots()*unitsPer();
    return { entry, pip, perTick:units*pip*quoteToUsd(entry||0), bal:+$('#balance').value||0 }; };
  const applyTicks=(which,ticks)=>{ if(!isFinite(ticks)) return;
    $(which==='sl'?'#slPips':'#tpPips').value=Math.max(1,Math.round(ticks));
    renderOrderPanel(); try{renderSizing();}catch(_){} try{refreshLotSuggestion();}catch(_){} try{drawDraftLines();}catch(_){} };
  const onPrice=w=>e=>{ const {entry,pip}=ctx(), p=num(e.target.value); if(entry==null||!isFinite(p)||pip<=0) return; applyTicks(w,Math.abs(p-entry)/pip); };
  const onPnl  =w=>e=>{ const {perTick}=ctx(), d=num(e.target.value); if(!isFinite(d)||perTick<=0) return; applyTicks(w,Math.abs(d)/perTick); };
  const onPct  =w=>e=>{ const {perTick,bal}=ctx(), p=num(e.target.value); if(!isFinite(p)||perTick<=0||bal<=0) return; applyTicks(w,Math.abs(p)/100*bal/perTick); };
  const bind=(id,fn)=>{ const el=$(id); if(el) el.addEventListener('input',fn); };
  bind('#slPrice',onPrice('sl')); bind('#tpPrice',onPrice('tp'));
  bind('#slPnl',  onPnl('sl'));   bind('#tpPnl',  onPnl('tp'));
  bind('#slPct',  onPct('sl'));   bind('#tpPct',  onPct('tp'));
})();
