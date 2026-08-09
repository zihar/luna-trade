// ===================== forming candle (live, gerak tiap tick) =====================
function liveMid(){ const t=liveTicks[inst]; return (t && isFinite(t.bid) && isFinite(t.ask))?(t.bid+t.ask)/2:null; }
// fetch candle complete yg baru tutup, agar periode forming berikutnya bisa mulai (debounce).
function scheduleRollRefresh(){
  if(rollRefreshPending || !live) return;
  rollRefreshPending=true;
  setTimeout(async()=>{ rollRefreshPending=false; if(live){ try{ await liveRefresh(); }catch(e){} } }, 800);
}
// Update/append candle berjalan dari harga stream. Hanya saat Live & pasar buka.
// Periode forming = tepat setelah candle complete terakhir (grid = DUR). Begitu periode
// lewat, biarkan liveRefresh menarik candle complete (OHLC otoritatif) lalu mulai periode baru.
function pushFormingCandle(){
  if(!live || marketClosed()) return;
  const last=currentCandle(); if(!last) return;   // candle terakhir yg DITAMPILKAN (sinkron dgn render → anti-gap)
  const mid=liveMid(); if(mid==null) return;
  const now=Date.now();
  // Timestamp periode berjalan: utamakan candle incomplete OANDA (formingSeed) — OTORITATIF
  // utk boundary non-grid (D/W/H4 align 18:00 NY + gap akhir pekan). Grid tetap
  // last.timestamp+dur cuma benar utk TF ≤ H1 (kontinu tiap jam) → dipakai sbg fallback.
  // Seed diterima bila lebih baru dari candle complete terakhir (bukan lagi cocok-persis
  // dgn grid, yg dulu bikin seed benar terbuang saat openTs grid meleset).
  const seed = (formingSeed && formingSeed.tf===currentTF && formingSeed.inst===inst
                && formingSeed.candle.timestamp>last.timestamp) ? formingSeed.candle : null;
  // open = close candle sebelumnya (jalur grid, tak ada gap harga) / open OANDA (jalur seed).
  const openTs = seed ? seed.timestamp : stepBarTs(currentTF, last.timestamp, 1);
  if(now<openTs) return;                            // periode forming belum mulai
  // Periode forming sudah lewat sepenuhnya = data ketinggalan (mis. sesudah exit Bar Replay:
  // last=candle basi, harga live sudah jauh). JANGAN sintesis forming di openTs lama — open=last.close
  // (basi) → close=mid (kini) akan jadi SATU bar raksasa. Jadwalkan roll (tarik candle complete)
  // lalu keluar; forming digambar normal setelah data catch-up. Hanya jalur grid: dgn seed
  // otoritatif, openTs pasti = periode kini (risiko bar-raksasa tak ada).
  if(!seed && now>=stepBarTs(currentTF, openTs, 1)){ scheduleRollRefresh(); return; }
  // Jalur seed: server punya candle TUTUP yang belum kita muat (mis. sesudah tab lama idle —
  // timer di-throttle/freeze → tfData ketinggalan, sementara seed sudah di periode kini).
  // Menggambar forming di openTs itu MELOMPATI periode di antaranya, dan klinecharts
  // MEMBUANG candle tutup yang menyusul (timestamp < bar terakhir di chart, tanpa error) →
  // gap permanen. Jadi tarik candle tutup dulu; forming digambar setelah data catch-up.
  // Cek pakai prevTs (bukan openTs>last+dur) supaya boundary sah tetap lolos: H4/D align
  // 18:00 NY & gap akhir pekan memang membuat openTs > last+dur tanpa ada bar yang terlewat.
  if(seed && formingSeed.prevTs!=null && formingSeed.prevTs>last.timestamp){ scheduleRollRefresh(); return; }
  if(!formingBar || formingBar.timestamp!==openTs){
    const o = seed ? seed.open : last.close;
    const hi = seed ? seed.high : last.close;
    const lo = seed ? seed.low  : last.close;
    formingBar={timestamp:openTs, open:o, high:Math.max(hi,mid), low:Math.min(lo,mid), close:mid, volume:seed?seed.volume:0};
  } else {
    formingBar.close=mid;
    // gabungkan ekstrem OANDA (otoritatif) + tick live — high/low monotonik dlm periode
    const hi = seed ? Math.max(seed.high, formingBar.high) : formingBar.high;
    const lo = seed ? Math.min(seed.low,  formingBar.low)  : formingBar.low;
    formingBar.high = Math.max(hi, mid);
    formingBar.low  = Math.min(lo, mid);
    if(seed) formingBar.open = seed.open;            // open otoritatif dari OANDA
  }
  try{ chart.updateData(formingBar); }catch(e){}
}
function clearFormingBar(){ formingBar=null; }

function initPriceTimer(){
  chartWmEl=document.createElement('div');
  chartWmEl.className='chart-wm'; chartWmEl.id='chartWm';
  chartWmEl.innerHTML='<svg class="wm-glyph" viewBox="0 0 24 24" aria-hidden="true"><mask id="lunaCutWm"><rect width="24" height="24" fill="#fff"/><circle cx="15.6" cy="9.4" r="8.4" fill="#000"/></mask><circle cx="11.6" cy="12" r="8.4" fill="currentColor" mask="url(#lunaCutWm)"/></svg><span class="wm-t"></span>';
  $('#chart').appendChild(chartWmEl);
  updateChartWM();
  priceTimerEl=document.createElement('div');
  priceTimerEl.className='price-timer'; priceTimerEl.id='priceTimer';
  $('#chart').appendChild(priceTimerEl);
  axisTimeEl=document.createElement('div');
  axisTimeEl.className='axis-time'; axisTimeEl.id='axisTime';
  $('#chart').appendChild(axisTimeEl);
  $('#chart').addEventListener('mousemove', updateAxisTime);
  $('#chart').addEventListener('mouseleave', ()=>{ if(axisTimeEl) axisTimeEl.style.display='none'; });
  setInterval(updatePriceTimer, 1000);                       // detak tiap detik
  setInterval(streamWatchdog, WATCHDOG_MS);                  // auto-recover live-stream saat idle lama / mati diam
  try{ chart.subscribeAction('onScroll', updatePriceTimer); }catch(e){}
  try{ chart.subscribeAction('onZoom',   updatePriceTimer); }catch(e){}
  // News: fetch data saat chart ready + poll 60s (marker tampil walau panel tertutup).
  try{ refreshNewsData(); }catch(e){}
  clearInterval(_newsTimer); _newsTimer=setInterval(()=>{ try{ refreshNewsData(); }catch(e){} }, 60000);
  // Scheduler notif high-impact: cek reminder (T-5mnt) tiap 30s meski panel tertutup (data dari newsState).
  clearInterval(_newsNotifyTimer); _newsNotifyTimer=setInterval(()=>{ try{ checkNewsNotify(); }catch(e){} }, 30000);
  // Reposisi marker saat pan/zoom (reposition & popup didefinisikan di Task 3/4; try/catch aman bila belum ada).
  try{ chart.subscribeAction('onScroll', ()=>{ try{ repositionNewsMarkers(); }catch(e){} }); }catch(e){}
  try{ chart.subscribeAction('onZoom',   ()=>{ try{ repositionNewsMarkers(); }catch(e){} }); }catch(e){}
  updatePriceTimer();
}

// Muatan awal + refresh alert kini lewat alertPoll() (server source of truth); loadAlerts lama dibuang (dead).
// saveAlerts dihapus — server jadi source of truth untuk data alert.
// custom overlay: garis alert (horizontal) + badge ✕ kecil di ujung kanan utk hapus
klinecharts.registerOverlay({
  name:'alertLine', totalStep:1, needDefaultPointFigure:false, lock:true,
  createPointFigures:({coordinates,bounding})=>{
    const c=coordinates&&coordinates[0]; if(!c||c.y==null) return [];
    const y=c.y, W=(bounding&&bounding.width)?bounding.width:600, bx=W-16;
    return [
      {type:'line',attrs:{coordinates:[{x:0,y},{x:W,y}]},styles:{color:'#a855f7',style:'dashed',size:1,dashedValue:[6,5]}},
      {type:'rect',attrs:{x:bx-8,y:y-8,width:16,height:16},styles:{style:'fill',color:'#a855f7',borderColor:'transparent'}},
      {type:'text',attrs:{x:bx,y:y,text:'✕',align:'center',baseline:'middle'},styles:{color:'#fff',size:11}},
    ];
  },
  // klik di area badge (±dekat tepi kanan) → hapus alert ybs
  onClick:(e)=>{ try{
    const idx=alerts.findIndex(a=>a.oid===e.overlay.id); if(idx<0) return false;
    const rect=$('#chart').getBoundingClientRect();
    if(lastPtr.x-rect.left >= rect.width-34) removeAlert(idx);
  }catch(_){ } return false; },
});
function drawAlertLines(){
  alerts.forEach(a=>{ if(a.oid){ try{chart.removeOverlay(a.oid);}catch(e){} a.oid=null; } });
  alerts.filter(a=>a.sym===inst && !a.drawId).forEach(a=>{   // alert garis: objeknya SUDAH jadi garisnya
    try{ a.oid=chart.createOverlay({name:'alertLine', points:[{value:a.price}], lock:true}); }catch(e){}
  });
}
// Judul satu baris alert. Alert biasa tetap "Crossing <harga>"; alert garis menyebut kondisi dan
// asal objeknya — tanpa ini tiga kondisi baru tak terbedakan di satu-satunya tempat pengguna
// melihat alertnya. Kedua peta (kondisi & judul objek) hidup di SATU tempat masing-masing:
// COND_LABEL & drawAlertLabel() di js/draw-alert.js. Peta judul yang dulu ditulis ulang di sini
// bahkan sudah berselisih isinya dgn OBJ_TITLE ("Line" vs "Extended Line").
function alertTitle(a){
  const cond=COND_LABEL[a.cond||'cross']||COND_LABEL.cross;
  if(!a.drawId) return `${dispSym(a.sym)} ${cond} ${a.price}`;
  return `${dispSym(a.sym)} · ${drawAlertLabel(a.drawId)} · ${cond}`;
}
function renderAlertList(){
  const el=$('#alertList'); if(!el) return;
  el.innerHTML = alerts.length
    ? alerts.map((a,i)=>`<div class="al-item"><div class="al-main">${alertTitle(a)}</div>`
        +`<div class="al-sub">${dispSym(a.sym)} · <span class="al-st${a.triggeredAt?' trig':''}">${a.triggeredAt?'Triggered':'Active'}</span></div>`
        +`<button class="al-x" data-i="${i}" title="Delete">✕</button></div>`).join('')
    : '<div class="al-empty">No alerts yet. Click + to add.</div>';
  el.querySelectorAll('.al-x').forEach(b=>b.onclick=()=>removeAlert(+b.dataset.i));
}
async function createServerAlert(price){
  const p=+(+price).toFixed(priceDecimals()); if(!p||p<=0) return null;
  try{
    const r=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({instrument:inst, price:p})});
    if(!r.ok) return null;
    const a=await r.json();
    alerts.push({id:a.id, sym:a.instrument, price:a.price, triggeredAt:null, oid:null});
    track('alert',{inst}); renderAlertList(); drawAlertLines(); return a;
  }catch(e){ return null; }
}
// dialog "Create alert on <INST>" — dipicu tombol + panel Alerts
function openAlertDialog(){
  $('#amInst').textContent=dispSym(inst);
  const m=liveMid?liveMid():null, cur=currentCandle();
  $('#amPrice').value=(m!=null?m:(cur?cur.close:'')) || '';
  $('#alertModal').classList.add('open'); setTimeout(()=>$('#amPrice').focus(),0);
}
function closeAlertDialog(){ $('#alertModal').classList.remove('open'); }
async function removeAlert(i){
  const a=alerts[i]; if(!a) return;
  try{ await fetch('/api/alerts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id})}); }catch(e){}
  if(a.oid!=null){ try{chart.removeOverlay(a.oid);}catch(e){} }
  // cari ulang by id (bukan index yg ditangkap sebelum await) — alertPoll bisa menulis ulang `alerts` selama menunggu
  const idx=alerts.findIndex(x=>x.id===a.id); if(idx>=0) alerts.splice(idx,1);
  renderAlertList(); drawAlertLines();
}
// buat alert di harga tertentu (dipakai klik-kanan chart)
function createAlertAt(price){
  if(price==null||isNaN(price)) return;
  if(typeof Notification!=='undefined' && Notification.permission==='default'){ try{Notification.requestPermission();}catch(e){} }
  createServerAlert(price).then(a=>{ if(a) toast('Alert set @ '+fmt(a.price),'success'); });
}
// alert berbunyi saat candle simbol aktif menembus level — REPLAY ONLY (live ditangani server monitor)
let replayFiredAlerts = new Set();   // id alert yg sudah bunyi di run replay ini (dedup, non-destruktif)
function checkAlerts(c){
  if(!replayMode) return;            // LIVE ditangani server monitor → cegah dobel
  const fired=alerts.filter(a=>a.sym===inst && c.low<=a.price && a.price<=c.high && !replayFiredAlerts.has(a.id));
  if(!fired.length) return;
  fired.forEach(a=>{
    replayFiredAlerts.add(a.id);     // JANGAN hapus alert server (simulasi)
    const msg=a.sym+' touched '+a.price+' (replay)';
    try{ if(typeof Notification!=='undefined' && Notification.permission==='granted') new Notification('Luna Trade — Alert', {body:msg}); }catch(e){}
    toast(msg,'info');
  });
}
// poll ~2s: surface alert yg ditrigger server (LIVE) → toast + Web Notification, lalu ack (hapus) — one-shot.
let alertPollTimer=null;
const shownTriggered=new Set();     // id alert triggered yg sudah ditampilkan (anti-dobel)
async function alertPoll(){
  try{
    const r=await fetch('/api/alerts'); if(!r.ok) return;
    const rows=await r.json();
    // sinkron list dasar (untuk panel) — pertahankan oid overlay bila id sama
    const byId={}; alerts.forEach(a=>byId[a.id]=a);
    // t1/p1/t2/p2 IKUT dibawa (bukan cuma diabaikan): syncAlertAnchors (js/draw-alert.js) membanding-
    // kan anchor CACHE di sini dgn anchor LIVE objeknya utk memutuskan perlu POST atau tidak. Kalau
    // field ini dijatuhkan di sini, cache-nya jadi undefined tiap ~2dtk (interval poll ini) dan
    // perbandingan itu SELALU dianggap "berubah" → tiap saveDraws() (termasuk yg dipicu gambar LAIN
    // yg tak ada hubungannya) mem-POST ulang anchor tiap alert garis di instrumen ini, sia-sia.
    const next=(rows||[]).map(a=>({id:a.id, sym:a.instrument, price:a.price, triggeredAt:a.triggeredAt,
      oid:(byId[a.id]&&byId[a.id].oid)||null, cond:a.cond||'cross', drawId:a.drawId||'',
      t1:a.t1, p1:a.p1, t2:a.t2, p2:a.p2, pOff:a.pOff||0}));
    // deteksi triggered baru → toast + Notification + ack (hapus)
    for(const a of rows){
      if(a.triggeredAt!=null && !shownTriggered.has(a.id)){
        shownTriggered.add(a.id);
        // Peta kondisi yang sama (COND_LABEL, js/draw-alert.js) — di kalimat ini bentuknya huruf
        // kecil, jadi diturunkan dari peta itu alih-alih ditulis ulang jadi salinan ketiga.
        const msg = a.drawId ? `${dispSym(a.instrument)} — ${(COND_LABEL[a.cond||'cross']||COND_LABEL.cross).toLowerCase()} your line`
                             : a.instrument+' crossed '+a.price;
        try{ if(typeof Notification!=='undefined' && Notification.permission==='granted') new Notification('Luna Trade — Alert', {body:msg}); }catch(e){}
        toast(msg,'success');
        try{ await fetch('/api/alerts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id})}); }catch(e){}
      }
    }
    // hapus overlay milik alert triggered yg di-ack DULU (kalau tidak, garis nyangkut permanen —
    // drawAlertLines hanya membersihkan overlay untuk entry yg masih di `alerts`).
    next.forEach(a=>{ if(a.triggeredAt!=null && shownTriggered.has(a.id) && a.oid!=null){ try{chart.removeOverlay(a.oid);}catch(e){} } });
    // buang yg sudah di-ack dari list yg akan dirender
    alerts=next.filter(a=>!(a.triggeredAt!=null && shownTriggered.has(a.id)));
    renderAlertList(); drawAlertLines();
  }catch(e){}
}
function startAlertPoll(){ if(alertPollTimer) return; alertPoll(); alertPollTimer=setInterval(alertPoll, 2000); }
function stopAlertPoll(){ clearInterval(alertPollTimer); alertPollTimer=null; }
$('#alertAddBtn').onclick=openAlertDialog;
// rail kanan: buka/tutup panel Alerts (slide-in). Persist supaya tetap saat reload.
function setAlertsPane(open){
  $('#alertsPane').classList.toggle('open', open);
  $('#railAlerts').classList.toggle('on', open);
  $('#railAlerts').setAttribute('aria-pressed', open?'true':'false');
  try{ localStorage.setItem('br_alertsPane', open?'1':'0'); }catch(e){}
}
function toggleAlertsPane(){ setAlertsPane(!$('#alertsPane').classList.contains('open')); }
$('#railAlerts').onclick=toggleAlertsPane;
$('#alertsClose').onclick=()=>setAlertsPane(false);   // tombol ✕ di header panel
try{ if(localStorage.getItem('br_alertsPane')==='1') setAlertsPane(true); }catch(e){}
$('#amClose').onclick=closeAlertDialog; $('#amCancel').onclick=closeAlertDialog;
$('#amCreate').onclick=async()=>{ const p=+$('#amPrice').value; if(!(p>0)){ setStatus('Enter a valid price.',true); return; }
  const a=await createServerAlert(p);
  if(a){ closeAlertDialog(); toast('Alert created @ '+fmt(a.price),'success'); }
  else { setStatus('Could not create alert. Try again.',true); } };
$('#alertModal').addEventListener('mousedown',e=>{ if(e.target===$('#alertModal')) closeAlertDialog(); });
