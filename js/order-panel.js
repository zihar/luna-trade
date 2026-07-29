// ===================== order panel: docked / mengambang (bebas digeser) =====================
const app=document.querySelector('.app');
{ const op=$('#orderpanel'), of=$('#orderForm'); if(op&&of) op.appendChild(of); }
// ukuran tersimpan untuk Markets & Trades
const savedMarketsW=()=> localStorage.getItem('br_marketsW') || '400';
const savedTradesH =()=> localStorage.getItem('br_tradesH')  || '210';

function setOrderDock(floating, keepPos){
  const op=$('#orderpanel'); if(!op) return;
  op.dataset.dock=floating?'floating':'docked';
  if(floating){
    document.body.appendChild(op);
    if(!keepPos){
      const pos=JSON.parse(localStorage.getItem('br_opPos')||'null');
      op.style.left=(pos? pos.x : 70)+'px';
      op.style.top =(pos? pos.y : 90)+'px';
    }
  }else{
    op.style.left=''; op.style.top='';
    $('#watchlist').appendChild(op);
  }
}
// kolom kanan (grid-area:markets) ditempati Markets ATAU News (radio). rhMarkets/--markets-w
// mengontrol geometri kolom itu sendiri, terpisah dari panel mana yg sedang tampil di dalamnya.
function setColumnVisible(visible){
  $('#rhMarkets').classList.toggle('hidden', !visible);
  app.style.setProperty('--markets-w', visible ? savedMarketsW()+'px' : '0px');
}
function setMarketsHidden(hidden){
  $('#watchlist').classList.toggle('hidden',hidden);
  if(!hidden){ refreshMostOpened(); if(wlBuilt) buildWatch(); }   // segarkan "Most opened" tiap panel dibuka
  setColumnVisible(!hidden);
  $('#toggleMarkets').classList.toggle('on',!hidden);
  setOrderDock(hidden);   // auto-float saat Markets disembunyikan, dock saat tampil
  try{chart.resize();}catch(e){}
}
function toggleMarkets(){
  const newsWasOpen=!$('#newspanel').classList.contains('hidden');
  if(newsWasOpen){
    setNewsOpen(false);                 // satu jalur tutup News (radio) — restore Markets ke state sebelumnya
    if($('#watchlist').classList.contains('hidden')){
      setMarketsHidden(false);          // klik Markets = maksud user: tampilkan Markets (lepas dari state sebelumnya)
      localStorage.setItem('br_watchHidden','0');
    }
    return;
  }
  const hidden=!$('#watchlist').classList.contains('hidden'); setMarketsHidden(hidden); localStorage.setItem('br_watchHidden',hidden?'1':'0');
}
// --- News panel: fetch & render (bias card, next-release countdown, weekly calendar) ---
function newsCurrentInstrument(){ return inst || 'XAU_USD'; }   // `inst` = instrumen chart aktif (lihat selectSymbol)
let _newsTimer=null, _newsCountdown=null, _newsNotifyTimer=null;
let newsState=null;   // respons /api/news/calendar last-good — dibagi panel & marker on-chart
// Toggle marker on-chart (Fase 2). Default ON. '0' = off.
function newsMarkersEnabled(){ return localStorage.getItem('br_newsMarkers')!=='0'; }
// Fetch kalender utk instrumen aktif → simpan ke newsState → render panel (bila terbuka)
// & marker on-chart (bila enabled). Dipanggil saat chart ready, ganti instrumen, poll 60s.
// dedupe fetch barengan utk instrumen sama (mis. saat boot: setNewsOpen(true) + initPriceTimer
// memanggil berturut). Guard in-flight → tetap izinkan retry (setelah selesai) & ganti instrumen.
let _newsInFlight={};
function refreshNewsData(){
  try{ refreshHeadlines(); }catch(e){}   // part 2: headline feed (guard in-flight sendiri)
  const reqInst=newsCurrentInstrument();
  if(_newsInFlight[reqInst]) return;    // sudah ada fetch berjalan utk instrumen ini
  _newsInFlight[reqInst]=true;
  fetch('/api/news/calendar?instrument='+encodeURIComponent(reqInst))
    .then(r=>{ if(!r.ok) throw new Error('http'); return r.json(); })
    .then(d=>{
      // Buang respons BASI: instrumen chart bisa sudah berganti saat fetch ini balik
      // (boot: fetch default balapan dgn restore; atau ganti instrumen cepat). Tanpa ini,
      // respons lama yg telat menimpa newsState (last-write-wins) → bias card/kalender/marker
      // salah instrumen sampai poll berikutnya. (Cermin guard di refreshHeadlines.)
      if(d && d.instrument && d.instrument!==newsCurrentInstrument()) return;
      newsState=d;
      if(!$('#newspanel').classList.contains('hidden')) renderNews(d);
      if(newsMarkersEnabled() && typeof renderNewsMarkers==='function') renderNewsMarkers();
      try{ checkNewsNotify(); }catch(e){}   // deteksi rilis/reminder segera tiap data baru
    })
    .catch(()=>{
      // Panel terbuka → tampilkan error Fase 1. Marker: pertahankan last-good (jangan hapus).
      if(!$('#newspanel').classList.contains('hidden')){
        const body=$('#newsBody');
        body.innerHTML='<div class="news-empty">News feed unavailable.'
          +' <button id="newsRetry" class="wl-x">Retry</button></div>';
        const b=$('#newsRetry'); if(b) b.onclick=refreshNewsData;
      }
    })
    .finally(()=>{ delete _newsInFlight[reqInst]; });
}
function loadNews(){ refreshNewsData(); }   // kompat: pemanggil lama (selectSymbol, setNewsOpen)
// ---- News on-chart markers (Fase 2): layer DOM tersinkron pan/zoom ----
let _newsLayer=null;
function ensureNewsLayer(){
  if(_newsLayer) return _newsLayer;
  _newsLayer=document.createElement('div'); _newsLayer.id='newsMarkers';
  $('#chart').appendChild(_newsLayer);
  document.addEventListener('click', ()=>{ if(typeof closeNewsPop==='function') closeNewsPop(); });
  return _newsLayer;
}
// impact feed → kelas warna tick (hanya High/Medium yg dikirim backend; fallback medium).
function nmkImpactClass(imp){ return String(imp||'').toLowerCase()==='high' ? 'impact-high' : 'impact-medium'; }
// currency feed (mis. "USD") → emoji flag via regional-indicator dari 2 huruf pertama
// ("USD"→"US"→🇺🇸). Di platform tanpa emoji-flag otomatis tampil huruf ("US") — fallback berguna.
// Hanya A-Z yang dipetakan (aman utk innerHTML); selain itu string kosong.
function currencyFlag(cur){
  const cc=String(cur||'').toUpperCase().slice(0,2);
  if(!/^[A-Z]{2}$/.test(cc)) return '';
  return cc.replace(/./g, c=>String.fromCodePoint(0x1F1E6 + c.charCodeAt(0)-65));
}
// Tentukan BUCKET (candle) tempat sebuah event jatuh — dasar grouping & posisi marker.
// In-data: cari candle nyata yg memuat t (largest i dgn a[i].ts<=t) → batas W/MN tak rata,
// jadi TAK bisa sekadar floor(t/DUR); bar terakhir mencakup [lt, lt+dur). Future (t>=lt+dur):
// proyeksi per-periode DUR. kind 'c' pakai timestamp candle (tsToPx=pusat bar), 'f' pakai
// offset periode (idxToPx pusat bar future), 't' = sebelum data (jarang, off-screen).
// `tf` (bukan durasi jadi): batas & offset bar future dihitung per-TF supaya MN — yang panjang
// barnya 28–31 hari — tak memakai rata-rata 30,44 hari dan menaruh event di bar yang salah.
function newsBucket(t,a,li,lt,tf){
  if(t < a[0].timestamp) return {key:'t'+t, kind:'t', ref:t};
  let lo=0,h=li,i=0;
  while(lo<=h){ const m=(lo+h)>>1; if(a[m].timestamp<=t){ i=m; lo=m+1; } else h=m-1; }
  if(i<li) return {key:'c'+a[i].timestamp, kind:'c', ref:a[i].timestamp};
  if(t < stepBarTs(tf, lt, 1)) return {key:'c'+lt, kind:'c', ref:lt};
  const off=Math.floor(barStepsFrom(tf, lt, t)); return {key:'f'+off, kind:'f', ref:off};
}
// Rebuild seluruh tick dari newsState.releases. Event mendatang terdekat (wall-clock now)
// dapat kelas .is-next (glow). Timestamp rusak → di-skip (defensif).
function renderNewsMarkers(){
  const layer=ensureNewsLayer();
  if(!newsMarkersEnabled()){ if(typeof closeNewsPop==='function') closeNewsPop(); layer.style.display='none'; layer.innerHTML=''; return; }
  layer.style.display='';
  const rels=(newsState&&newsState.releases)||[];
  const now=Date.now();
  // Gabung per-CANDLE jadi SATU marker (detailnya berjajar di popup saat diklik, ala TradingView):
  // semua event yang jatuh di bar yang sama → satu marker. Penting di TF besar (Daily/Weekly/
  // Monthly) di mana banyak event beda-jam berbagi satu candle. Badge = highest-impact anggota;
  // count badge bila >1. Tanpa data candle (chart belum siap) → fallback grup jam-exact.
  const a=(typeof revealed==='function')?revealed(currentTF):[];
  const hasBars=!!(a&&a.length); const li=hasBars?a.length-1:0, lt=hasBars?a[li].timestamp:0;
  const groups=new Map();   // bucketKey → [idx release]
  rels.forEach((r,i)=>{ const t=Date.parse(r.time); if(isNaN(t)) return;
    const key=hasBars?newsBucket(t,a,li,lt,currentTF).key:('x'+r.time);
    if(!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
  // Urutkan anggota tiap grup by waktu naik → popup berjajar kronologis.
  for(const idxs of groups.values()) idxs.sort((x,y)=>Date.parse(rels[x].time)-Date.parse(rels[y].time));
  let nextKey=null, nextT=Infinity;
  for(const [key,idxs] of groups){ for(const i of idxs){ const t=Date.parse(rels[i].time); if(t>now&&t<nextT){ nextT=t; nextKey=key; } } }
  if(typeof closeNewsPop==='function') closeNewsPop();   // tutup popup terbuka; ticknya akan didetach oleh rebuild
  layer.innerHTML='';
  for(const [key, idxs] of groups){
    const anyHigh=idxs.some(i=>String(rels[i].impact||'').toLowerCase()==='high');
    const el=document.createElement('div');
    el.className='nmk '+(anyHigh?'impact-high':'impact-medium')+(key===nextKey?' is-next':'');
    el.dataset.idxs=idxs.join(','); el.dataset.time=rels[idxs[0]].time;   // waktu event paling awal (anggota sudah terurut) → reposition hitung ulang bucket
    el.title=idxs.map(i=>(rels[i].currency||'')+' '+(rels[i].name||'')).join(', ');   // fallback native tooltip
    const curs=[...new Set(idxs.map(i=>rels[i].currency).filter(Boolean))];
    const fl=curs.length===1 ? currencyFlag(curs[0]) : currencyFlag(rels[idxs[0]].currency);
    el.innerHTML=`<span class="nmk-fl">${fl}</span>`
      +`<span class="nmk-sev">${'<i></i>'.repeat(anyHigh?3:2)}</span>`
      +(idxs.length>1?`<span class="nmk-count">${idxs.length}</span>`:'');
    if(typeof bindNewsMarker==='function') bindNewsMarker(el);
    layer.appendChild(el);
  }
  repositionNewsMarkers();
}
// Set posisi X tiap tick: event lampau (ts<=lastTs) → tsToPx; mendatang → idxToPx via
// dataIndex terproyeksi (pola reanchorFuturePoints). Di luar plot → display:none.
function repositionNewsMarkers(){
  const layer=_newsLayer; if(!layer || layer.style.display==='none') return;
  const a=(typeof revealed==='function')?revealed(currentTF):null;
  if(!a||!a.length) return;
  const li=a.length-1, lt=a[li].timestamp;
  let W=$('#chart').clientWidth||0;
  try{ const sz=chart.getSize('candle_pane','main'); if(sz&&sz.width) W=sz.width; }catch(e){}   // batas kanan = area plot (tanpa sumbu harga)
  const rels=(newsState&&newsState.releases)||[];
  layer.querySelectorAll('.nmk').forEach(el=>{
    const t=Date.parse(el.dataset.time||'');
    if(isNaN(t)){ el.style.display='none'; return; }
    const b=newsBucket(t,a,li,lt,currentTF);   // pusat bar candle: 'c'→tsToPx(ts candle), 'f'→idxToPx(bar future)
    let x = b.kind==='f' ? idxToPx(li+b.ref) : tsToPx(b.ref);
    if(x==null || x<0 || x>W){ el.style.display='none'; return; }
    el.style.display=''; el.style.left=x+'px';
  });
  nudgeNewsMarkers();
  if(typeof repositionNewsPop==='function') repositionNewsPop();   // ikutkan popup terbuka (Task 4)
}
// Badge bar-beda yang berdekatan → geser ke kanan agar TERBACA sbg 2 marker terpisah (bukan
// menyatu). Gap 32px = 22px badge + celah + ruang glow is-next / count badge yg meluber; di TF
// kecil (mis. H1) event beda-jam yg cuma 1–2 bar terpisah jadi jelas bersebelahan.
function nudgeNewsMarkers(){
  const layer=_newsLayer; if(!layer) return;
  const GAP=32;
  const vis=[...layer.querySelectorAll('.nmk')].filter(e=>e.style.display!=='none')
    .map(e=>({e,x:parseFloat(e.style.left)||0})).sort((p,q)=>p.x-q.x);
  for(let i=1;i<vis.length;i++){
    if(vis[i].x - vis[i-1].x < GAP){ vis[i].x=vis[i-1].x+GAP; vis[i].e.style.left=vis[i].x+'px'; }
  }
}
// ---- News marker popup (hover desktop / tap mobile) ----
let _newsPop=null;
function bindNewsMarker(el){
  // Detail HANYA saat KLIK (bukan hover): klik toggle popup; klik-luar menutup (listener global).
  el.addEventListener('click', (e)=>{ e.stopPropagation();
    if(_newsPop && _newsPop._for===el){ closeNewsPop(); } else { openNewsPop(el); } });
}
// Isi detail satu event (header + grid + surprise gauge). showTime=false utk daftar multi
// (waktu sudah tampil sekali di header grup).
function newsEvtInner(r, showTime){
  const impCls=nmkImpactClass(r.impact);
  const sev='<i></i>'.repeat(String(r.impact||'').toLowerCase()==='high'?3:2);
  const rows=[['Actual', r.released?(r.actual||'—'):'—'],['Forecast', r.forecast||'—'],['Previous', r.previous||'—']];
  const grid=rows.map(([k,v])=>`<span class="k">${k}</span><span class="v">${newsEsc(v)}</span>`).join('');
  // Surprise gauge (delta actual-vs-forecast + tag bias) — sama dgn panel Calendar; hanya bila sudah rilis.
  const sb=r.released?surpriseBits(r, newsCurrentInstrument()):null;
  const surprise = sb?`<div class="cal-surprise ${sb.biasClass}" style="margin-top:12px">
      <span class="cal-delta">${sb.glyph} ${sb.delta?newsEsc(sb.delta)+' ':''}${sb.word}</span>
      ${sb.biasClass!=='neutral'?`<span class="cal-biastag">→ ${newsEsc(sb.biasLabel)}</span>`:''}</div>`:'';
  return `<div class="np-hd"><span class="np-fl">${currencyFlag(r.currency)}</span>
        <span class="np-nm">${newsEsc(r.currency)} ${newsEsc(r.name)}</span>
        <span class="np-chip ${impCls}"><span class="nmk-sev">${sev}</span>${newsEsc(r.impact)}</span></div>
      ${showTime?`<div class="np-tm">${newsEsc(fmtLocalFull(r.time))}</div>`:''}
      <div class="np-grid">${grid}</div>${surprise}`;
}
function openNewsPop(el){
  const rels=(newsState&&newsState.releases)||[];
  const idxs=(el.dataset.idxs||'').split(',').map(Number).filter(i=>rels[i]);
  if(!idxs.length) return;
  closeNewsPop();
  const pop=document.createElement('div'); pop.className='nmk-pop'; pop._for=el;
  if(idxs.length===1){
    const r=rels[idxs[0]];
    pop.innerHTML=`<div class="np-acc ${nmkImpactClass(r.impact)}"></div><div class="np-body">${newsEvtInner(r,true)}</div>`;
  }else{
    // >1 event dlm satu candle → header ringkas (jumlah + rentang tanggal bar) + daftar kartu
    // berjajar (scroll), bar impact di kiri. showTime=true: tiap event tampil jamnya sendiri
    // (kini beda-beda dlm satu bucket, mis. sehari penuh di Daily / seminggu di Weekly).
    pop.classList.add('np-multi');
    const span=newsDaySpan(idxs.map(i=>rels[i].time));
    pop.innerHTML=`<div class="np-mhd"><span class="np-mc">${idxs.length} events</span><span class="np-mt">${newsEsc(span)}</span></div>`
      +`<div class="np-scroll">`+idxs.map(i=>`<div class="np-evt ${nmkImpactClass(rels[i].impact)}">${newsEvtInner(rels[i],true)}</div>`).join('')+`</div>`;
  }
  pop.addEventListener('click', (e)=>e.stopPropagation());   // klik di dalam popup tak memicu close-outside (tetap terbuka sampai klik-luar / klik marker lagi)
  $('#chart').appendChild(pop); _newsPop=pop;
  positionNewsPop();
}
// Popup selalu di ATAS tick (tick di dekat sumbu bawah → ruang di atas cukup); clamp
// horizontal agar tak keluar tepi kiri/kanan chart.
function positionNewsPop(){
  if(!_newsPop||!_newsPop._for) return;
  const el=_newsPop._for, cW=$('#chart').clientWidth;
  const x=parseFloat(el.style.left)||0, halfW=_newsPop.offsetWidth/2+6;
  _newsPop.style.left=Math.max(halfW, Math.min(x, cW-halfW))+'px';
  _newsPop.style.bottom='46px';   // tepat di atas badge (bottom:15px + tinggi 22 + gap)
}
function repositionNewsPop(){
  if(!_newsPop||!_newsPop._for) return;
  if(!document.contains(_newsPop._for) || _newsPop._for.style.display==='none'){ closeNewsPop(); return; }   // tick keluar layar / didetach → tutup
  positionNewsPop();
}
function closeNewsPop(){ if(_newsPop){ _newsPop.remove(); _newsPop=null; } }
// Tanggal-waktu lengkap utk popup marker (ala TradingView: "Wed, 10 Jul 2026 · 19:30").
// Waktu news SELALU dalam timezone terpilih (chartTZ / "jam server"), bukan timezone browser.
function fmtTzTime(iso){ try{ return new Date(iso).toLocaleTimeString('en-GB', {timeZone:chartTZ, hour:'2-digit', minute:'2-digit', hour12:false}); }catch(e){ return '—'; } }
function tzYMD(x){ try{ return new Intl.DateTimeFormat('en-CA', {timeZone:chartTZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(x)); }catch(e){ return ''; } }   // "YYYY-MM-DD" dlm chartTZ (grouping/label tanggal)
function fmtLocalFull(iso){ const d=new Date(iso);
  const day=d.toLocaleDateString('en-GB', {timeZone:chartTZ, weekday:'short', day:'2-digit', month:'short', year:'numeric'});
  return day+' · '+fmtTzTime(iso); }
// Rentang tanggal (tanpa jam) utk header popup multi-event: "Fri, 10 Jul 2026" bila anggota
// se-hari (Daily), atau "10 Jul – 14 Jul 2026" bila membentang > 1 hari (Weekly/Monthly).
function newsDaySpan(times){
  const ds=times.map(t=>new Date(t)).sort((a,b)=>a-b);
  const first=ds[0], last=ds[ds.length-1];
  const full=d=>d.toLocaleDateString('en-GB', {timeZone:chartTZ, weekday:'short', day:'2-digit', month:'short', year:'numeric'});
  const short=d=>d.toLocaleDateString('en-GB', {timeZone:chartTZ, day:'2-digit', month:'short'});
  return tzYMD(first)===tzYMD(last) ? full(first) : (short(first)+' – '+full(last));   // se-hari (Daily) vs rentang (W/MN), dalam chartTZ
}
function biasArrow(b){ return b==='bullish'?'▲':b==='bearish'?'▼':'—'; }
// Escape HTML minimal utk data yang berasal dari feed kalender ekonomi pihak ketiga
// (nama rilis, currency, forecast/previous/actual, playbook) sebelum masuk innerHTML —
// mencegah injeksi script kalau respons feed dipalsukan/di-compromise.
function newsEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// (fmtCountdown untuk hero next-release dulu dideklarasikan di sini — ia bertabrakan nama dengan
// deklarasi lebih awal di js/countdown.js dan, karena file ini dimuat belakangan, diam-diam
// MENGGANTIKAN varian itu untuk SEMUA pemanggil. Keduanya kini disatukan di js/countdown.js.)
// Angka pertama dari figur ekonomi ("3.1%","236K","-0.2","1,024") → float | null. Suffix
// unit diabaikan; delta hanya dipakai bila forecast & actual sama-unit (dijamin per-rilis).
function parseNum(s){
  const m=String(s==null?'':s).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return m?parseFloat(m[0]):null;
}
// Bit-bit "surprise gauge" utk rilis yang sudah keluar: arah (▲/▼/➖ dari verdict.surprise),
// delta numerik vs forecast (bila keduanya ter-parse; presisi ikut desimal forecast),
// kata beat/miss/in-line, kelas bias & label tag instrumen (mis. "GOLD ▲").
function surpriseBits(r, inst){
  const v=r.verdict||{}, sur=v.surprise||'';
  const glyph = sur==='above'?'▲':sur==='below'?'▼':'➖';
  const word  = sur==='above'?'beat':sur==='below'?'miss':'in-line';
  const f=parseNum(r.forecast), a=parseNum(r.actual);
  let delta='';
  if(f!=null && a!=null && f!==a){
    const dec=Math.min(3,((String(r.forecast).split('.')[1]||'').match(/\d+/)||[''])[0].length);
    const d=a-f; delta=(d>0?'+':'')+d.toFixed(dec);
  }
  const bias=v.bias||'neutral';
  const badge=(typeof newsBadge==='function')?newsBadge(inst):(inst||'').replace('_','/');
  return { glyph, word, delta, biasClass:bias, biasLabel:badge+' '+biasArrow(bias) };
}
// Label & tanggal hari lokal utk divider timeline (Today / Tomorrow / Yesterday / weekday).
function calDayLabel(d){
  const toUTC=s=>{ const p=s.split('-').map(Number); return Date.UTC(p[0],p[1]-1,p[2]); };
  const diff=Math.round((toUTC(tzYMD(d))-toUTC(tzYMD(new Date())))/86400000);   // hari relatif dlm chartTZ ("jam server")
  return diff===0?'Today':diff===1?'Tomorrow':diff===-1?'Yesterday':d.toLocaleDateString('en-GB', {timeZone:chartTZ, weekday:'long'});
}
function calDayDate(d){ return d.toLocaleDateString('en-GB', {timeZone:chartTZ, day:'2-digit', month:'short'}); }

// --- News headlines tab (part 2): daftar berita per-instrumen dari /api/news/headlines ---
let headlinesState=null, _hlInFlight={}, _hlDisabled=false;
function newsTab(){ return localStorage.getItem('br_newsTab')==='news' ? 'news' : 'calendar'; }
function setNewsTab(tab){
  const isNews = tab==='news' && !_hlDisabled;
  localStorage.setItem('br_newsTab', isNews?'news':'calendar');
  const c=$('#newsTabCalendar'), n=$('#newsTabNews');
  if(c){ c.classList.toggle('on', !isNews); c.setAttribute('aria-selected', String(!isNews)); }
  if(n){ n.classList.toggle('on', isNews); n.setAttribute('aria-selected', String(isNews)); }
  $('#newsBody').classList.toggle('hidden', isNews);
  $('#newsHeadlinesBody').classList.toggle('hidden', !isNews);
  const lbl=$('#newsMarkerToggle') && $('#newsMarkerToggle').closest('.nmk-toggle');
  if(lbl) lbl.style.display = isNews?'none':'';   // "On chart" hanya relevan utk Calendar
  if(isNews && headlinesState) renderHeadlines(headlinesState);
}
// Fitur disabled (server tanpa FINNHUB_TOKEN) → sembunyikan seluruh toggle tab; panel jadi Calendar-only.
function applyNewsTabsVisibility(){
  const tabs=$('.news-tabs'); if(tabs) tabs.style.display = _hlDisabled?'none':'';
  if(_hlDisabled && newsTab()==='news') setNewsTab('calendar');
}
function refreshHeadlines(){
  const reqInst=newsCurrentInstrument();
  if(_hlInFlight[reqInst]) return;
  _hlInFlight[reqInst]=true;
  fetch('/api/news/headlines?instrument='+encodeURIComponent(reqInst))
    .then(r=>{ if(!r.ok) throw new Error('http'); return r.json(); })
    .then(d=>{
      // Buang respons BASI: instrumen chart bisa sudah berganti saat fetch ini balik
      // (boot: fetch default balapan dgn restore; atau ganti instrumen cepat). Tanpa ini,
      // respons lama yang telat menimpa headlinesState (last-write-wins) → panel/kartu salah instrumen.
      if(d && d.instrument && d.instrument!==newsCurrentInstrument()) return;
      headlinesState=d; _hlDisabled=!!d.disabled; applyNewsTabsVisibility();
      if(newsTab()==='news' && !$('#newspanel').classList.contains('hidden')) renderHeadlines(d);
      try{ updateNewsCards(d); }catch(e){}   // part 3: kartu notif on-chart (walau panel tertutup)
    })
    .catch(()=>{
      if(newsTab()==='news' && !$('#newspanel').classList.contains('hidden')){
        const b=$('#newsHeadlinesBody');
        if(b) b.innerHTML='<div class="news-empty">Headlines unavailable. Retrying…</div>';
      }
    })
    .finally(()=>{ delete _hlInFlight[reqInst]; });
}
function fmtRel(iso){
  const t=Date.parse(iso); if(isNaN(t)) return '';
  const s=Math.max(0,(Date.now()-t)/1000);
  if(s<60) return 'just now';
  const m=Math.floor(s/60); if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function renderHeadlines(d){
  const body=$('#newsHeadlinesBody'); if(!body) return;
  if(d && d.disabled){ body.innerHTML='<div class="news-empty">Headlines are turned off.</div>'; return; }
  const items=(d&&d.headlines)||[];
  const pretty=newsEsc((d&&d.instrument||'').replace('_','/'));
  if(!items.length){ body.innerHTML='<div class="news-empty">No recent headlines for '+pretty+'.</div>'; return; }
  let html='';
  if(d.stale) html+='<div class="news-regime" style="margin:8px 8px 2px">Delayed</div>';
  for(const h of items){
    html+=`<a class="hl-item" href="${newsEsc(h.url)}" target="_blank" rel="noopener">
      <div class="hl-top"><span class="hl-src">${newsEsc(h.source||'News')}</span><span class="hl-time">${newsEsc(fmtRel(h.publishedAt))}</span></div>
      <div class="hl-title">${newsEsc(h.title)}</div>
      <div class="hl-more">Keep reading ↗</div></a>`;
  }
  body.innerHTML=html;
}

// --- News notif cards on-chart (part 3): headline BARU (per-instrumen) → kartu kanan-atas ---
let _newsCardShownIds=new Set();   // id yg sudah ditampilkan sesi ini (cegah dobel lintas sumber/telat)
let _newsCardsInst=null;           // instrumen yg kartunya sedang tampil (utk bersihkan saat ganti)
function newsSeenMap(){ try{ return JSON.parse(localStorage.getItem('br_newsSeen')||'{}'); }catch(e){ return {}; } }
function setNewsSeen(inst, iso){ const m=newsSeenMap(); m[inst]=iso; try{ localStorage.setItem('br_newsSeen', JSON.stringify(m)); }catch(e){} }
function ensureNewsCards(){ let c=$('#newsCards'); if(!c){ c=document.createElement('div'); c.id='newsCards'; $('#chart').appendChild(c); } return c; }
// Badge pendek instrumen (◐ prefix di render). Gold/Silver diberi nama; crypto/indeks pakai base; forex pair.
function newsBadge(inst){
  if(inst==='XAU_USD') return 'GOLD'; if(inst==='XAG_USD') return 'SILVER';
  const m=(typeof ipkMeta==='function')?ipkMeta(inst):null;
  if(m && (m.grp==='Crypto'||m.grp==='Indices')) return m.base||inst;
  return inst.replace('_','/');
}
function dismissNewsCard(el){ el.classList.remove('in'); setTimeout(()=>{ try{el.remove();}catch(e){} }, 260); }
// Dipanggil tiap headlinesState terupdate (refreshHeadlines). Boot/ganti-instrumen: set watermark
// tanpa tampilkan backlog; hanya headline lebih baru dari watermark yg memicu kartu.
function updateNewsCards(d){
  if(!d || d.disabled) return;
  const inst=d.instrument;
  if(inst!==newsCurrentInstrument()) return;            // respons basi (sudah ganti instrumen)
  const c=ensureNewsCards();
  if(_newsCardsInst!==inst){ c.innerHTML=''; _newsCardsInst=inst; }  // ganti instrumen → bersihkan kartu lama
  const items=(d.headlines||[]);
  const maxTs=items.reduce((a,h)=>{ const t=Date.parse(h.publishedAt); return (!isNaN(t)&&t>a)?t:a; }, 0);
  const seen=newsSeenMap(), wm=seen[inst];
  if(wm===undefined){ if(maxTs) setNewsSeen(inst, new Date(maxTs).toISOString()); return; }  // boot: no backlog
  const wmT=Date.parse(wm)||0;
  const NEWS_CARD_MAX_AGE_MS=30*60*1000;   // hanya headline ≤30mnt yg boleh jadi kartu on-chart (cegah backlog di tab baru)
  const now=Date.now();
  const fresh=items.filter(h=>{ const t=Date.parse(h.publishedAt); return !isNaN(t)&&t>wmT && (now-t)<=NEWS_CARD_MAX_AGE_MS && !_newsCardShownIds.has(h.id); })
                   .sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt));   // lama→baru
  if(!fresh.length){ if(maxTs>wmT) setNewsSeen(inst, new Date(maxTs).toISOString()); return; }  // maju watermark lewati item lama yg di-skip
  const badge=newsBadge(inst);
  for(const h of fresh){
    _newsCardShownIds.add(h.id);
    pushChartCard(`<div class="nc-top"><span class="nc-badge">◐ ${newsEsc(badge)}</span>`
      +`<span class="nc-src">${newsEsc(h.source||'News')}</span>`
      +`<span class="nc-time">${newsEsc(fmtRel(h.publishedAt))}</span>`
      +`<button class="nc-x" aria-label="Dismiss">✕</button></div>`
      +`<a class="nc-title" href="${newsEsc(h.url)}" target="_blank" rel="noopener">${newsEsc(h.title)}</a>`
      +`<a class="nc-more" href="${newsEsc(h.url)}" target="_blank" rel="noopener">Keep reading ↗</a>`);
  }
  const newMax=Math.max(maxTs, wmT);   // maju ke item terbaru di feed (bukan hanya yg tampil) → item lama tak di-scan ulang
  setNewsSeen(inst, new Date(newMax).toISOString());
}
// Sisip kartu on-chart baru (terbaru di atas, animasi masuk, cap 3 FIFO). Dipakai bersama
// oleh headline feed (updateNewsCards) & notif event high-impact (fireNewsNotif).
function pushChartCard(html, cls){
  const c=ensureNewsCards();
  const card=document.createElement('div'); card.className='nc-card'+(cls?(' '+cls):'');
  card.innerHTML=html;
  c.insertBefore(card, c.firstChild);
  const x=card.querySelector('.nc-x'); if(x) x.onclick=()=>dismissNewsCard(card);
  requestAnimationFrame(()=>card.classList.add('in'));
  while(c.children.length>3) c.lastChild.remove();      // cap 3 FIFO (buang terlama = paling bawah)
  return card;
}

