// ===================== ganti TF (chart tetap 1) =====================
// Titik overlay di area future dibawa via dataIndex (relatif dataset TF saat ini). Saat ganti TF
// dataset berubah → simpan waktu wall-clock (virtual ts) sebelum pindah, lalu petakan ulang ke
// dataIndex TF baru supaya posisi future tetap di waktu yang sama.
function snapshotFuturePoints(){
  const snap=[];
  drawIds.forEach(id=>{ try{ const o=chart.getOverlayById(id); if(!o||!o.points) return;
    o.points.forEach((p,i)=>{ if(p&&p.timestamp==null&&p.dataIndex!=null){ const vt=tsOf(p); if(vt!=null) snap.push({id,i,vt}); } });
  }catch(e){} });
  return snap;
}
function reanchorFuturePoints(snap){
  if(!snap||!snap.length) return;
  const a=revealed(currentTF); if(!a.length) return;
  const li=a.length-1, lt=a[li].timestamp, byId={};
  snap.forEach(s=>{ (byId[s.id]||(byId[s.id]=[])).push(s); });
  Object.keys(byId).forEach(id=>{ try{ const o=chart.getOverlayById(id); if(!o||!o.points) return;
    const pts=o.points.map(p=>Object.assign({},p));
    // vt → dataIndex via tsToFracIndex (GAP-AWARE). Rumus linear li+(vt-lt)/DUR eksak hanya bila
    // jarak antar-bar seragam; utk titik in-data (mis. trendline) yg melewati gap weekend, tiap jam
    // gap dihitung sbg 1 bar hantu → "kegeser jauh". tsToFracIndex bisection ke bar nyata = presisi.
    // Titik future (vt>=lt): tsToFracIndex jatuh ke ekstrapolasi linear yg sama → tanpa regresi.
    byId[id].forEach(s=>{ if(pts[s.i]){ const fi=tsToFracIndex(s.vt);
      pts[s.i].dataIndex = (fi!=null)?fi:(li+barStepsFrom(currentTF,lt,s.vt)); delete pts[s.i].timestamp; } });
    chart.overrideOverlay({id, points:pts});
  }catch(e){} });
}
async function switchTF(tf){
  track('timeframe',{tf});
  if(T==null){ currentTF=tf; localStorage.setItem('br_tf',tf); highlightTF(); setStatus('Load first.'); return; }
  // (re)fetch bila belum ada ATAU cache tak mencakup kursor T: T sebelum bar pertama →
  // revealed() kosong (chart blank); T melewati bar terakhir → cache basi, bar depan hilang.
  const dur=DUR[tf], a=tfData[tf];
  // cache mentok di tepi live → wilayah setelah bar complete terakhir = bar forming
  // (memang tak pernah ter-cache karna filter c.complete), bukan data hilang → jangan refetch.
  // Tanpa ini, cursor M15 (halus) selalu "melewati" batas TF kasar (D/W/MN) → refetch sia-sia tiap switch.
  // Batas bar lewat cursorAtNewest/barEndAt; `dur` tinggal dipakai sebagai TOLERANSI slack "dekat
  // tepi live". Untuk MN, DUR salah s/d 58 jam — cukup untuk memicu refetch sia-sia tiap ganti TF
  // atau, sebaliknya, melewatkan refetch yang memang perlu.
  const lastEnd = (a && a.length) ? cursorAtNewest(tf, a) : null;
  const atLiveEdge = lastEnd != null && (lastEnd > Date.now() - dur);
  const needFetch = !a || !a.length
      || T < barEndAt(tf, 0, a)
      || (T > lastEnd && !atLiveEdge);
  let loadTok=null;
  if(needFetch){
    loadTok=chartLoad.show(inst);                // overlay lunar — hanya bila benar-benar menarik data (switch dari cache tetap instan)
    setStatus('Fetching '+tf+' …');
    try{ tfData[tf]=await fetchCandles(tf,{count:5000,to:new Date(T).toISOString()}); }
    catch(e){ chartLoad.hide(loadTok); setStatus('Failed TF '+tf+': '+e.message,true); return; }
  }
  const futSnap=snapshotFuturePoints();         // rekam waktu wall-clock titik future (TF lama)
  currentTF=tf; localStorage.setItem('br_tf',tf); highlightTF();
  clearFormingBar(); formingSeed=null;          // candle berjalan TF lama tak berlaku
  if(live) fetchFormingSeed();                   // seed OHLC periode utk TF baru secepatnya
  replayPartial=null;
  if(replayMode){ try{ const c=await buildReplayPartial(tf); if(c) replayPartial={tf,candle:c}; }catch(e){} }
  lastLen=-1; render(true);
  if(loadTok!=null) chartLoad.hide(loadTok);     // candle TF baru sudah tergambar → baru tutup overlay
  reanchorFuturePoints(futSnap);                 // petakan ulang ke dataIndex TF baru
}

