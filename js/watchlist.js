// ===================== watchlist & price alert (Fase 1d) =====================
const WATCH_SYMS = [...document.querySelectorAll('#instrument option')].map(o=>o.value);
// desimal tampil per simbol. Indices/crypto CFD & metal punya presisi khusus (dari OANDA
// displayPrecision) → tabel eksak dulu, sisanya fallback substring (FX 5, JPY 3, metal 3).
const SYM_DECIMALS = {
  SPX500_USD:1, NAS100_USD:1, US30_USD:1, DE30_EUR:1, UK100_GBP:1, FR40_EUR:1, EU50_EUR:1,
  JP225_USD:1, AU200_AUD:1, HK33_HKD:1, US2000_USD:3, ETH_USD:2, LTC_USD:2, BCH_USD:2,
  WTICO_USD:3, BCO_USD:3, NATGAS_USD:3,
};
function symDecimals(s){ const im=IPK_META[s]; if(im&&im.decimals!=null) return im.decimals; if(SYM_DECIMALS[s]!=null) return SYM_DECIMALS[s];
  return s.includes('BTC')?1 : s.includes('DXY')?3 : s.includes('JPY')?3 : (s.includes('XAU')||s.includes('XAG'))?3 : 5; }
// toast feedback ringan (alert berbunyi / pending tereksekusi) — terlihat tanpa mengandalkan setStatus
let toastTimer=null;
const TOAST_MS=3800;   // durasi tampil + panjang animasi drain bar
// ikon per varian (stroke=currentColor → ikut warna .toast-ic per tipe)
const TOAST_IC={
  success:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.4" x2="12" y2="16.4"/></svg>',
  warn:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12" y2="17"/></svg>',
  info:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.6"/></svg>'
};
// toast(msg, type) — type: success | error | warning/warn | info (default). Backward-compatible.
const TOAST_CLOSE_IC='<button class="toast-close" type="button" aria-label="Dismiss"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>';
function toast(msg, type){
  type = type||'info'; if(type==='warning') type='warn';
  let el=$('#toast'); if(!el){ el=document.createElement('div'); el.id='toast'; document.body.appendChild(el); }
  el.className='toast t-'+type;
  el.innerHTML=(TOAST_IC[type]||TOAST_IC.info)+'<span class="toast-msg"></span>'+TOAST_CLOSE_IC+'<div class="toast-bar"></div>';
  el.querySelector('.toast-msg').textContent=msg;
  const hide=()=>{ clearTimeout(toastTimer); toastTimer=null; el.classList.remove('show'); };
  el.querySelector('.toast-close').onclick=hide;   // close paksa
  const bar=el.querySelector('.toast-bar');
  void el.offsetWidth;                        // reflow → transisi re-trigger utk toast berturut
  el.classList.add('show');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){   // drain bar penuh → habis selama TOAST_MS
    bar.style.transition='none'; bar.style.transform='scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition='transform '+TOAST_MS+'ms linear'; bar.style.transform='scaleX(0)';
  }
  clearTimeout(toastTimer); toastTimer=setTimeout(hide,TOAST_MS);
}
// quote harga terkini (candle harian: candle terakhir = hari berjalan/incomplete = harga live)
async function fetchQuote(sym){
  try{
    const r=await fetch(`/api/candles?instrument=${encodeURIComponent(sym)}&granularity=D&count=2`);
    const j=await r.json(); if(!j.candles||!j.candles.length) return null;
    const cs=j.candles, c0=cs[cs.length-1], last=+c0.mid.c, prev=cs.length>1?+cs[cs.length-2].mid.c:last;
    return {last, chg: prev?(last-prev)/prev*100:0, hi:+c0.mid.h, lo:+c0.mid.l};
  }catch(e){ return null; }
}
async function refreshQuotes(){
  await Promise.all(WATCH_SYMS.map(async s=>{ const q=await fetchQuote(s); if(q) quoteCache[s]=q; }));
  renderWatch(); renderHeaderPrice();
}
function pipOf(s){ return Math.pow(10, -(symDecimals(s)-1)); }   // pip per simbol (FX 1e-4, JPY 1e-2, dst)
// batas atas spread indikatif (dalam pip) per instrumen. Closeout spread broker utk metal/kripto
// bisa sangat lebar (mis. XAU ~$20, BTC ~$443) → menyesatkan di backtester. FX yg sudah tight tak terdampak.
function maxSpreadPips(s){
  if(s.includes('XAU')) return 50;     // emas ~ s/d $0.50
  if(s.includes('XAG')) return 40;     // perak
  if(s.includes('BTC')) return 80;     // kripto ~ s/d $80
  if(s==='ETH_USD'||s==='LTC_USD'||s==='BCH_USD') return 300;   // crypto CFD (pip 0.1) → spread $ bisa lebar
  if(SYM_DECIMALS[s]!=null) return 200;                          // indices CFD → spread beberapa poin, longgar
  return 30;                            // FX major/minor & JPY (real biasanya 1–15, jadi aman)
}
// ---- Markets: favourites + open-frequency + curated "popular" ----
// Kurasi "populer": subset yg tampil default per grup di panel (sisanya via "Show all").
const POPULAR_SYMS = new Set([
  'EUR_USD','GBP_USD','USD_JPY','AUD_USD','USD_CAD',
  'XAU_USD','XAG_USD','WTICO_USD','BCO_USD',
  'DXY','SPX500_USD','NAS100_USD','US30_USD','BTC_USD','ETH_USD',
  'STOCK:BBCA.JK','STOCK:BBRI.JK','STOCK:BMRI.JK','STOCK:TLKM.JK','STOCK:ASII.JK','STOCK:GOTO.JK',
  'STOCK:AAPL','STOCK:TSLA','STOCK:NVDA','STOCK:MSFT','STOCK:AMZN',
  'STOCK:SPY','STOCK:QQQ',
]);
const MOST_OPENED_N = 5;
// favourite instrumen (bintang) — pola sama dgn favorit TF (br_tfFav).
function loadInstFav(){ try{ const a=JSON.parse(localStorage.getItem('br_instFav')); if(Array.isArray(a)) return a.filter(s=>WATCH_SYMS.includes(s)); }catch(e){} return []; }
let instFav = loadInstFav();
function saveInstFav(){ try{ localStorage.setItem('br_instFav', JSON.stringify(instFav)); }catch(e){} }
function isInstFav(s){ return instFav.includes(s); }
function toggleInstFav(s){ const i=instFav.indexOf(s); if(i>=0) instFav.splice(i,1); else instFav.push(s);
  saveInstFav(); refreshMostOpened();   // fav & most-opened saling eksklusif → sinkron
  buildWatch(); if(typeof ipickOpen!=='undefined' && ipickOpen) renderIpick($('#ipickQ')?$('#ipickQ').value:''); }
// frekuensi buka per simbol (client-side, per-device) → seksi "Most opened".
function loadInstFreq(){ try{ const o=JSON.parse(localStorage.getItem('br_instFreq')); if(o&&typeof o==='object') return o; }catch(e){} return {}; }
let instFreq = loadInstFreq();
function saveInstFreq(){ try{ localStorage.setItem('br_instFreq', JSON.stringify(instFreq)); }catch(e){} }
function bumpInstFreq(s){ const e=instFreq[s]||{c:0,t:0}; e.c++; e.t=Date.now(); instFreq[s]=e;
  const keys=Object.keys(instFreq);   // prune: simpan ~top-50 by count agar tak tumbuh tanpa batas
  if(keys.length>60){ keys.sort((a,b)=>(instFreq[b].c-instFreq[a].c)||(instFreq[b].t-instFreq[a].t)); keys.slice(50).forEach(k=>delete instFreq[k]); }
  saveInstFreq(); }
let mostOpenedSnap = [];   // di-refresh saat load / panel dibuka / fav berubah (bukan tiap klik → anti layout-jump)
function refreshMostOpened(){
  mostOpenedSnap = Object.keys(instFreq)
    .filter(s=>WATCH_SYMS.includes(s) && !isInstFav(s))
    .sort((a,b)=>(instFreq[b].c-instFreq[a].c)||(instFreq[b].t-instFreq[a].t))
    .slice(0, MOST_OPENED_N);
}
refreshMostOpened();
// accordion (collapse) & "show all" per grup — persist.
function wlLoadState(k){ try{ const o=JSON.parse(localStorage.getItem(k)); if(o&&typeof o==='object') return o; }catch(e){} return {}; }
let wlCollapse = wlLoadState('br_wlCollapse');
let wlShowAll  = wlLoadState('br_wlShowAll');
function saveWLState(){ try{ localStorage.setItem('br_wlCollapse',JSON.stringify(wlCollapse)); localStorage.setItem('br_wlShowAll',JSON.stringify(wlShowAll)); }catch(e){} }

// Watchlist di-render dua tahap: buildWatch() membangun struktur (grup/fav/most-opened)
// & mengumpulkan node baris SEKALI, lalu updateWatch() cuma menimpa harga/class tiap tick.
// Ini mencegah kedip (:hover/.on tak lepas) & klik hilang. buildWatch dipanggil ulang hanya
// saat STRUKTUR berubah (fav/collapse/show-all); pilih instrumen biasa → updateWatch saja.
function wlRowHTML(s){
  return `<div class="wl-row" data-sym="${s}">`
    +`<button class="wl-star${isInstFav(s)?' fav':''}" type="button" data-fav="${s}" title="${isInstFav(s)?'Remove from favourites':'Add to favourites'}" aria-label="Toggle favourite">★</button>`
    +`<span class="wl-sym">${dispSym(s)}</span>`
    +`<span class="wl-bid">—</span><span class="wl-ask">—</span>`
    +`<span class="wl-spr">—</span><span class="wl-num wl-hi">—</span><span class="wl-num wl-lo">—</span></div>`;
}
function wlGrpHTML(key,label,count,opts){ opts=opts||{};
  const cls='wl-grp'+(opts.cls?(' '+opts.cls):'')+(wlCollapse[key]?' collapsed':'');
  let right=''; if(opts.showAll){ const g=opts.showAll.grp;
    right=`<button class="wl-showall" type="button" data-showall="${g}">${wlShowAll[g]?'Show less':('Show all '+opts.showAll.total)}</button>`; }
  return `<div class="${cls}" data-grp="${key}"><span class="wl-chev" aria-hidden="true">▾</span>`
    +`<span class="wl-glbl">${label}</span><span class="wl-cnt">${count}</span>${right}</div>`;
}
function buildWatch(){
  const box=$('#wlRows'); if(!box) return;
  wlNodes={};
  let html=`<div class="wl-row wl-hdr"><span class="wl-sym">Symbol</span><span>Bid</span><span>Ask</span><span>Spread</span><span>Day&nbsp;Hi</span><span>Day&nbsp;Lo</span></div>`;
  // Favourites (selalu tampil; hint bila kosong)
  html+=wlGrpHTML('@fav','Favourites',instFav.length,{cls:'fav'});
  if(!wlCollapse['@fav']){
    if(instFav.length) instFav.forEach(s=>{ if(WATCH_SYMS.includes(s)) html+=wlRowHTML(s); });
    else html+=`<div class="wl-grp-empty">Tap ★ on any instrument to pin it here.</div>`;
  }
  // Most opened (sembunyi bila belum ada data)
  if(mostOpenedSnap.length){
    html+=wlGrpHTML('@recent','Most opened',mostOpenedSnap.length,{cls:'recent'});
    if(!wlCollapse['@recent']) mostOpenedSnap.forEach(s=>html+=wlRowHTML(s));
  }
  html+=`<div class="wl-sep"></div>`;
  // grup per IPK_GROUPS — default hanya populer, "Show all" → seluruh anggota
  for(const g of IPK_GROUPS){
    const all=WATCH_SYMS.filter(s=>ipkMeta(s).grp===g); if(!all.length) continue;
    const pop=all.filter(s=>POPULAR_SYMS.has(s));
    const base=(wlShowAll[g]||!pop.length)?all:pop;   // tanpa entri populer → tampilkan semua
    const showAll=(pop.length && all.length>pop.length)?{grp:g,total:all.length}:null;
    html+=wlGrpHTML(g,g,base.length,{showAll});
    if(!wlCollapse[g]) base.forEach(s=>html+=wlRowHTML(s));
  }
  box.innerHTML=html;
  // kumpulkan ref node (sym bisa muncul di >1 seksi → array)
  box.querySelectorAll('.wl-row[data-sym]').forEach(row=>{ const s=row.dataset.sym;
    (wlNodes[s]=wlNodes[s]||[]).push({ row, bid:row.querySelector('.wl-bid'), ask:row.querySelector('.wl-ask'),
      spr:row.querySelector('.wl-spr'), hi:row.querySelector('.wl-hi'), lo:row.querySelector('.wl-lo') }); });
  // satu listener terdelegasi: bintang > show-all > header grup > baris instrumen
  box.onclick=e=>{
    const fav=e.target.closest('.wl-star[data-fav]'); if(fav){ e.stopPropagation(); toggleInstFav(fav.dataset.fav); return; }
    const sa=e.target.closest('.wl-showall[data-showall]'); if(sa){ e.stopPropagation(); const g=sa.dataset.showall; wlShowAll[g]=!wlShowAll[g]; saveWLState(); buildWatch(); return; }
    const grp=e.target.closest('.wl-grp[data-grp]'); if(grp){ const k=grp.dataset.grp; wlCollapse[k]=!wlCollapse[k]; saveWLState(); buildWatch(); return; }
    const r=e.target.closest('.wl-row[data-sym]'); if(r) selectSymbol(r.dataset.sym);
  };
  wlBuilt=true; wlKey=wlStructKey();
  updateWatch();
}
// util set teks hanya bila berubah (minim repaint)
function setTxt(el,v){ if(el.textContent!==v) el.textContent=v; }
function updateWatch(){
  for(const s in wlNodes){
    const nodes=wlNodes[s], q=quoteCache[s], lt=liveTicks[s], dec=symDecimals(s), pip=pipOf(s);
    const has=!!(q||lt); let bid,ask,sprd,chg=q?q.chg:0,up=chg>=0;
    if(has){
      if(lt){ bid=lt.bid; ask=lt.ask; sprd=ask-bid; }                 // bid/ask realtime
      else { sprd=pip*1.6; bid=q.last-sprd/2; ask=q.last+sprd/2; }    // fallback sintetis dari candle harian
      // clamp spread yg tak wajar (closeout broker metal/kripto) → indikatif, di-tengah-kan pada mid
      const cap=maxSpreadPips(s)*pip;
      if(sprd>cap){ const mid=(bid+ask)/2; sprd=cap; bid=mid-cap/2; ask=mid+cap/2; }
    }
    nodes.forEach(n=>{
      n.row.classList.toggle('on', s===inst);
      if(!has){ setTxt(n.bid,'—'); setTxt(n.ask,'—'); setTxt(n.spr,'—'); setTxt(n.hi,'—'); setTxt(n.lo,'—'); n.row.removeAttribute('title'); return; }
      setTxt(n.bid,bid.toFixed(dec)); n.bid.classList.toggle('up',up); n.bid.classList.toggle('down',!up);
      setTxt(n.ask,ask.toFixed(dec)); n.ask.classList.toggle('up',up); n.ask.classList.toggle('down',!up);
      setTxt(n.spr,(sprd/pip).toFixed(1));
      setTxt(n.hi, q&&q.hi!=null?q.hi.toFixed(dec):'—');
      setTxt(n.lo, q&&q.lo!=null?q.lo.toFixed(dec):'—');
      n.row.title=(chg>=0?'+':'')+chg.toFixed(2)+'% today';
    });
  }
}
// signature struktur: rebuild hanya bila berubah, else update harga in-place
function wlStructKey(){ return instFav.join(',')+'|'+mostOpenedSnap.join(',')+'|'+JSON.stringify(wlCollapse)+'|'+JSON.stringify(wlShowAll); }
let wlKey='';
function renderWatch(){ if(!wlBuilt || wlKey!==wlStructKey()) buildWatch(); else updateWatch(); }
function selectSymbol(s){ if(s===inst) return; track('symbol',{sym:s}); bumpInstFreq(s); $('#instrument').value=s; inst=s; guessPip(); renderWatch(); syncIpickTrigger(); updateChartWM(); renderHeaderPrice(); try{drawPaperLines();}catch(e){} applyTradeGating(); loadInit(true);
  if(typeof refreshNewsData==='function') refreshNewsData();   // instrumen berubah → sync bias card + marker (walau panel tertutup)
}

