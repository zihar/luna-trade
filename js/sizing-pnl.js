// ===================== sizing & P&L (Fase 1a) — akun USD =====================
// Spec instrumen: pip & mata uang quote. Konversi P&L ke USD:
//   quote USD  → faktor 1 (exact)              ·  pair USD_* → 1/price (exact)
//   cross JPY  → asumsi USD/JPY (approx; cross-rate penuh = Fase 2)
const INSTRUMENT = {
  EUR_USD:{pip:0.0001,quote:'USD'}, GBP_USD:{pip:0.0001,quote:'USD'}, AUD_USD:{pip:0.0001,quote:'USD'},
  NZD_USD:{pip:0.0001,quote:'USD'}, USD_CHF:{pip:0.0001,quote:'CHF'},
  USD_CAD:{pip:0.0001,quote:'CAD'}, USD_JPY:{pip:0.01,quote:'JPY'},
  GBP_JPY:{pip:0.01,quote:'JPY'},   EUR_JPY:{pip:0.01,quote:'JPY'},
  EUR_GBP:{pip:0.0001,quote:'GBP'}, AUD_JPY:{pip:0.01,quote:'JPY'},
  EUR_AUD:{pip:0.0001,quote:'AUD'}, GBP_AUD:{pip:0.0001,quote:'AUD'},
  XAU_USD:{pip:0.1,quote:'USD'},    XAG_USD:{pip:0.001,quote:'USD'},
  // Energy (CFD) — WTI/Brent/NatGas, pipLocation -2 (OANDA)
  WTICO_USD:{pip:0.01,quote:'USD'}, BCO_USD:{pip:0.01,quote:'USD'}, NATGAS_USD:{pip:0.01,quote:'USD'},
  // Indices (CFD). quote non-USD (EUR/GBP/AUD/HKD) → konversi P&L masih approx (lihat quoteToUsd).
  DXY:{pip:0.01,quote:'USD'},
  SPX500_USD:{pip:1,quote:'USD'}, NAS100_USD:{pip:1,quote:'USD'}, US30_USD:{pip:1,quote:'USD'},
  US2000_USD:{pip:0.01,quote:'USD'}, JP225_USD:{pip:1,quote:'USD'},
  DE30_EUR:{pip:1,quote:'EUR'}, FR40_EUR:{pip:1,quote:'EUR'}, EU50_EUR:{pip:1,quote:'EUR'},
  UK100_GBP:{pip:1,quote:'GBP'}, AU200_AUD:{pip:1,quote:'AUD'}, HK33_HKD:{pip:1,quote:'HKD'},
  // Crypto (CFD)
  BTC_USD:{pip:1,quote:'USD'}, ETH_USD:{pip:0.1,quote:'USD'}, LTC_USD:{pip:0.1,quote:'USD'}, BCH_USD:{pip:0.1,quote:'USD'},
};
const APPROX_USDJPY = 157;   // fallback cross JPY (akun USD; cross-rate penuh menyusul di Fase 2)
function instSpec(){ return INSTRUMENT[inst] || {pip:+$('#pipSize').value||0.0001, quote:'USD'}; }
// nilai 1 unit mata uang quote dalam USD pada harga `price`
function quoteToUsd(price){
  const q=instSpec().quote;
  if(q==='USD') return 1;
  if(inst.startsWith('USD_')) return price>0 ? 1/price : 0;   // USD_JPY, USD_CAD: price = quote per USD
  if(q==='JPY') return 1/APPROX_USDJPY;                        // cross JPY (approx)
  return 1;
}
// ukuran posisi (unit base) agar kerugian saat SL kena = balance·risk%
function unitsFromRisk(balance, riskPct, entry, sl){
  const riskUsd = balance*riskPct/100;
  const perUnitUsd = Math.abs(entry-sl) * quoteToUsd(entry);   // USD per 1 unit base
  return perUnitUsd>0 ? riskUsd/perUnitUsd : 0;
}
// P&L dalam USD untuk posisi `units` unit base
function pnlUsd(dir,entry,exit,units){
  const mul = dir==='long'?1:-1;
  return (exit-entry)*mul*units*quoteToUsd(exit);
}
// Spread sintetis Bar Replay. Live memakai bid/ask sungguhan dari Hub; replay tak punya tick,
// jadi ia diturunkan dari candle dengan lebar yang SAMA seperti curBidAsk (js/render.js) —
// satu sumber angka supaya entry, valuasi, dan pemicu SL/TP tak pernah memakai spread berbeda.
function synthHalfSpread(){ return (+$('#pipSize').value||instSpec().pip)*1.6/2; }
// Harga mark/exit: long dinilai di bid, short di ask (cermin markPrice di paper.go).
// Akibatnya posisi baru langsung minus sebesar spread — sama seperti akun Live.
function replayMarkPx(dir, mid){ const h=synthHalfSpread(); return dir==='long' ? mid-h : mid+h; }
// Cermin sltpError (paper.go): tolak SL/TP yang sudah di dalam spread supaya posisi tak
// langsung stop-out. Short dinilai di ask, long di bid. Kalimatnya HARUS sama dengan versi
// Go — keduanya dipin test (paper_sltp_test.go & tests/trading/replay-live-parity.spec.js).
// Kembalikan pesan error, atau null bila valid / harga belum tersedia.
function validateSLTPReplay(dir, sl, tp, bid, ask){
  if(!(bid>0) || !(ask>0)) return null;
  if(dir==='short'){
    if(sl!=null && sl<=ask) return 'Stop Loss is inside the spread — place it above the Ask price.';
    if(tp!=null && tp>=ask) return 'Take Profit is inside the spread — place it below the Ask price.';
    return null;
  }
  if(sl!=null && sl>=bid) return 'Stop Loss is inside the spread — place it below the Bid price.';
  if(tp!=null && tp<=bid) return 'Take Profit is inside the spread — place it above the Bid price.';
  return null;
}
function lotLabel(units){
  if(inst.includes('BTC')) return units.toFixed(4)+' BTC';
  if(inst.includes('XAU')||inst.includes('XAG')) return (units/100).toFixed(2)+' lot';
  return (units/100000).toFixed(2)+' lot';
}
// readout ukuran posisi: pakai trade aktif kalau ada, kalau tidak → preview dari input
function renderSizing(){
  const box=$('#sizingBox'); if(!box) return;
  const bal=+$('#balance').value||0, rp=+$('#riskPct').value||0;
  let entry,sl,tp,dir;
  if(trades.length){ const t0=trades[0]; entry=t0.entry; sl=t0.sl; tp=t0.tp; dir=t0.dir; }
  else{
    const cur=currentCandle(); if(!cur){ box.innerHTML=''; return; }
    const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value, rr=rrVal();
    entry=cur.close; dir='long'; sl=entry-slp*pip; tp=entry+slp*pip*rr;
  }
  const units = trades.length ? (trades[0].units||0) : currentLots()*unitsPer();   // sizing berbasis lot
  const riskUsd=Math.abs(pnlUsd(dir,entry,sl,units));
  const rewUsd=Math.abs(pnlUsd(dir,entry,tp,units));
  const rr = Math.abs(entry-sl)>0 ? Math.abs(tp-entry)/Math.abs(entry-sl) : 0;
  const pctRisk = bal? riskUsd/bal*100 : 0;
  box.innerHTML =
    `<span>Size: <b>${lotLabel(units)}</b> · ${Math.round(units).toLocaleString('en-US')} u</span>`+
    `<span>Risk: <b class="neg">$${riskUsd.toFixed(2)}</b> (${pctRisk.toFixed(2)}%)</span>`+
    `<span>Reward: <b class="pos">$${rewUsd.toFixed(2)}</b></span>`+
    `<span>R:R <b>1:${rr.toFixed(2)}</b></span>`+
    (trades.length?'':`<span style="opacity:.7">(preview — entry = current price, dir long)</span>`);
}

// ===================== trade (drag garis) =====================
function openTrade(dir){
  if(T==null) return;   // banyak posisi diizinkan (cermin Live: tiap order = posisi baru)
  const cur=currentCandle(); if(!cur) return;
  const units=currentLots()*unitsPer();
  if(!(units>0)){ setStatus('Lot must be greater than 0.',true); return; }   // kalimat identik ServerPaperBroker
  const ba=curBidAsk();
  const entry = ba ? (dir==='short'?ba.bid:ba.ask) : cur.close;   // eksekusi di bid (sell) / ask (buy)
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal();
  const dist=slp*pip, dec=priceDecimals();
  // slp>0 wajib: tanpa guard ini SL/TP jatuh TEPAT di entry lalu kena instan (cermin ServerPaperBroker).
  let sl=null, tp=null;
  if(slp>0){
    if($('#slOn').checked) sl=+(dir==='long'?entry-dist:entry+dist).toFixed(dec);
    if($('#tpOn').checked) tp=+(dir==='long'?entry+dist*rr:entry-dist*rr).toFixed(dec);
  }
  const bad = ba ? validateSLTPReplay(dir,sl,tp,ba.bid,ba.ask) : null;
  if(bad){ toast(bad,'error'); return; }   // cermin 400 dari /api/order
  track('order',{dir,inst});
  const no=++replaySeq;
  trades.push({id:-no,no,dir,entry,sl,tp,risk:dist,units,
               trail: $('#trailOn').checked ? (+$('#trailPips').value||0)*pip : 0,
               instrument:inst, time:T, fillFrom:T});
  toast((dir==='long'?'BUY':'SELL')+' '+lotLabel(units)+' '+dispSym(inst)+' @ '+fmtFor(inst,entry),'success');
  clearDraftLines(); drawPaperLines(); updateOpenTradeBox(); renderAcct(); renderSizing();
}
// pindahkan 1 garis overlay tanpa membuat ulang (untuk trailing & drag pending)
function moveLine(id,value){ if(id==null) return; try{ chart.overrideOverlay({id, points:[{value}]}); }catch(e){} }

