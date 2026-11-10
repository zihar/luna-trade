// ===================== context menu: reset chart view =====================
const ctxMenu=document.createElement('div');
ctxMenu.className='ctxmenu'; ctxMenu.style.display='none';
document.body.appendChild(ctxMenu);
function hideCtx(){ ctxMenu.style.display='none'; }
function showCtx(x,y,items){
  ctxMenu.innerHTML=items.map((it,i)=> it.sep ? '<div class="ctxsep"></div>'
      : `<div class="ctxitem${it.disabled?' disabled':''}" data-ci="${i}">${it.label}</div>`).join('');
  ctxMenu.style.display='block';
  const mw=ctxMenu.offsetWidth||190, mh=ctxMenu.offsetHeight||44;
  ctxMenu.style.left=Math.min(x,window.innerWidth-mw-6)+'px';
  ctxMenu.style.top =Math.min(y,window.innerHeight-mh-6)+'px';
  ctxMenu.querySelectorAll('.ctxitem:not(.disabled)').forEach(el=>el.onclick=()=>{ hideCtx(); items[+el.dataset.ci].fn(); });
}
// menu hapus ala TradingView: hapus SEMUA drawing / SEMUA indikator / dua-duanya, dgn hitungan live.
function removeMenuItems(){
  const nd=drawIds.length, ni=Object.keys(activeInd).length;
  const dL=`drawing${nd===1?'':'s'}`, iL=`indicator${ni===1?'':'s'}`;
  return [
    {label:`Remove ${nd} ${dL}`,               disabled:nd===0,       fn:removeAllDrawings},
    {label:`Remove ${ni} ${iL}`,               disabled:ni===0,       fn:removeAllInd},
    {label:`Remove ${nd} ${dL} & ${ni} ${iL}`, disabled:(nd+ni)===0,  fn:()=>{ removeAllDrawings(); removeAllInd(); }},
  ];
}
function openRemoveMenu(x,y){ showCtx(x,y,removeMenuItems()); }
$('#chart').addEventListener('contextmenu',e=>{
  e.preventDefault();
  // macOS MEMETAKAN Ctrl+klik ke contextmenu di tingkat sistem, dan Ctrl kini punya dua tugas
  // sendiri: clone (Ctrl+seret badan objek, js/draw-clone.js) dan magnet sementara (Ctrl ditahan
  // saat menggambar, js/magnet-temp.js). Tanpa gerbang ini, keduanya rusak di Mac — gestur clone
  // memunculkan modal Style di tengah jalan, dan Ctrl+klik saat menggambar MEMBATALKAN gambarnya
  // (terukur: objek tak pernah terbentuk).
  //
  // Karena itu event contextmenu ber-ctrlKey diabaikan seluruhnya. Konsekuensi yang diterima:
  // klik-kanan sambil SENGAJA menahan Ctrl tak lagi membuka menu/modal. Klik kanan biasa tak
  // tersentuh sama sekali, dan di Mac ⌘ adalah jalur yang dianjurkan justru karena bebas dari ini.
  if(e.ctrlKey){ hideCtx(); return; }
  // Sedang menggambar → klik kanan = BATAL, bukan menu. Wajib sebelum cek hoverId: saat menggambar
  // hoverId sering menunjuk objek in-progress itu sendiri, dan itu akan membuka modal Style-nya.
  if(cancelInProgressDraw()){ hideCtx(); return; }
  if(hoverId){ const o=chart.getOverlayById(hoverId); if(o&&DRAW_DEFAULT[o.name]!==undefined){ hideCtx(); openObjSettings(o, e.clientX, e.clientY, 'style'); return; } }
  const rect=$('#chart').getBoundingClientRect();
  const yIn=e.clientY-rect.top;
  const price=pxToValue(yIn);
  const items=[];
  if(price!=null && !isNaN(price)){
    // deteksi alert dekat kursor (pita ±6px) → tawarkan hapus
    const pa=pxToValue(yIn-6), pb=pxToValue(yIn+6);
    let nearIdx=-1;
    if(pa!=null && pb!=null){ const lo=Math.min(pa,pb), hi=Math.max(pa,pb);
      nearIdx=alerts.findIndex(a=>a.sym===inst && a.price>=lo && a.price<=hi); }
    if(nearIdx>=0) items.push({label:`✕ Delete alert @ ${alerts[nearIdx].price}`, fn:()=>removeAlert(nearIdx)});
    items.push({label:`🔔 Create alert at ${(+price).toFixed(priceDecimals())}`, fn:()=>createAlertAt(price)});
  }
  // Paste objek gambar di titik yang diklik — pintu masuk kedua selain Ctrl/⌘+V, sekaligus
  // penanda satu-satunya bahwa clipboard berisi (Ctrl+C sengaja tak memberi toast, ikut TV).
  items.push({label:'📋 Paste drawing', disabled:!drawClip, fn:()=>{
    // Pakai `rect` yang sudah dihitung di atas (saat klik-kanan), BUKAN dihitung ulang saat item
    // diklik: e.clientX/clientY sendiri dicatat saat klik-kanan, jadi mencocokkannya dgn rect yang
    // dihitung belakangan (mis. chart sempat resize selagi menu terbuka) bisa mismatch — selain
    // reflow yang tak perlu untuk sesuatu yang sudah ada di closure.
    pasteOverlayAt(e.clientX-rect.left, e.clientY-rect.top);
  }});
  // Aksi PENGGUNA → removeAllDrawings (menghormati kunci). clearDrawings() sengaja tak dipakai di
  // sini: ia jalur internal tanpa syarat utk undo snapshot & ganti instrumen (js/draw-lock.js).
  if(drawIds.length){ const nd=drawIds.length; items.push({label:`🗑 Remove all drawings (${nd})`, fn:removeAllDrawings}); }
  items.push({label:'↺ Reset chart view', fn:resetChartView});
  items.push({label:'⚙ Chart settings', fn:()=>{ track('chart_settings'); showChartSet(); }});   // paling bawah
  showCtx(e.clientX, e.clientY, items);
});
window.addEventListener('click',hideCtx);
window.addEventListener('blur',hideCtx);
// Kembalikan zoom/scroll/skala ke default utk instrument + TF yang sedang dibuka.
function resetChartView(){
  if(T==null){ setStatus('Load first.',true); return; }
  lastLen=-1; render(true);                 // re-apply data current → reset posisi
  try{ chart.setBarSpace(8); }catch(e){}     // reset level zoom waktu ke default
  try{ chart.setStyles({yAxis:{type:'normal'}}); }catch(e){} // reset zoom/skala HARGA (y-axis) → auto-calc (setAutoCalcTickFlag(true))
  try{ chart.scrollToRealTime(); }catch(e){} // tempel ke bar terbaru yang terungkap
}

