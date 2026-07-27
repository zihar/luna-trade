// ===================== live price stream (SSE /api/prices) =====================
// Satu EventSource → semua simbol watchlist. Throttle render via rAF (tick bisa
// berkali-kali/detik saat pasar ramai). Reconnect manual berbackoff (EventSource
// tak selalu auto-reconnect, mis. saat respons non-200/503).
let priceES=null, priceConnected=false, priceBackoff=1000, priceRenderQueued=false;
let lastStreamActivity=Date.now();   // waktu aktivitas SSE terakhir (tick/ping/open) — dasar deteksi "mati diam"
function setLiveDot(){ const d=$('#wlLive'); if(d){ d.classList.toggle('on',priceConnected); d.title=priceConnected?'Live price connected':'Live price disconnected'; } }
function queuePriceRender(){
  if(priceRenderQueued) return; priceRenderQueued=true;
  requestAnimationFrame(()=>{ priceRenderQueued=false;
    renderHeaderPrice();
    if(!$('#watchlist').classList.contains('hidden')) renderWatch();
    if(ipickOpen) updateIpickPrices();   // dropdown instrumen: refresh harga in-place saat terbuka
    if(live){ pushFormingCandle(); renderOrderPanel(); updatePriceTimer(); }  // gerak chart+panel tiap tick (Live)
    secondaries.forEach(sc=>{ try{ sc.tick(); }catch(e){} });                  // panel sekunder gerak tiap tick
  });
}
function connectPriceStream(){
  try{ if(priceES) priceES.close(); }catch(e){}
  priceES=new EventSource('/api/prices');
  priceES.onopen=()=>{ priceConnected=true; priceBackoff=1000; lastStreamActivity=Date.now(); setLiveDot(); };
  priceES.onmessage=(e)=>{
    lastStreamActivity=Date.now();
    let t; try{ t=JSON.parse(e.data); }catch(_){ return; }
    if(!t||!t.instrument) return;
    liveTicks[t.instrument]={bid:t.bid, ask:t.ask, time:t.time};
    if(!priceConnected){ priceConnected=true; setLiveDot(); }
    queuePriceRender();
  };
  // keepalive server (event bernama 'ping') → bukti koneksi hidup walau tak ada tick (market tutup)
  priceES.addEventListener('ping', ()=>{ lastStreamActivity=Date.now(); if(!priceConnected){ priceConnected=true; setLiveDot(); } });
  priceES.onerror=()=>{
    priceConnected=false; setLiveDot();
    try{ priceES.close(); }catch(e){}                 // ambil alih reconnect sepenuhnya
    setTimeout(connectPriceStream, priceBackoff);
    priceBackoff=Math.min(priceBackoff*2, 30000);
  };
}

// ===================== auto-recover live-stream (anti-freeze idle lama) =====================
// SSE bisa "mati diam" (TCP half-open saat sleep/ganti jaringan) tanpa memicu onerror,
// dan rAF beku di tab non-aktif bikin render nyangkut. Watchdog + visibilitychange
// memulihkan tanpa reload halaman. Ambang: lihat spec 2026-07-23-live-stream-auto-recover.
const STREAM_STALE_MS=40000, WATCHDOG_MS=10000, SLEEP_DRIFT_MS=60000;
let lastWatchdogRun=Date.now();
function recoverLive(){
  priceRenderQueued=false;                       // lepas flag rAF yg mungkin nyangkut di tab non-aktif
  connectPriceStream();                          // reconnect (tutup ES lama, buka baru)
  if(live){ try{ liveRefresh().catch(()=>{}); }catch(e){} }   // tarik candle terbaru (OHLC otoritatif)
  queuePriceRender();
}
function streamWatchdog(){
  const now=Date.now();
  const slept=(now-lastWatchdogRun)>WATCHDOG_MS+SLEEP_DRIFT_MS;  // watchdog fire jauh telat = mesin habis sleep
  lastWatchdogRun=now;
  if(document.visibilityState!=='visible') return;              // pulihkan hanya saat user bisa lihat
  const stale=(now-lastStreamActivity)>STREAM_STALE_MS;         // tick+ping terlewat ≈2–3× → kemungkinan mati diam
  if(slept || stale || !priceConnected) recoverLive();
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible') return;
  priceRenderQueued=false; queuePriceRender();                  // selalu flush render (glance cepat: tanpa churn reconnect)
  if(!priceConnected || (Date.now()-lastStreamActivity)>STREAM_STALE_MS) recoverLive();
});

