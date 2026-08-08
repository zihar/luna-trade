// ===================== load awal =====================
$('#instrument').value = localStorage.getItem('br_inst')||'EUR_USD';
// Sinkron `inst` ke instrumen tersimpan SEKARANG (bukan nanti di loadInit yg await font ~700ms):
// refreshNewsData boot (initPriceTimer) berjalan sebelum loadInit set inst → tanpa ini fetch
// calendar boot memakai default 'EUR_USD' lalu di-drop stale-guard saat inst berubah → marker
// news baru muncul di poll 60s / saat buka panel. Set awal = fetch boot pakai instrumen benar.
inst = $('#instrument').value;
$('#date').value = new Date().toISOString().slice(0,10);   // default: hari ini
// tampilan tanggal ala "Senin, 13 May 2026" (hari Indonesia, bulan Inggris)
function fmtBacktestDate(v){
  if(!v) return 'Pick a date';
  const d=new Date(v+'T00:00:00');
  const hari=new Intl.DateTimeFormat('id-ID',{weekday:'long'}).format(d);
  const bulan=new Intl.DateTimeFormat('en-US',{month:'short'}).format(d);
  return `${hari}, ${d.getDate()} ${bulan} ${d.getFullYear()}`;
}
function syncDateDisplay(){ $('#dateDisplay').textContent = fmtBacktestDate($('#date').value); }
$('#dateDisplay').onclick = ()=>{ const i=$('#date'); if(i.showPicker) i.showPicker(); else { i.focus(); i.click(); } };
$('#date').onchange = syncDateDisplay;
syncDateDisplay();
currentTF = localStorage.getItem('br_tf')||'M15';
guessPip(); highlightTF();
// ganti pair → langsung load data terkini (tombol Load khusus backtest by tanggal)
$('#instrument').onchange = ()=>{ guessPip(); renderWatch(); syncIpickTrigger(); updateChartWM(); renderHeaderPrice(); loadInit(true); };
function guessPip(){
  const s=$('#instrument').value;
  // tabel di dalam fungsi: guessPip dipanggil saat init sebelum const global lain siap → hindari TDZ
  const PIP={ SPX500_USD:1, NAS100_USD:1, US30_USD:1, DE30_EUR:1, UK100_GBP:1, FR40_EUR:1, EU50_EUR:1,
    JP225_USD:1, AU200_AUD:1, HK33_HKD:1, US2000_USD:0.01, ETH_USD:0.1, LTC_USD:0.1, BCH_USD:0.1,
    WTICO_USD:0.01, BCO_USD:0.01, NATGAS_USD:0.01 };
  $('#pipSize').value = PIP[s]!=null ? PIP[s]
    : s.includes('BTC')?1 : s.includes('DXY')?0.01 : s.includes('JPY')?0.01 : s.includes('XAU')?0.1 : s.includes('XAG')?0.001 : 0.0001;
  lotsManual=false;   // saran lot otomatis menyesuaikan instrumen baru
}

// loadBtn → backtest dari tanggal terpilih; latest=true → langsung data terkini (saat ganti pair)
$('#loadBtn').onclick = ()=>loadInit(false);

// Moon loader: overlay lunar di area chart saat menarik candle. Guard token → hanya
// panggilan terbaru yg boleh menutup (klik cepat antar pair tak saling tutup). Delay
// 160ms → load cepat/cache tak berkedip.
const chartLoad = (()=>{
  let el, symEl, gen=0;
  const fmt = s => (s||'').replace(/_/g,'/');
  function ensure(){
    if(el) return;
    el=document.createElement('div'); el.className='chart-loading'; el.setAttribute('aria-hidden','true');
    el.innerHTML='<div class="cl-moon"><div class="cl-glow"></div>'
      +'<svg viewBox="0 0 24 24" aria-hidden="true">'
      +'<mask id="lunaLoadCut"><rect width="24" height="24" fill="#fff"/>'
      +'<circle class="cl-cut" cx="15.6" cy="9.4" r="8.4" fill="#000"/></mask>'
      +'<circle class="cl-disc" cx="11.6" cy="12" r="8.4" mask="url(#lunaLoadCut)"/></svg></div>'
      +'<div class="cl-label">Loading&nbsp;<span class="cl-sym"></span><span class="cl-dots"></span></div>';
    symEl=el.querySelector('.cl-sym');
    ($('#chart')||document.body).appendChild(el);
  }
  return {
    show(sym){ ensure(); const t=++gen; symEl.textContent=fmt(sym);
      el.classList.add('is-on'); return t; },
    hide(token){ if(!el) return; if(token!=null && token!==gen) return;
      el.classList.remove('is-on'); }
  };
})();

async function loadInit(latest){
  // Render pertama tunggu font sumbu (Inter Tight) siap — cegah "tremor": kalau chart menggambar
  // dgn metrik font fallback lalu Inter Tight swap-in, lebar y-axis berubah → sumbu bergeser (hanya cold load).
  if(!loadInit._fontReady){ loadInit._fontReady=true;
    try{ if(document.fonts&&document.fonts.load) await Promise.race([
      Promise.all([document.fonts.load("10px 'Inter Tight'"), document.fonts.load("bold 10px 'Inter Tight'")]),
      new Promise(r=>setTimeout(r,700)) ]); }catch(e){} }
  inst = $('#instrument').value;
  applyTradeGating();
  const date = $('#date').value;
  if(!latest && !date){ setStatus('Pick a date first.',true); return; }
  localStorage.setItem('br_inst',inst); if(date) localStorage.setItem('br_date',date);
  if(live) stopLive();
  for(const k in tfData) delete tfData[k];
  suppressDrawSave=true; clearTimeout(drawSaveTimer);   // clear+reload jangan timpa storage (restore di akhir)
  try{ cancelPendingPushFor(inst); }catch(_){}   // buang dorongan basi instrumen yg sama (js/draw-sync.js)
  try{ renderDrawConflict(); }catch(_){}   // banner bentrok ikut `inst`: sembunyikan/tampilkan sesuai simbol baru (js/draw-sync.js)
  clearDrawings(); resetTrade();
  chart.setPriceVolumePrecision(priceDecimals(),0);
  setStatus('Fetching '+inst+' '+currentTF+' …');
  const loadTok = chartLoad.show(inst);
  try{
    const todayStr=new Date().toISOString().slice(0,10);
    const opt = (latest || !date || date>=todayStr) ? {count:5000} : {count:5000,to:date+'T00:00:00Z'};
    const c = await fetchCandles(currentTF,opt);
    if(!c.length) throw new Error('data kosong');
    tfData[currentTF]=c;
  }catch(e){ suppressDrawSave=false; chartLoad.hide(loadTok); setStatus('Failed to load: '+e.message,true); return; }
  const a=tfData[currentTF];
  T = cursorAtNewest(currentTF, a);
  lastLen=-1;
  setStatus(`Loaded ${currentTF}. Next/Play to advance (auto-extend forward). Change TF above the chart.`);
  render(true);
  chartLoad.hide(loadTok);   // data ter-render → tutup overlay lunar (hanya bila panggilan terbaru)
  setReplayUI(false);   // Load → kembali ke realtime (keluar mode replay bila aktif)
  startLive();          // live = default
  try{ clearMeasure(); }catch(_){}   // ganti instrumen → hasil ukur instrumen lama dibuang (js/measure.js)
  try{
    await restoreDraws();   // sumbernya server → async; menunggunya sebelum melepas suppressDrawSave
  }finally{
    // WAJIB jalan walau restoreDraws melempar: suppressDrawSave tak boleh nyangkut true —
    // itu berarti penyimpanan gambar mati diam2 utk sisa sesi (lihat review Task 3, ronde 1).
    suppressDrawSave=false; clearTimeout(drawSaveTimer);
  }
  try{ resetDrawHistory(); }catch(e){}   // history undo/redo bersifat per-instrumen → reset
}

async function fetchCandles(tf,{count,to,from}){
  let u=`/api/candles?instrument=${encodeURIComponent(inst)}&granularity=${GRAN[tf]||tf}&count=${count||5000}`;
  if(to)   u+=`&to=${encodeURIComponent(to)}`;
  if(from) u+=`&from=${encodeURIComponent(from)}`;
  const r=await fetch(u); const j=await r.json();
  if(j.errorMessage) throw new Error(j.errorMessage);
  if(!j.candles) throw new Error('respons tak terduga');
  return j.candles.filter(c=>c.complete).map(c=>({
    timestamp:Date.parse(c.time), open:+c.mid.o, high:+c.mid.h, low:+c.mid.l, close:+c.mid.c, volume:+(c.volume||0),
  })).sort((a,b)=>a.timestamp-b.timestamp);
}
// setStatus(t,err) — dulu menulis ke #status di header (nempel ke profile). Kini HANYA error
// (err=true) yang dimunculkan sbg toast; pesan info/progres (Fetching/Loaded/instruksi/cancel)
// sengaja disenyapkan supaya toast hanya berisi yang penting. Konfirmasi aksi penting pakai
// toast(...,'success') langsung di call-site-nya.
function setStatus(t,err){
  if(!t || !err) return;
  toast(t, 'error');
}

