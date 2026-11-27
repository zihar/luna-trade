// ===================== persist gambar ke localStorage (per instrumen) =====================
// Titik disimpan sbg waktu wall-clock (vt) + value → tahan refresh/ganti TF. Saat restore, titik di
// area future (vt > candle terakhir) dipetakan ke dataIndex spt reanchorFuturePoints(). suppressDrawSave
// menahan penyimpanan & efek-samping onDrawEnd selama proses clear/restore programatik.
let suppressDrawSave=false, drawSaveTimer=null;
const PERSIST_DRAW={trendline:1,rect:1,fib3:1,text:1,dateRange:1,longPosition:1,shortPosition:1,
  horizontalStraightLine:1,verticalStraightLine:1,
  straightLine:1,rayLine:1,horizontalRayLine:1,priceLine:1,parallelStraightLine:1,priceChannelLine:1,fibonacciLine:1,
  circle:1,ellipse:1,arrow:1,path:1,arrowMarkUp:1,arrowMarkDown:1,callout:1};
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
    // Tool sub-bar disimpan dlm format SLOT (xm:1, lihat slotTs di js/util.js): titik dataIndex →
    // waktu periode yang tampak di bawahnya; titik timestamp (magnet) ditandai ts:1 supaya pulih
    // sbg timestamp lagi → terkunci di candle yg memuatnya, spt saat digambar. BAR_ANCHOR tetap lama.
    const sb=subBar(o.name);
    const pts=o.points.map((p,i)=>{
      if(sb && p && p.timestamp!=null) return {vt:p.timestamp, value:p.value, ts:1};
      // Pusat candle (indeks bulat) → waktu-buka bar + bc:1 (js/util.js barOpenTs): H1 10:00 pulih
      // di candle M5 10:00. Titik pecahan (gambar lama) tetap format slot.
      if(sb && p && p.dataIndex!=null && isCenterIdx(p.dataIndex)) return {vt:centerTsOf(id,i,p.dataIndex), value:p.value, bc:1};
      if(sb && p && p.dataIndex!=null) return {vt:fidxToSlotTs(p.dataIndex), value:p.value};
      return {vt:tsOf(p), value:p.value};
    });
    if(pts.some(p=>p.vt==null)) return;   // jangan simpan gambar dgn titik anchorless (rusak → far-left saat restore)
    // hidden:1 = disembunyikan per objek dari Object Tree (js/draw-object-tree.js); absen = tampak.
    // grp/gname = keanggotaan grup (js/draw-groups.js); absen = tak bergrup.
    // oname = nama pilihan pengguna (js/draw-object-tree.js); absen = nama otomatis.
    out.push({ name:o.name, points:pts, lock:o.lock?1:0, did:didOf(id), ...(sb?{xm:1}:{}), ...(objHidden[id]?{hidden:1}:{}), ...(objName[id]?{oname:objName[id]}:{}), ...grpSerialize(id),
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
  try{ objTreeDirty(); }catch(_){}       // nama (teks objek) bisa berubah → Object Tree
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
      if(subBar(d.name)){
        // xm:1 = format slot (js/util.js slotTs). Muatan LAMA tanpa xm tetap dibaca dgn pemetaan
        // lama (pusat bar = open) → tampil persis spt dulu; ia pindah ke format slot dgn sendirinya
        // pada penyimpanan berikutnya, diukur dari posisi di TF yang sedang dibuka saat itu.
        if(d.xm && pt.ts) return {timestamp:pt.vt, value:pt.value};
        if(d.xm && pt.bc){ const k=barOpenTsToIdx(pt.vt); return k!=null ? {dataIndex:k, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
        const fi = d.xm ? slotTsToFidx(pt.vt) : tsToFracIndex(pt.vt);   // tool sub-bar: dataIndex pecahan (presisi)
        return fi!=null ? {dataIndex:fi, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
      // BAR_ANCHOR: future → dataIndex. Lewat tsToFracIndex (bukan (vt-lt)/DUR sendiri) supaya
      // rumus future hidup di SATU tempat & ikut benar untuk MN yang panjang barnya tak seragam.
      return (lt!=null && pt.vt>lt) ? {dataIndex: tsToFracIndex(pt.vt), value:pt.value}
        : {timestamp:pt.vt, value:pt.value};
    });
    const base={name:d.name, points:pts};
    if(d.lock) base.lock=true;      // kunci dipulihkan bersama objeknya (js/draw-lock.js)
    if(d.hidden || drawsHidden) base.visible=false;   // sembunyi per objek (js/draw-object-tree.js) / Hide all
    if(d.extendData!=null) base.extendData=d.extendData;
    if(BUILTIN_LINE[d.name]) base.styles=klineLineStyles(Object.assign({},DRAW_DEFAULT[d.name],d.style||{}));
    const id=chart.createOverlay(Object.assign(base,delHooks()));
    if(id){ drawIds.push(id);
      // waktu asli titik pusat candle diingat → simpan ulang di TF kasar tak membuang menitnya
      if(subBar(d.name) && d.xm) d.points.forEach((pt,i)=>{ if(pt.bc) rememberCenterTs(id,i,pt.vt); });
      // did dari muatan bila ada; objek lama (sebelum fitur alert-garis) dapat did baru di sini,
      // dan ia ikut tersimpan pada penyimpanan berikutnya.
      objDid[id]= (typeof d.did==='string' && d.did) ? d.did : newDid();
      if(d.hidden) objHidden[id]=true;
      if(typeof d.oname==='string' && d.oname) objName[id]=d.oname.slice(0,60);   // nama pilihan (js/draw-object-tree.js)
      grpRestore(id,d);   // grp/gname → keanggotaan grup (js/draw-groups.js)
      try{ applyXDateFlag(chart.getOverlayById(id)); }catch(_){}   // restore full-point tak picu onDrawEnd → set flag di sini
      if(d.lock) try{ applyLockVisual(id,true); }catch(_){}        // muncul tanpa handle sejak awal
      if(d.style){ objStyle[id]=d.style; if(!BUILTIN_LINE[d.name]) try{chart.overrideOverlay({id,points:pts});}catch(_){} } }
  }catch(e){} });
  suppressDrawSave=prev; clearTimeout(drawSaveTimer);
  try{ zApply(); }catch(_){}           // urutan tumpukan = urutan payload (js/draw-zorder.js)
  try{ syncLockAllBtn(); }catch(_){}   // restore bisa membawa objek terkunci → samakan tombol rail
}
// Jaring akhir "tangkap drag/edit yg belum ter-flush" pindah SELURUHNYA ke flushSyncDrawsOnExit()
// (js/draw-sync.js), yang memanggil saveDraws() sendiri. Listener terpisah di sini justru berbahaya:
// ia terdaftar LEBIH DULU (draw-persist dimuat sebelum draw-sync), jadi ia jalan sebelum handler
// sync sempat mengosongkan antrean simbol lain — dan scheduleSyncDraws() di dalamnya lalu mengirim
// muatan simbol itu sebagai fetch POLOS di tengah unload, yang rutin dibatalkan browser (temuan N1).
// Satu pintu keluar, urutannya terkendali di satu tempat.

