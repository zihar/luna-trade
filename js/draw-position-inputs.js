// ===================== Long/Short Position — setelan akun/risiko (tab Inputs ala TV) =====================
// Setelan per objek disimpan di objStyle[id] (field pos*) → ikut persist, sync server, copy/paste &
// clone tanpa skema baru. Nilai terakhir dipakai jadi default posisi berikutnya (localStorage
// `luna_pos_defaults`; lot disimpan PER INSTRUMEN karena 1 lot forex ≠ 1 lot emas).
// Semua nama di sini hanya dipanggil saat runtime (modal/render), tak ada referensi eager.

const POS_DEF_KEY='luna_pos_defaults';
const POS_FX_CCY=new Set(['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD']);

// ukuran 1 tick — sama dengan posFigures: emas 0.01 (TV 2 desimal), lainnya 10^-desimal
function posTickSize(){ return inst.includes('XAU') ? 0.01 : Math.pow(10,-priceDecimals()); }
// unit per lot: forex 100000, logam 100, lainnya (indeks/crypto/energi/saham) 1
function posDefaultLot(instName){
  const n=instName||inst||'';
  if(/^(XAU|XAG)_/.test(n)) return 100;
  const m=/^([A-Z]{3})_([A-Z]{3})$/.exec(n);
  return (m && POS_FX_CCY.has(m[1]) && POS_FX_CCY.has(m[2])) ? 100000 : 1;
}
function posDefaults(){ try{ return JSON.parse(localStorage.getItem(POS_DEF_KEY)||'{}')||{}; }catch(e){ return {}; } }
function posSettings(o){
  const st=(o&&objStyle[o.id])||{}, d=posDefaults();
  const pick=(a,b,c)=> a!=null?a : b!=null?b : c;
  return {
    account: pick(st.posAccount, d.account, +$('#balance').value||10000),
    lot:     pick(st.posLot, d.lot&&d.lot[inst], posDefaultLot()),
    risk:    pick(st.posRisk, d.risk, +$('#riskPct').value||1),
    riskUnit:pick(st.posRiskUnit, d.riskUnit, '%'),
    qtyPrec: pick(st.posQtyPrec, d.qtyPrec, 2),
  };
}
const POS_FIELD={account:'posAccount', lot:'posLot', risk:'posRisk', riskUnit:'posRiskUnit', qtyPrec:'posQtyPrec'};
function posValid(k,v){
  if(k==='riskUnit') return v==='%'||v==='USD';
  if(k==='qtyPrec') return Number.isInteger(v) && v>=0 && v<=8;
  return typeof v==='number' && isFinite(v) && v>0;
}
// tulis patch setelan; satu field tak valid → tolak SELURUHNYA (false), tak ada yang ditulis
function setPosSettings(o, patch){
  if(!o||!patch) return false;
  const keys=Object.keys(patch);
  if(!keys.length || keys.some(k=>!POS_FIELD[k] || !posValid(k,patch[k]))) return false;
  const sp={}; keys.forEach(k=>{ sp[POS_FIELD[k]]=patch[k]; });
  setObjStyle(o.id, sp);
  const d=posDefaults();
  keys.forEach(k=>{ if(k==='lot'){ d.lot=Object.assign({}, d.lot||{}, {[inst]:patch.lot}); } else d[k]=patch[k]; });
  try{ localStorage.setItem(POS_DEF_KEY, JSON.stringify(d)); }catch(e){}
  return true;
}
function posRiskUsd(s){ return s.riskUnit==='%' ? s.account*s.risk/100 : s.risk; }
function convertRisk(value, from, to, account){
  if(from===to) return value;
  return from==='%' ? account*value/100 : (account>0 ? value/account*100 : 0);
}
// hitungan dari titik objek (bisa overlay yang sedang dirender — tak lewat getOverlayById)
function posCalcPts(o, pts){
  if(!pts||pts.length<3||[0,1,2].some(i=>!pts[i]||pts[i].value==null)) return null;
  const entry=pts[0].value, tp=pts[1].value, sl=pts[2].value, tick=posTickSize();
  const s=posSettings(o), riskUsd=posRiskUsd(s);
  const perUnit=Math.abs(entry-sl)*quoteToUsd(entry);
  const qtyUnits=perUnit>0 ? riskUsd/perUnit : 0;
  return { entry, tp, sl,
    tpTicks:Math.round(Math.abs(tp-entry)/tick), slTicks:Math.round(Math.abs(entry-sl)/tick),
    riskUsd, qtyUnits, qtyLots:qtyUnits/s.lot,
    pnlTp: qtyUnits*Math.abs(tp-entry)*quoteToUsd(tp),
    pnlSl:-qtyUnits*Math.abs(entry-sl)*quoteToUsd(sl),
    rr: Math.abs(entry-sl) ? Math.abs(tp-entry)/Math.abs(entry-sl) : 0 };
}
function posCalc(o){
  let ov=null; try{ ov=chart.getOverlayById(o.id); }catch(e){}
  return posCalcPts(o, ov&&ov.points);
}
// Entry diketik → keenam titik bergeser sebesar selisihnya (jarak TP/SL dalam tick tetap, spt TV)
function applyPosEntry(o, v){
  if(typeof v!=='number' || !isFinite(v) || v<=0) return false;
  let ov=null; try{ ov=chart.getOverlayById(o.id); }catch(e){}
  if(!ov||!ov.points||ov.points.length<6) return false;
  const d=v-ov.points[0].value;
  const pts=ov.points.map(p=>Object.assign({},p,{value:p.value+d}));
  if(pts.some(p=>!(p.value>0))) return false;
  try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(e){ return false; }
  return true;
}
// level dari jumlah tick: bulat ≥1, sisi mengikuti arah (long: TP atas/SL bawah; short sebaliknya)
function applyPosTicks(o, which, n){
  if(!Number.isInteger(n) || n<1) return false;
  const lv=posLevels(o); if(!lv) return false;
  const up=(which==='tp')===(o.name==='longPosition');
  const v=lv.entry+(up?1:-1)*n*posTickSize();
  if(!(v>0)) return false;
  return applyPosLevel(o, which, v);
}
