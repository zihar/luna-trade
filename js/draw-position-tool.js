const DEFAULT_POS_RR = 3;  // klik tool → klik 1x di chart → posisi 1:3, lalu bisa di-adjust
// risk default = rata-rata range candle (ATR sederhana) TF aktif → ukuran selalu proporsional TF
function tfDefaultRisk(){
  const arr=revealed(currentTF), n=arr.length;
  if(n>=2){
    const k=Math.min(14,n); let sum=0;
    for(let i=n-k;i<n;i++) sum += (arr[i].high-arr[i].low);
    const avg=sum/k; if(avg>0) return avg;
  }
  return (parseFloat($('#slPips').value)||20)*(parseFloat($('#pipSize').value)||0.0001); // fallback
}
// 6 titik: 0 Entry-kiri(tengah) · 1 TP-kanan · 2 SL-kanan · 3 TP-kiri · 4 SL-kiri · 5 Entry-kanan(tengah).
// Pojok (1,2,3,4) = drag 2 arah; tengah (0,5) = horizontal saja. Level TP/SL dibaca dari pts[1]/pts[2].
function expandPosition(o){
  if(!o || (o.name!=='longPosition' && o.name!=='shortPosition')) return;
  if(!o.points || o.points.length>=6) return;          // sudah di-expand
  const p0=o.points[0]; if(!p0 || p0.value==null) return;
  // p0 WAJIB punya anchor-X valid. klinecharts kadang menaruh titik area-future TANPA anchor
  // (timestamp & dataIndex null) → keyOf(p0)={dataIndex:undefined} & tsOf(p0)=null → Lxa/Rxa jadi
  // undefined/NaN → override menaruh titik ngawur → x kolaps → garis "kelempar" ke tepi kanan.
  // Turunkan anchor dari posisi kursor terakhir (sama seperti jaring pengaman di onDrawEnd).
  if(p0.timestamp==null && (p0.dataIndex==null || !isFinite(p0.dataIndex))){
    try{ const rect=$('#chart').getBoundingClientRect(); const a=xAnchorFromPx(lastPtr.x-rect.left); if(a) Object.assign(p0,a); }catch(_){}
  }
  // [fix geser-kiri] klinecharts merender titik ber-timestamp di PUSAT BAR bawah/kiri (floor via
  // timestampToDataIndex), BUKAN sub-bar → entry meleset ke kiri hingga ~1 lebar-bar tergantung
  // posisi klik dalam bar. Snap timestamp entry ke bar TERDEKAT: entry mendarat tepat di center
  // candle terpilih (simetris, tanpa bias kiri) & durable. Titik future (dataIndex) dibiarkan presisi.
  if(p0.timestamp!=null) p0.timestamp=snapTimeToBar(p0.timestamp);
  const dir=o.name==='longPosition'?'long':'short';
  const entry=p0.value;
  const risk=tfDefaultRisk();
  const sl=dir==='long'? entry-risk : entry+risk;
  const tp=dir==='long'? entry+DEFAULT_POS_RR*risk : entry-DEFAULT_POS_RR*risk;
  // sisi kanan = 15 bar ke kanan; bila melewati candle terakhir → pakai dataIndex (area future, tak ter-clamp)
  const li=revealed(currentTF).length-1; let fL=fidxOf(p0); if(!isFinite(fL)) fL=li;
  const Lxa=(p0.timestamp!=null||p0.dataIndex!=null)?keyOf(p0):{dataIndex:fL};
  const Rxa=(fL+15>li)?{dataIndex:fL+15}:{timestamp:stepBarTs(currentTF, tsOf(p0), 15)};
  try{ chart.overrideOverlay({ id:o.id, points:[
    Object.assign({value:entry},Lxa), Object.assign({value:tp},Rxa), Object.assign({value:sl},Rxa),
    Object.assign({value:tp},Lxa),    Object.assign({value:sl},Lxa),  Object.assign({value:entry},Rxa) ] }); }
  catch(e){ setStatus('Position expand error: '+e.message,true); }
}
// Pojok TP/SL = drag VERTIKAL saja (ubah level, lebar kotak tetap), level di-clamp tak
// melewati Entry (titik tengah). Handle tengah (Entry kiri/kanan) = HORIZONTAL saja
// (atur lebar kotak, level Entry tetap).
function posPressedMove(t){
  const pts=t.points, k=t.performPointIndex, pp=t.performPoint;
  if(!pts||pts.length<6||pp==null) return;
  // klinecharts SUDAH mengubah titik yg di-drag sebelum handler ini → baca nilai stabil
  // dari titik KEMBAR yg tak di-drag (entry di 0&5, tp di 1&3, sl di 2&4).
  const entry = (k===0)?pts[5].value : pts[0].value;
  const tpRef = (k===1)?pts[3].value : pts[1].value;
  const slRef = (k===2)?pts[4].value : pts[2].value;
  // Arah tiap level relatif Entry. Kalau referensinya PAS di Entry (sign 0) — persis yang terjadi
  // sesaat setelah sebuah level ter-clamp — jangan pakai orientasi long sebagai fallback: pada
  // shortPosition TP ada di BAWAH & SL di ATAS, jadi fallback itu membalik arah clamp dan gerakan
  // berikutnya lolos menyeberangi Entry. Turunkan dari level seberang dulu (selalu sisi lawan).
  const tpSide=Math.sign(tpRef-entry)|| -Math.sign(slRef-entry)||1;
  const slSide=Math.sign(slRef-entry)|| -Math.sign(tpRef-entry)||-1;
  const clamp=(v,side)=> side>0 ? Math.max(v,entry) : Math.min(v,entry);  // TP/SL tak boleh seberangi Entry
  let tp=tpRef, sl=slRef;
  if(k===1||k===3) tp=clamp(pp.value,tpSide);   // pojok TP: ubah level (clamp)
  if(k===2||k===4) sl=clamp(pp.value,slSide);   // pojok SL: ubah level (clamp)
  // x/lebar: HANYA handle tengah (Entry) yg boleh mengubahnya. Pojok TP/SL vertikal murni →
  // abaikan X titik yg di-drag (pp), pakai anchor stabil Entry-kiri(pts0)/Entry-kanan(pts5)
  // supaya lebar tak "mengecil/geser" walau gerakan mouse tak persis vertikal.
  let tL, tR;
  if(k===0){ tL=keyOf(pp);      tR=keyOf(pts[5]); }   // Entry-kiri: geser sisi KIRI, kanan tetap
  else if(k===5){ tL=keyOf(pts[0]); tR=keyOf(pp); }   // Entry-kanan: geser sisi KANAN, kiri tetap
  else { tL=keyOf(pts[0]);     tR=keyOf(pts[5]); }    // pojok TP/SL: lebar tetap (level saja)
  if(fidxOf(tL)>fidxOf(tR)){ const tmp=tL; tL=tR; tR=tmp; }   // jaga kiri < kanan
  pts[0]=Object.assign({value:entry}, tL);   // Entry-kiri (tengah)
  pts[1]=Object.assign({value:tp},    tR);   // TP-kanan (pojok)
  pts[2]=Object.assign({value:sl},    tR);   // SL-kanan (pojok)
  pts[3]=Object.assign({value:tp},    tL);   // TP-kiri (pojok)
  pts[4]=Object.assign({value:sl},    tL);   // SL-kiri (pojok)
  pts[5]=Object.assign({value:entry}, tR);   // Entry-kanan (tengah)
  scheduleSaveDraws();
}

// ---- ketik level TP/SL di popup posisi (double-click) ----
// Aturan sisi sama dgn clamp posPressedMove: Long → TP di atas Entry & SL di bawah; Short sebaliknya.
// Level yang menyeberangi Entry DITOLAK (bukan di-clamp diam-diam) supaya angka yang diketik tak
// berubah tanpa sepengetahuan pengguna. Titik 1,3 = TP; 2,4 = SL (lihat expandPosition).
function posLevels(o){
  let ov=null; try{ ov=chart.getOverlayById(o.id); }catch(e){}
  const pts=ov&&ov.points; if(!pts||pts.length<6) return null;
  return {entry:pts[0].value, tp:pts[1].value, sl:pts[2].value};
}
function applyPosLevel(o, which, v){
  if(!isFinite(v)) return false;
  let ov=null; try{ ov=chart.getOverlayById(o.id); }catch(e){}
  if(!ov||!ov.points||ov.points.length<6) return false;
  const pts=ov.points.map(p=>Object.assign({},p)), entry=pts[0].value, long=o.name==='longPosition';
  const above=(which==='tp')===long;               // tp-long & sl-short ada di ATAS entry
  if(above ? !(v>entry) : !(v<entry)) return false;
  const idx=which==='tp'?[1,3]:[2,4];
  idx.forEach(i=>{ pts[i]=Object.assign({},pts[i],{value:v}); });
  try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(e){ return false; }
  return true;
}

// Drawing tools dikelompokkan ke kategori ala TradingView. Tiap kategori 1 ikon di rail;
// klik → flyout ke kanan berisi tool-nya. Grup `cursor:true` mengubah mode kursor (bukan overlay).
