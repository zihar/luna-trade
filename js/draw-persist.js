// ===================== persist gambar ke localStorage (per instrumen) =====================
// Titik disimpan sbg waktu wall-clock (vt) + value → tahan refresh/ganti TF. Saat restore, titik di
// area future (vt > candle terakhir) dipetakan ke dataIndex spt reanchorFuturePoints(). suppressDrawSave
// menahan penyimpanan & efek-samping onDrawEnd selama proses clear/restore programatik.
let suppressDrawSave=false, drawSaveTimer=null;
const PERSIST_DRAW={trendline:1,rect:1,fib3:1,text:1,dateRange:1,longPosition:1,shortPosition:1,
  horizontalStraightLine:1,verticalStraightLine:1,
  straightLine:1,rayLine:1,horizontalRayLine:1,priceLine:1,parallelStraightLine:1,priceChannelLine:1,fibonacciLine:1,
  circle:1,ellipse:1,arrow:1,arrowMarkUp:1,arrowMarkDown:1,callout:1};
// simpleAnnotation & simpleTag sengaja TIDAK di sini (ditarik dari rail, lihat DRAW_GROUPS):
// buildDrawsFromArray memfilter lewat daftar ini, jadi objek lama yang masih tersimpan di
// localStorage pengguna otomatis berhenti dimuat — tak perlu migrasi.
// Kunci cermin localStorage — SATU-SATUNYA tempat formatnya hidup (js/draw-sync.js ikut memakainya).
// Berskop per PENGGUNA sejak sync ke server: dulu `br_draws_<INST>` tanpa uid cuma artefak tampilan
// lokal, tapi kini isinya bisa DIUNGGAH (jalur adopsi). Tanpa skop, user B yang login di browser
// bekas user A akan mengunggah gambar A ke akunnya sendiri lalu menyebarkannya ke perangkat B.
// Entri lama tanpa skop sengaja dibiarkan berhenti dibaca — memigrasikannya berarti mengklaim tahu
// milik siapa, padahal justru itu yang tak bisa dibuktikan.
function drawsKey(instrument){ return 'br_draws_'+(authUid||'anon')+'_'+(instrument||inst); }
function serializeDraws(){
  const out=[];
  drawIds.forEach(id=>{ try{ const o=chart.getOverlayById(id);
    if(!o||!o.points||!PERSIST_DRAW[o.name]) return;
    const pts=o.points.map(p=>({vt:tsOf(p), value:p.value}));
    if(pts.some(p=>p.vt==null)) return;   // jangan simpan gambar dgn titik anchorless (rusak → far-left saat restore)
    out.push({ name:o.name, points:pts, lock:o.lock?1:0, did:didOf(id),
      extendData:(o.extendData!==undefined?o.extendData:null), style:objStyle[id]||null });
  }catch(e){} });
  return out;
}
function saveDraws(){ if(suppressDrawSave) return;
  const arr=serializeDraws(), json=JSON.stringify(arr);
  try{ localStorage.setItem(drawsKey(), json); }catch(e){}
  recordDrawHistory(json);
  // Muatan + instrumen diserahkan BERSAMAAN ke lapisan sync (js/draw-sync.js) supaya dorongan yang
  // tertunda tak pernah perlu membaca ulang `inst` yang mungkin sudah berganti.
  try{ scheduleSyncDraws(inst, arr); }catch(_){}
  try{ syncAlertAnchors(); }catch(_){}   // alert ikut pindah bila objeknya bergeser (js/draw-alert.js)
}
function scheduleSaveDraws(){ if(suppressDrawSave) return; clearTimeout(drawSaveTimer); drawSaveTimer=setTimeout(saveDraws,350); }
// Sumbernya kini SERVER (js/draw-sync.js); localStorage hanya jalur penyelamat saat request gagal.
// Fungsinya jadi async — pemanggilnya (loadInit) menunggunya bersama fetch candles.
async function restoreDraws(){
  buildDrawsFromArray(await loadDrawsFor(inst));
}
function buildDrawsFromArray(arr){
  if(!Array.isArray(arr)||!arr.length) return;
  const a=revealed(currentTF), li=a.length-1, lt=li>=0?a[li].timestamp:null;
  const prev=suppressDrawSave; suppressDrawSave=true;
  arr.forEach(d=>{ try{
    if(!PERSIST_DRAW[d.name]||!Array.isArray(d.points)||!d.points.length) return;
    if(d.points.some(pt=>pt.vt==null)) return;   // lewati gambar rusak lama (titik anchorless → far-left)
    const pts=d.points.map(pt=>{
      if(pt.vt==null) return {value:pt.value};
      if(subBar(d.name)){ const fi=tsToFracIndex(pt.vt);   // tool sub-bar: SELALU dataIndex pecahan (presisi)
        return fi!=null ? {dataIndex:fi, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
      // BAR_ANCHOR: future → dataIndex. Lewat tsToFracIndex (bukan (vt-lt)/DUR sendiri) supaya
      // rumus future hidup di SATU tempat & ikut benar untuk MN yang panjang barnya tak seragam.
      return (lt!=null && pt.vt>lt) ? {dataIndex: tsToFracIndex(pt.vt), value:pt.value}
        : {timestamp:pt.vt, value:pt.value};
    });
    const base={name:d.name, points:pts};
    if(d.lock) base.lock=true;      // kunci dipulihkan bersama objeknya (js/draw-lock.js)
    if(d.extendData!=null) base.extendData=d.extendData;
    if(BUILTIN_LINE[d.name]) base.styles=klineLineStyles(Object.assign({},DRAW_DEFAULT[d.name],d.style||{}));
    const id=chart.createOverlay(Object.assign(base,delHooks()));
    if(id){ drawIds.push(id);
      // did dari muatan bila ada; objek lama (sebelum fitur alert-garis) dapat did baru di sini,
      // dan ia ikut tersimpan pada penyimpanan berikutnya.
      objDid[id]= (typeof d.did==='string' && d.did) ? d.did : newDid();
      try{ applyXDateFlag(chart.getOverlayById(id)); }catch(_){}   // restore full-point tak picu onDrawEnd → set flag di sini
      if(d.lock) try{ applyLockVisual(id,true); }catch(_){}        // muncul tanpa handle sejak awal
      if(d.style){ objStyle[id]=d.style; if(!BUILTIN_LINE[d.name]) try{chart.overrideOverlay({id,points:pts});}catch(_){} } }
  }catch(e){} });
  suppressDrawSave=prev; clearTimeout(drawSaveTimer);
  try{ syncLockAllBtn(); }catch(_){}   // restore bisa membawa objek terkunci → samakan tombol rail
}
// Jaring akhir "tangkap drag/edit yg belum ter-flush" pindah SELURUHNYA ke flushSyncDrawsOnExit()
// (js/draw-sync.js), yang memanggil saveDraws() sendiri. Listener terpisah di sini justru berbahaya:
// ia terdaftar LEBIH DULU (draw-persist dimuat sebelum draw-sync), jadi ia jalan sebelum handler
// sync sempat mengosongkan antrean simbol lain — dan scheduleSyncDraws() di dalamnya lalu mengirim
// muatan simbol itu sebagai fetch POLOS di tengah unload, yang rutin dibatalkan browser (temuan N1).
// Satu pintu keluar, urutannya terkendali di satu tempat.

