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
// dibaca tiap frame render pill → parse hanya bila string mentahnya berubah (salinan, supaya aman dimutasi)
let posDefRaw=null, posDefObj={};
function posDefaults(){
  let raw=null; try{ raw=localStorage.getItem(POS_DEF_KEY); }catch(e){}
  if(raw!==posDefRaw){ posDefRaw=raw; try{ posDefObj=JSON.parse(raw||'{}')||{}; }catch(e){ posDefObj={}; } }
  return JSON.parse(JSON.stringify(posDefObj));
}
const POS_FIELD={account:'posAccount', lot:'posLot', risk:'posRisk', riskUnit:'posRiskUnit', qtyPrec:'posQtyPrec'};
function posValid(k,v){
  if(k==='riskUnit') return v==='%'||v==='USD';
  if(k==='qtyPrec') return Number.isInteger(v) && v>=0 && v<=8;
  return typeof v==='number' && isFinite(v) && v>0;
}
// kandidat pertama yang VALID menang (default korup / #balance negatif tak boleh sampai ke render)
function posSettings(o){
  const st=(o&&objStyle[o.id])||{}, d=posDefaults();
  const pick=(k,...c)=>c.find(v=>posValid(k,v));
  const unit=pick('riskUnit', st.posRiskUnit, d.riskUnit, '%');
  // risk tak boleh lepas dari unitnya: ambil dari sumber yang sama dengan unit
  const riskSrc=[st.posRiskUnit===unit?st.posRisk:null, d.riskUnit===unit?d.risk:null];
  return {
    account: pick('account', st.posAccount, d.account, +$('#balance').value, 10000),
    lot:     pick('lot', st.posLot, d.lot&&d.lot[inst], posDefaultLot()),
    risk:    pick('risk', ...riskSrc, unit==='%' ? +$('#riskPct').value : null, unit==='%' ? 1 : 100),
    riskUnit:unit,
    qtyPrec: pick('qtyPrec', st.posQtyPrec, d.qtyPrec, 2),
  };
}
// kunci setelan ke objek (dipanggil saat posisi baru dibuat): sesudahnya edit posisi lain /
// ubah #balance tak lagi menggeser Qty-nya. Objek lama tanpa snapshot tetap ikut default.
function snapshotPosSettings(o){
  if(!o || (objStyle[o.id]||{}).posAccount!=null) return;
  const s=posSettings(o), sp={}; Object.keys(POS_FIELD).forEach(k=>{ sp[POS_FIELD[k]]=s[k]; });
  setObjStyle(o.id, sp);
}
// tulis patch setelan; satu field tak valid → tolak SELURUHNYA (false), tak ada yang ditulis.
// Yang ditulis = setelan PENUH sesudah patch (objek & default), jadi risk selalu berpasangan dgn unitnya.
function setPosSettings(o, patch){
  if(!o||!patch) return false;
  const keys=Object.keys(patch);
  if(!keys.length || keys.some(k=>!POS_FIELD[k] || !posValid(k,patch[k]))) return false;
  const full=Object.assign(posSettings(o), patch), sp={};
  Object.keys(POS_FIELD).forEach(k=>{ sp[POS_FIELD[k]]=full[k]; });
  setObjStyle(o.id, sp);
  const d=posDefaults();
  Object.assign(d, {account:full.account, risk:full.risk, riskUnit:full.riskUnit, qtyPrec:full.qtyPrec});
  d.lot=Object.assign({}, d.lot||{}, {[inst]:full.lot});
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
// teks pill chart (dipanggil dari posFigures dgn overlay yang SEDANG dirender → pakai o.points)
const posUsd=v=>(v<0?'-':'+')+'$'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
function posPillTexts(o){
  const c=posCalcPts(o, o&&o.points); if(!c) return null;
  const dec=priceDecimals(), s=posSettings(o);
  const pip=parseFloat($('#pipSize').value)||0.0001;
  const lvl=(lbl,v,ticks)=>{ const d=Math.abs(v-c.entry);
    return lbl+'  '+v.toFixed(dec)+'   '+Math.round(d/pip)+'p · '+ticks+'t ('+(d/c.entry*100).toFixed(3)+'%)'; };
  const dir=o.name==='shortPosition'?'SHORT':'LONG';
  return { target: lvl('Target',c.tp,c.tpTicks)+'  '+posUsd(c.pnlTp),
           stop:   lvl('Stop',c.sl,c.slTicks)+'  '+posUsd(c.pnlSl),
           center: dir+' · Qty '+c.qtyLots.toFixed(s.qtyPrec)+' '+(s.lot===1?'units':'lot')+' · RR 1:'+c.rr.toFixed(2) };
}
