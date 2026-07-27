// ===================== live auto-refresh (interval menyesuaikan TF) =====================
const LIVE_MIN = 10000, LIVE_MAX = 300000;   // poll: min 10 dtk, maks 5 mnt
// interval ≈ seperempat periode TF, dibatasi [10dtk, 5mnt]
function liveInterval(tf){ return Math.min(LIVE_MAX, Math.max(LIVE_MIN, DUR[tf]/4)); }
function liveLabel(ms){ return ms>=60000 ? (ms/60000).toFixed(ms%60000?1:0)+'m' : (ms/1000)+'s'; }

// Live = default (realtime); tak ada tombol on/off. start/stop dipakai internal:
// start saat data dimuat / keluar replay, stop saat masuk replay.
function startLive(){
  if(T==null) return;
  live=true;
  scheduleLive();
  fetchFormingSeed();                                   // seed OHLC periode berjalan secepatnya
  clearInterval(formingTimer); formingTimer=setInterval(fetchFormingSeed, 5000);
  updatePriceTimer();
}
function stopLive(){
  live=false; clearTimeout(liveTimer); liveTimer=null;
  clearInterval(formingTimer); formingTimer=null; formingSeed=null;
  clearFormingBar();
  if(T!=null){ lastLen=-1; render(true); }   // buang candle berjalan dari chart
  updatePriceTimer();
}
// Ambil candle INCOMPLETE OANDA (count=2 → [complete terakhir, forming]) sbg basis OHLC
// periode berjalan. Ini memuat high/low yang sudah terjadi SEBELUM klien mulai streaming
// (mis. wick atas di awal jam) — yang tak bisa direkonstruksi dari tick mid saja.
async function fetchFormingSeed(){
  if(!live || marketClosed()) return;
  const tf=currentTF, sym=inst;
  try{
    const r=await fetch(`/api/candles?instrument=${encodeURIComponent(sym)}&granularity=${GRAN[tf]||tf}&count=2`);
    const j=await r.json();
    if(tf!==currentTF || sym!==inst || !j.candles) return;     // TF/pair keburu ganti
    const inc=j.candles.find(c=>c.complete===false);
    // Candle TUTUP terakhir yang server punya. Dipakai pushFormingCandle utk tahu apakah data
    // lokal ketinggalan (server punya bar tutup yang belum kita muat) — satu-satunya cara
    // membedakan "boundary non-grid yang sah" (H4/D/akhir pekan) dari "kita yang tertinggal".
    const done=j.candles.filter(c=>c.complete!==false);
    const prevTs=done.length ? Date.parse(done[done.length-1].time) : null;
    formingSeed = inc ? {tf, inst:sym, prevTs, candle:{
      timestamp:Date.parse(inc.time), open:+inc.mid.o, high:+inc.mid.h, low:+inc.mid.l, close:+inc.mid.c, volume:+(inc.volume||0)
    }} : null;
  }catch(e){}
}
// setTimeout (bukan setInterval) agar interval ikut berubah saat TF diganti
function scheduleLive(){
  clearTimeout(liveTimer);
  liveTimer=setTimeout(async()=>{
    if(!live) return;
    try{ await liveRefresh(); }catch(e){}
    if(live) scheduleLive();
  }, liveInterval(currentTF));
}
async function liveRefresh(){
  const tf=currentTF, arr=tfData[tf];
  if(!arr||!arr.length) return;
  const oldLast = arr[arr.length-1].timestamp;
  const atEdge  = T >= oldLast + DUR[tf];   // cursor menempel di candle terakhir → ikut maju
  await autoExtend(tf);
  if(tf!==currentTF) return;                 // TF keburu diganti saat fetch
  const a=tfData[tf];
  const fresh = a.filter(c=>c.timestamp>oldLast);
  if(!fresh.length) return;                  // belum ada candle baru yang close
  if(atEdge){
    fresh.forEach(c=>onNewBar(c));             // cek pending + SL/TP pada candle baru
    T = a[a.length-1].timestamp + DUR[tf];
    render();                                  // incremental (updateData): candle baru di-append TANPA applyNewData.
  }                                            //   applyNewData menyentak viewport ke bar terakhir → hilang posisi scroll/zoom
                                               //   user (mis. sedang lihat histori). updateData mempertahankannya.
  // jika tidak atEdge: candle ikut tersimpan diam-diam, user tetap di posisi review-nya
}

