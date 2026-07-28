// ===================== multi-chart (panel sekunder, view-only) =====================
// Panel utama (#chart, slot 0) = chart penuh (trading/drawing/replay). Panel sekunder
// (slot 1..) = chart ringan: hanya tampilkan candle + lilin live simbol/TF sendiri.
// Tanpa drawing/trading. Double-click header → muat simbol+TF-nya ke panel utama.
const SEC_DEFAULTS=['GBP_USD','USD_JPY','XAU_USD'];
function savedSecConfig(){ try{ const a=JSON.parse(localStorage.getItem('br_sec')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function persistSec(){ try{ localStorage.setItem('br_sec', JSON.stringify(secondaries.map(s=>({sym:s.sym,tf:s.tf})))); }catch(e){} }

function makeSecondary(slot){
  const panel=document.createElement('div'); panel.className='cpanel'; panel.dataset.slot=slot;
  const hd=document.createElement('div'); hd.className='cpanel-hd';
  const sel=document.createElement('select'); sel.className='cp-sym';
  WATCH_SYMS.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s.replace('_','/'); sel.appendChild(o); });
  // TF: favorit (+ TF aktif panel) sebagai tombol + dropdown ▾ (favorit berbagi dgn chart utama)
  const tfWrapEl=document.createElement('span'); tfWrapEl.className='cp-tfwrap';
  const tfs=document.createElement('span'); tfs.className='cp-tfs';
  const moreBtn=document.createElement('button'); moreBtn.className='cp-tf cp-more'; moreBtn.textContent='▾'; moreBtn.title='Timeframes';
  const menu=document.createElement('div'); menu.className='tf-menu cp-tf-menu';
  tfWrapEl.appendChild(tfs); tfWrapEl.appendChild(moreBtn); tfWrapEl.appendChild(menu);
  const last=document.createElement('span'); last.className='cp-last';
  const act=document.createElement('button'); act.className='cp-act'; act.textContent='⌖';
  act.title='Jadikan panel aktif (trading & drawing pindah ke sini)';
  hd.appendChild(sel); hd.appendChild(tfWrapEl); hd.appendChild(last); hd.appendChild(act);
  const cdiv=document.createElement('div'); cdiv.className='cp-chart';
  panel.appendChild(hd); panel.appendChild(cdiv);

  const light=document.body.classList.contains('light');
  const c=klinecharts.init(cdiv,{styles:light?lightStyles:darkStyles, timezone:chartTZ, customApi:{formatDate:chartFormatDate}});
  try{ c.setStyles({candle:{type:chartType, bar:candleBarCfg()}}); }catch(e){}   // ikut warna & tipe candle kustom user
  fixClickSwallow(c, cdiv);                                                      // drawing bisa pindah ke panel ini → butuh penawar klik-tertelan yg sama
  attachPriceScale(cdiv, c);    // skala harga via scroll di sumbu (sama spt panel utama)
  const ro=new ResizeObserver(()=>{ try{c.resize();}catch(e){} }); ro.observe(cdiv);

  const sc={ slot, panel, chart:c, el:cdiv, selEl:sel, tfsEl:tfs, menuEl:menu, moreEl:moreBtn, lastEl:last,
    sym:'EUR_USD', tf:'M15', data:[], forming:null, ro, rollTimer:null,
    // tombol = favorit (urut kanonik) + TF aktif panel bila bukan favorit (tampil sementara)
    rebuildTFBar(){
      const show=TF_LIST.filter(tf=> tfFav.includes(tf) || tf===this.tf);
      tfs.innerHTML='';
      show.forEach(tf=>{
        const b=document.createElement('button');
        b.className='cp-tf'+(tf===this.tf?' on':''); b.dataset.tf=tf; b.textContent=TF_LABEL[tf]||tf;
        b.onclick=()=>{ this.tf=tf; this.rebuildTFBar(); this.load(); persistSec(); };
        tfs.appendChild(b);
      });
    },
    buildMenu(){
      menu.innerHTML='';
      TF_LIST.forEach(tf=>{
        const row=document.createElement('div'); row.className='tf-row'+(tf===this.tf?' on':'');
        const lbl=document.createElement('span'); lbl.className='tf-lbl'; lbl.textContent=TF_LABEL[tf]||tf;
        lbl.onclick=()=>{ this.closeMenu(); this.tf=tf; this.rebuildTFBar(); this.load(); persistSec(); };
        const fav=tfFav.includes(tf);
        const star=document.createElement('span'); star.className='tf-star'+(fav?' fav':''); star.textContent='★';
        star.title=fav?'Remove from favorites':'Add to favorites';
        star.onclick=(e)=>{ e.stopPropagation(); toggleTFFav(tf); };   // favorit dipakai bersama → refresh semua bar
        row.append(lbl,star); menu.appendChild(row);
      });
    },
    openMenu(){ closeAllTFMenus(); this.buildMenu(); menu.classList.add('open'); moreBtn.classList.add('on'); },
    closeMenu(){ menu.classList.remove('open'); moreBtn.classList.remove('on'); },
    highlightTF(){ this.rebuildTFBar(); if(menu.classList.contains('open')) this.buildMenu(); },
    setSymTF(sym,tf){ this.sym=sym; this.tf=tf; },
    async load(){
      sel.value=this.sym; this.highlightTF(); this.forming=null;
      try{
        const u=`/api/candles?instrument=${encodeURIComponent(this.sym)}&granularity=${GRAN[this.tf]||this.tf}&count=2000`;
        const r=await fetch(u); const j=await r.json();
        if(!j.candles) return;
        this.data=j.candles.filter(x=>x.complete).map(x=>({timestamp:Date.parse(x.time),open:+x.mid.o,high:+x.mid.h,low:+x.mid.l,close:+x.mid.c,volume:+(x.volume||0)})).sort((a,b)=>a.timestamp-b.timestamp);
        try{ this.chart.setPriceVolumePrecision(decimalsFor(this.sym),0); }catch(e){}
        this.chart.applyNewData(this.data);
      }catch(e){}
    },
    tick(){
      const t=liveTicks[this.sym]; if(!t) return;
      const mid=(t.bid+t.ask)/2; if(!isFinite(mid)) return;
      this.lastEl.textContent=mid.toFixed(decimalsFor(this.sym));
      if(!this.data.length) return;
      const last=this.data[this.data.length-1];
      const dur=DUR[this.tf], now=Date.now();
      // dua kemungkinan: (a) candle terakhir di data = periode BERJALAN (now masih di
      // dalamnya, mis. OANDA sudah kirim candle ini / skew jam) → update DI TEMPAT, seed
      // dari OHLC-nya; (b) candle terakhir = periode LAMPAU → forming = bar baru sesudahnya.
      let openTs, sOpen, sHi, sLo;
      if(now < last.timestamp+dur){
        openTs=last.timestamp; sOpen=last.open; sHi=last.high; sLo=last.low;     // (a)
      } else {
        openTs=last.timestamp+dur; sOpen=last.close; sHi=last.close; sLo=last.close;  // (b)
        if(now>=openTs+dur) this.scheduleRoll();    // periode forming pun sudah lewat → tarik candle baru
      }
      if(!this.forming || this.forming.timestamp!==openTs){
        this.forming={timestamp:openTs,open:sOpen,high:Math.max(sHi,mid),low:Math.min(sLo,mid),close:mid,volume:0};
      } else {
        this.forming.close=mid; this.forming.high=Math.max(this.forming.high,mid); this.forming.low=Math.min(this.forming.low,mid);
      }
      try{ this.chart.updateData(this.forming); }catch(e){}
    },
    scheduleRoll(){ if(this.rollTimer) return; this.rollTimer=setTimeout(()=>{ this.rollTimer=null; this.roll(); },1500); },
    async roll(){
      try{
        const u=`/api/candles?instrument=${encodeURIComponent(this.sym)}&granularity=${GRAN[this.tf]||this.tf}&count=3`;
        const r=await fetch(u); const j=await r.json(); if(!j.candles) return;
        const fresh=j.candles.filter(x=>x.complete).map(x=>({timestamp:Date.parse(x.time),open:+x.mid.o,high:+x.mid.h,low:+x.mid.l,close:+x.mid.c,volume:+(x.volume||0)})).sort((a,b)=>a.timestamp-b.timestamp);
        const lastTs=this.data.length?this.data[this.data.length-1].timestamp:0; let added=false;
        fresh.forEach(c=>{ if(c.timestamp>lastTs){ this.data.push(c); try{this.chart.updateData(c);}catch(e){} added=true; } });
        if(added) this.forming=null;
      }catch(e){}
    },
    dispose(){ try{this.ro.disconnect();}catch(e){} if(this.rollTimer)clearTimeout(this.rollTimer); try{klinecharts.dispose(this.el);}catch(e){} try{this.panel.remove();}catch(e){} }
  };

  sel.onchange=()=>{ sc.sym=sel.value; sc.load(); persistSec(); };
  moreBtn.onclick=(e)=>{ e.stopPropagation(); menu.classList.contains('open')?sc.closeMenu():sc.openMenu(); };
  act.onclick=()=>activatePanel(sc);
  hd.ondblclick=(e)=>{ if(e.target===sel || e.target.closest('.cp-tfwrap') || e.target===act) return; activatePanel(sc); };
  sc.rebuildTFBar();
  return sc;
}

// muat simbol+TF ke chart utama (panel penuh: trading/drawing/replay)
function focusIntoPrimary(sym,tf){
  currentTF=tf; localStorage.setItem('br_tf',tf); highlightTF();
  $('#instrument').value=sym; guessPip(); renderWatch(); loadInit(true);
}
// tukar dua node bersaudara di DOM (posisi grid ikut DOM order)
function swapNodes(a,b){
  if(!a||!b||a===b) return;
  const m=document.createComment(''); a.parentNode.insertBefore(m,a);
  b.parentNode.insertBefore(a,b); m.parentNode.insertBefore(b,m); m.remove();
}
function markActivePanel(){
  document.querySelectorAll('#chartgrid .cpanel').forEach(p=>p.classList.toggle('active', p.classList.contains('cpanel-pri')));
}
// jadikan panel sekunder `sc` sebagai panel AKTIF: panel utama (penuh) pindah ke
// posisi sc & ambil simbol/TF-nya; sc bertukar tempat & menampilkan simbol lama utama.
function activatePanel(sc){
  const grid=$('#chartgrid'), pri=grid.querySelector('.cpanel-pri'); if(!pri) return;
  const oldInst=inst, oldTF=currentTF, newInst=sc.sym, newTF=sc.tf;
  swapNodes(pri, sc.panel);
  sc.setSymTF(oldInst, oldTF); sc.load(); persistSec();   // sekunder ambil simbol lama panel utama
  focusIntoPrimary(newInst, newTF);                        // panel utama ambil simbol panel terpilih
  markActivePanel(); resizeAllCharts();
}
function resizeAllCharts(){ requestAnimationFrame(()=>{ try{chart.resize();}catch(e){} secondaries.forEach(sc=>{try{sc.chart.resize();}catch(e){}}); try{updatePriceTimer();}catch(e){} }); }

function setLayout(n){
  chartLayout=n; localStorage.setItem('br_layout',n);
  const grid=$('#chartgrid'); grid.className='lay-'+n;
  const pri=grid.querySelector('.cpanel-pri'); if(pri) grid.insertBefore(pri, grid.firstChild);  // panel utama balik ke kiri-atas saat ganti layout
  const need=n-1, saved=savedSecConfig();
  while(secondaries.length>need){ secondaries.pop().dispose(); }
  while(secondaries.length<need){
    const idx=secondaries.length, sc=makeSecondary(idx);
    grid.appendChild(sc.panel); secondaries.push(sc);
    const cfg=saved[idx]||{}; sc.setSymTF(cfg.sym||SEC_DEFAULTS[idx]||'EUR_USD', cfg.tf||currentTF); sc.load();
  }
  persistSec();
  $('#layoutbtns').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.n===n));
  markActivePanel(); resizeAllCharts();
}

function initMultiChart(){
  const LB=$('#layoutbtns');
  const ICON={
    1:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="1"/></svg>',
    2:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="5" height="11" rx="1"/><rect x="9" y="2.5" width="5" height="11" rx="1"/></svg>',
    4:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="5" height="5" rx="1"/><rect x="9" y="2.5" width="5" height="5" rx="1"/><rect x="2" y="8.5" width="5" height="5" rx="1"/><rect x="9" y="8.5" width="5" height="5" rx="1"/></svg>'};
  [1,2,4].forEach(n=>{ const b=document.createElement('button'); b.dataset.n=n; b.title=n+' chart'; b.innerHTML=ICON[n]; b.onclick=()=>{ track('layout',{n}); setLayout(n); }; LB.appendChild(b); });
  let n=parseInt(localStorage.getItem('br_layout'),10); if(![1,2,4].includes(n)) n=1;
  setLayout(n);
}

