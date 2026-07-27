// ===================== Luna Instrument Picker (dropdown custom) =====================
// Menyetir <select id="instrument"> yang tersembunyi. Data harga nebeng quoteCache/liveTicks
// yg sudah dipakai watchlist (tanpa request tambahan); baris hanya di-update saat dropdown
// terbuka (queuePriceRender → updateIpickPrices), jadi biaya per-tick ~nol saat tertutup.
const IPK_CCY = {
  // mata uang (pair 2-chip)
  EUR:'EU', USD:'US', GBP:'GB', JPY:'JP', AUD:'AU', CAD:'CA', NZD:'NZ', CHF:'CH', HKD:'HK',
  XAU:'Au', XAG:'Ag',
  // energy (chip tunggal) — kode singkat khas komoditasnya
  WTI:'WTI', BRENT:'BR', NGAS:'NG',
  // crypto (chip base)
  BTC:'₿', ETH:'Ξ', LTC:'Ł', BCH:'BC',
  // indeks (chip tunggal) — kode singkat khas indeksnya
  DXY:'$', SPX:'SP', NAS:'NQ', DJI:'DJ', RUT:'RU', DAX:'DE', FTSE:'UK', CAC:'FR', STOXX:'SX', NKY:'NK', ASX:'AS', HSI:'HK',
};
const IPK_GROUPS = ['Forex','Metals','Energy','Indices','Crypto','Stocks ID','Stocks US','ETF'];
const IPK_META = {
  EUR_USD:{grp:'Forex',   name:'Euro / US Dollar',                  base:'EUR', quote:'USD'},
  GBP_USD:{grp:'Forex',   name:'British Pound / US Dollar',         base:'GBP', quote:'USD'},
  USD_JPY:{grp:'Forex',   name:'US Dollar / Japanese Yen',          base:'USD', quote:'JPY'},
  USD_CHF:{grp:'Forex',   name:'US Dollar / Swiss Franc',           base:'USD', quote:'CHF'},
  USD_CAD:{grp:'Forex',   name:'US Dollar / Canadian Dollar',       base:'USD', quote:'CAD'},
  AUD_USD:{grp:'Forex',   name:'Australian Dollar / US Dollar',     base:'AUD', quote:'USD'},
  NZD_USD:{grp:'Forex',   name:'New Zealand Dollar / US Dollar',    base:'NZD', quote:'USD'},
  GBP_JPY:{grp:'Forex',   name:'British Pound / Japanese Yen',      base:'GBP', quote:'JPY'},
  EUR_JPY:{grp:'Forex',   name:'Euro / Japanese Yen',              base:'EUR', quote:'JPY'},
  EUR_GBP:{grp:'Forex',   name:'Euro / British Pound',              base:'EUR', quote:'GBP'},
  AUD_JPY:{grp:'Forex',   name:'Australian Dollar / Japanese Yen',  base:'AUD', quote:'JPY'},
  EUR_AUD:{grp:'Forex',   name:'Euro / Australian Dollar',          base:'EUR', quote:'AUD'},
  GBP_AUD:{grp:'Forex',   name:'British Pound / Australian Dollar', base:'GBP', quote:'AUD'},
  XAU_USD:{grp:'Metals',  name:'Gold / US Dollar',                  base:'XAU', quote:'USD'},
  XAG_USD:{grp:'Metals',  name:'Silver / US Dollar',                base:'XAG', quote:'USD'},
  WTICO_USD: {grp:'Energy',  name:'WTI Crude Oil',      base:'WTI'},
  BCO_USD:   {grp:'Energy',  name:'Brent Crude Oil',    base:'BRENT'},
  NATGAS_USD:{grp:'Energy',  name:'Natural Gas',        base:'NGAS'},
  DXY:       {grp:'Indices', name:'US Dollar Index',    base:'DXY', tradeable:false},
  SPX500_USD:{grp:'Indices', name:'S&P 500',            base:'SPX'},
  NAS100_USD:{grp:'Indices', name:'Nasdaq 100',         base:'NAS'},
  US30_USD:  {grp:'Indices', name:'Dow Jones 30',       base:'DJI'},
  US2000_USD:{grp:'Indices', name:'Russell 2000',       base:'RUT'},
  DE30_EUR:  {grp:'Indices', name:'Germany 40 (DAX)',   base:'DAX'},
  UK100_GBP: {grp:'Indices', name:'FTSE 100',           base:'FTSE'},
  FR40_EUR:  {grp:'Indices', name:'CAC 40',             base:'CAC'},
  EU50_EUR:  {grp:'Indices', name:'Euro Stoxx 50',      base:'STOXX'},
  JP225_USD: {grp:'Indices', name:'Nikkei 225',         base:'NKY'},
  AU200_AUD: {grp:'Indices', name:'ASX 200',            base:'ASX'},
  HK33_HKD:  {grp:'Indices', name:'Hang Seng',          base:'HSI'},
  BTC_USD:{grp:'Crypto',  name:'Bitcoin / US Dollar',      base:'BTC', quote:'USD'},
  ETH_USD:{grp:'Crypto',  name:'Ether / US Dollar',        base:'ETH', quote:'USD'},
  LTC_USD:{grp:'Crypto',  name:'Litecoin / US Dollar',     base:'LTC', quote:'USD'},
  BCH_USD:{grp:'Crypto',  name:'Bitcoin Cash / US Dollar', base:'BCH', quote:'USD'},
  'STOCK:BBCA.JK':{grp:'Stocks ID', name:'Bank Central Asia (IDX)',       base:'BBCA', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:BBRI.JK':{grp:'Stocks ID', name:'Bank Rakyat Indonesia (IDX)',   base:'BBRI', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:BMRI.JK':{grp:'Stocks ID', name:'Bank Mandiri (IDX)',            base:'BMRI', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:BBNI.JK':{grp:'Stocks ID', name:'Bank Negara Indonesia (IDX)',   base:'BBNI', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:BRIS.JK':{grp:'Stocks ID', name:'Bank Syariah Indonesia (IDX)',  base:'BRIS', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:TLKM.JK':{grp:'Stocks ID', name:'Telkom Indonesia (IDX)',        base:'TLKM', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:ISAT.JK':{grp:'Stocks ID', name:'Indosat Ooredoo Hutchison (IDX)',base:'ISAT',quote:'IDR', decimals:0, tradeable:false},
  'STOCK:EXCL.JK':{grp:'Stocks ID', name:'XLSMART Telecom (IDX)',         base:'EXCL', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:UNVR.JK':{grp:'Stocks ID', name:'Unilever Indonesia (IDX)',      base:'UNVR', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:ICBP.JK':{grp:'Stocks ID', name:'Indofood CBP (IDX)',            base:'ICBP', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:INDF.JK':{grp:'Stocks ID', name:'Indofood Sukses Makmur (IDX)',  base:'INDF', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:GGRM.JK':{grp:'Stocks ID', name:'Gudang Garam (IDX)',            base:'GGRM', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:HMSP.JK':{grp:'Stocks ID', name:'HM Sampoerna (IDX)',            base:'HMSP', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:AMRT.JK':{grp:'Stocks ID', name:'Alfamart / Sumber Alfaria (IDX)',base:'AMRT',quote:'IDR', decimals:0, tradeable:false},
  'STOCK:CPIN.JK':{grp:'Stocks ID', name:'Charoen Pokphand Indonesia (IDX)',base:'CPIN',quote:'IDR',decimals:0, tradeable:false},
  'STOCK:KLBF.JK':{grp:'Stocks ID', name:'Kalbe Farma (IDX)',             base:'KLBF', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:ASII.JK':{grp:'Stocks ID', name:'Astra International (IDX)',     base:'ASII', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:UNTR.JK':{grp:'Stocks ID', name:'United Tractors (IDX)',         base:'UNTR', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:ADRO.JK':{grp:'Stocks ID', name:'Alamtri Resources / Adaro (IDX)',base:'ADRO',quote:'IDR', decimals:0, tradeable:false},
  'STOCK:PTBA.JK':{grp:'Stocks ID', name:'Bukit Asam (IDX)',              base:'PTBA', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:ANTM.JK':{grp:'Stocks ID', name:'Aneka Tambang / Antam (IDX)',   base:'ANTM', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:INCO.JK':{grp:'Stocks ID', name:'Vale Indonesia (IDX)',          base:'INCO', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:MDKA.JK':{grp:'Stocks ID', name:'Merdeka Copper Gold (IDX)',     base:'MDKA', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:PGAS.JK':{grp:'Stocks ID', name:'Perusahaan Gas Negara (IDX)',   base:'PGAS', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:MEDC.JK':{grp:'Stocks ID', name:'Medco Energi (IDX)',            base:'MEDC', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:SMGR.JK':{grp:'Stocks ID', name:'Semen Indonesia (IDX)',         base:'SMGR', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:INTP.JK':{grp:'Stocks ID', name:'Indocement (IDX)',              base:'INTP', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:JSMR.JK':{grp:'Stocks ID', name:'Jasa Marga (IDX)',              base:'JSMR', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:TOWR.JK':{grp:'Stocks ID', name:'Sarana Menara Nusantara (IDX)', base:'TOWR', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:GOTO.JK':{grp:'Stocks ID', name:'GoTo Gojek Tokopedia (IDX)',    base:'GOTO', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:BRPT.JK':{grp:'Stocks ID', name:'Barito Pacific (IDX)',          base:'BRPT', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:TPIA.JK':{grp:'Stocks ID', name:'Chandra Asri Pacific (IDX)',    base:'TPIA', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:AAPL':   {grp:'Stocks US', name:'Apple Inc. (NASDAQ)',     base:'AAPL', quote:'USD', decimals:2, tradeable:false},
  'STOCK:TSLA':   {grp:'Stocks US', name:'Tesla, Inc.',             base:'TSLA', quote:'USD', decimals:2, tradeable:false},
  'STOCK:NVDA':   {grp:'Stocks US', name:'NVIDIA Corporation',      base:'NVDA', quote:'USD', decimals:2, tradeable:false},
  'STOCK:AMZN':   {grp:'Stocks US', name:'Amazon.com, Inc.',        base:'AMZN', quote:'USD', decimals:2, tradeable:false},
  'STOCK:MSFT':   {grp:'Stocks US', name:'Microsoft Corporation',   base:'MSFT', quote:'USD', decimals:2, tradeable:false},
  'STOCK:META':   {grp:'Stocks US', name:'Meta Platforms, Inc.',    base:'META', quote:'USD', decimals:2, tradeable:false},
  'STOCK:GOOGL':  {grp:'Stocks US', name:'Alphabet Inc. (Class A)', base:'GOOGL',quote:'USD', decimals:2, tradeable:false},
  'STOCK:AMD':    {grp:'Stocks US', name:'Advanced Micro Devices',  base:'AMD',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:PLTR':   {grp:'Stocks US', name:'Palantir Technologies',   base:'PLTR', quote:'USD', decimals:2, tradeable:false},
  'STOCK:NFLX':   {grp:'Stocks US', name:'Netflix',                 base:'NFLX', quote:'USD', decimals:2, tradeable:false},
  'STOCK:AVGO':   {grp:'Stocks US', name:'Broadcom',                base:'AVGO', quote:'USD', decimals:2, tradeable:false},
  'STOCK:ORCL':   {grp:'Stocks US', name:'Oracle',                  base:'ORCL', quote:'USD', decimals:2, tradeable:false},
  'STOCK:CRM':    {grp:'Stocks US', name:'Salesforce',              base:'CRM',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:INTC':   {grp:'Stocks US', name:'Intel',                   base:'INTC', quote:'USD', decimals:2, tradeable:false},
  'STOCK:JPM':    {grp:'Stocks US', name:'JPMorgan Chase',          base:'JPM',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:V':      {grp:'Stocks US', name:'Visa',                    base:'V',    quote:'USD', decimals:2, tradeable:false},
  'STOCK:MA':     {grp:'Stocks US', name:'Mastercard',              base:'MA',   quote:'USD', decimals:2, tradeable:false},
  'STOCK:WMT':    {grp:'Stocks US', name:'Walmart',                 base:'WMT',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:COST':   {grp:'Stocks US', name:'Costco Wholesale',        base:'COST', quote:'USD', decimals:2, tradeable:false},
  'STOCK:LLY':    {grp:'Stocks US', name:'Eli Lilly',               base:'LLY',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:UNH':    {grp:'Stocks US', name:'UnitedHealth Group',      base:'UNH',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:DIS':    {grp:'Stocks US', name:'Walt Disney',             base:'DIS',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:BA':     {grp:'Stocks US', name:'Boeing',                  base:'BA',   quote:'USD', decimals:2, tradeable:false},
  'STOCK:XOM':    {grp:'Stocks US', name:'ExxonMobil',              base:'XOM',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:SPY':    {grp:'ETF',    name:'SPDR S&P 500 ETF',        base:'SPY',  quote:'USD', decimals:2, tradeable:false},
  'STOCK:QQQ':    {grp:'ETF',    name:'Invesco QQQ Trust',       base:'QQQ',  quote:'USD', decimals:2, tradeable:false},
};
// Alias pencarian: ticker umum (TradingView/broker lain) → kode instrumen OANDA.
// Hanya memengaruhi filter di picker (lihat match() renderIpick), tak mengubah label/data.
// Forex & saham sudah kecari via kode simbol/dispSym + nama, jadi tak perlu entri di sini.
const IPK_ALIAS = {
  // Energy
  WTICO_USD:['USOIL','OIL','CRUDE','WTI','CL'],
  BCO_USD:['UKOIL','BRENT','BRENTOIL'],
  NATGAS_USD:['NATGAS','NGAS','GAS','NG'],
  // Indices
  SPX500_USD:['SPX','US500','SP500','ES'],
  NAS100_USD:['NAS100','US100','NDX','USTEC','NASDAQ'],
  US30_USD:['US30','DOW','DJIA','DJI','WALLSTREET'],
  US2000_USD:['US2000','RUSSELL','RUT'],
  DE30_EUR:['GER40','GER30','DE40','DAX','GERMANY40'],
  UK100_GBP:['UK100','FTSE','FTSE100'],
  FR40_EUR:['FRA40','FR40','CAC','CAC40'],
  EU50_EUR:['EU50','STOXX50','ESTX50','SX5E','EUSTX50'],
  JP225_USD:['JP225','JPN225','NIKKEI','NKY','NI225'],
  AU200_AUD:['AU200','AUS200','ASX200','ASX'],
  HK33_HKD:['HK50','HK33','HSI','HANGSENG'],
  DXY:['DXY','USDOLLAR','USDINDEX','DOLLARINDEX','DX'],
  // Metals
  XAU_USD:['GOLD'], XAG_USD:['SILVER'],
  // Crypto (nama penuh; ticker XXXUSD sudah cocok via kode simbol)
  BTC_USD:['BITCOIN'], ETH_USD:['ETHEREUM','ETHER'],
  LTC_USD:['LITECOIN'], BCH_USD:['BITCOINCASH'],
};
function ipkMeta(s){ const m=IPK_META[s]; if(m) return m;
  const p=s.split('_'); return { grp:'Forex', name:s.replace('_',' / '), base:p[0], quote:p[1] }; }
// Instrumen non-tradeable (saham, DXY): tiket order dinon-aktifkan (chart-only).
// Panel positions/trades TETAP terlihat (lintas-instrumen).
function isTradeable(s){ return ipkMeta(s).tradeable !== false; }
function applyTradeGating(){ const op=$('#orderpanel'); if(op) op.classList.toggle('notrade', !isTradeable(inst)); }
function ipkChip(ccy){ if(!ccy) return ''; const t=IPK_CCY[ccy]||ccy.slice(0,2); return `<span class="ipick-chip ipk-c-${ccy}">${t}</span>`; }
function ipkPair(s){ const m=ipkMeta(s); return ipkChip(m.base)+ipkChip(m.quote); }
function ipkPrice(s){ const q=quoteCache[s], lt=liveTicks[s], dec=symDecimals(s);
  let last=lt?(lt.bid+lt.ask)/2 : (q?q.last:null);
  return { last: last!=null?last.toFixed(dec):'—', chg: q?q.chg:null }; }
function ipkPriceHTML(s){ const p=ipkPrice(s);
  if(p.chg==null && p.last==='—') return `<div class="last">—</div>`;
  const chg=p.chg||0, up=chg>=0;
  return `<div class="last">${p.last}</div><div class="chg ${up?'up':'down'}"><span class="arw">${up?'▲':'▼'}</span>${(up?'+':'')+chg.toFixed(2)}%</div>`; }

let ipickOpen=false, ipickCursor=-1;
function syncIpickTrigger(){ const s=($('#instrument')&&$('#instrument').value)||inst;
  const tp=$('#ipickTrgPair'), tt=$('#ipickTrgTick');
  if(tp) tp.innerHTML=ipkPair(s); if(tt) tt.textContent=dispSym(s); }
function ipickRowHTML(s,idx){ const m=ipkMeta(s), on=s===inst?' on':'', cur=idx===ipickCursor?' cursor':'', fav=isInstFav(s);
  return `<div class="ipick-row${on}${cur}" data-sym="${s}" role="option" aria-selected="${s===inst}">
    <span class="ipick-pair">${ipkPair(s)}</span>
    <span class="id"><div class="sym">${dispSym(s)}</div><div class="name">${m.name||s}</div></span>
    <span class="px">${ipkPriceHTML(s)}</span>
    <button class="ipk-star${fav?' fav':''}" type="button" data-fav="${s}" title="${fav?'Remove from favourites':'Add to favourites'}" aria-label="Toggle favourite">★</button></div>`; }
function renderIpick(filter=''){
  const list=$('#ipickList'); if(!list) return;
  const f=(filter||'').trim().toLowerCase();
  const match=s=>{ const m=ipkMeta(s); return !f || dispSym(s).toLowerCase().includes(f) || (m.name||'').toLowerCase().includes(f) || (m.grp||'').toLowerCase().includes(f) || (IPK_ALIAS[s]||[]).some(a=>a.toLowerCase().includes(f)); };
  let html='', any=false, idx=0; const flat=[];
  // pseudo-grup Favourites di atas (bila ada & cocok filter) — state dibagi dgn panel Markets
  const favItems=instFav.filter(s=>WATCH_SYMS.includes(s) && match(s));
  if(favItems.length){ any=true;
    html+=`<div class="ipick-eye"><span class="lbl">★ Favourites</span><span class="rule"></span><span class="cnt">${favItems.length}</span></div>`;
    for(const s of favItems){ html+=ipickRowHTML(s,idx); flat.push(s); idx++; } }
  for(const g of IPK_GROUPS){
    const items=WATCH_SYMS.filter(s=>ipkMeta(s).grp===g && match(s));
    if(!items.length) continue; any=true;
    html+=`<div class="ipick-eye"><span class="lbl">${g}</span><span class="rule"></span><span class="cnt">${items.length}</span></div>`;
    for(const s of items){ html+=ipickRowHTML(s,idx); flat.push(s); idx++; }
  }
  list.innerHTML = any ? html : `<div class="ipick-empty">No instruments match “${filter}”.</div>`;
  list._flat=flat;
  list.querySelectorAll('.ipick-row').forEach(r=>r.onclick=e=>{ const st=e.target.closest('.ipk-star[data-fav]');
    if(st){ e.stopPropagation(); toggleInstFav(st.dataset.fav); return; }   // bintang → toggle fav (re-render), tak menutup
    selectSymbol(r.dataset.sym); closeIpick(); });
}
function updateIpickPrices(){ const list=$('#ipickList'); if(!list) return;
  list.querySelectorAll('.ipick-row').forEach(r=>{ const px=r.querySelector('.px'); if(px) px.innerHTML=ipkPriceHTML(r.dataset.sym); }); }
function ipkScrollCursor(){ const el=$('#ipickList').querySelector('.ipick-row.cursor'); if(el) el.scrollIntoView({block:'nearest'}); }
function openIpick(){ const p=$('#ipickPanel'), t=$('#ipickTrg'), q=$('#ipickQ'); if(!p) return;
  ipickOpen=true; ipickCursor=-1; p.classList.add('open'); t.classList.add('open'); t.setAttribute('aria-expanded','true');
  q.value=''; renderIpick(); q.focus(); }
function closeIpick(){ const p=$('#ipickPanel'), t=$('#ipickTrg'); if(!p) return;
  ipickOpen=false; p.classList.remove('open'); t.classList.remove('open'); t.setAttribute('aria-expanded','false'); }
function initIpick(){ const trg=$('#ipickTrg'), q=$('#ipickQ'); if(!trg) return;
  syncIpickTrigger();
  trg.onclick=()=> ipickOpen?closeIpick():openIpick();
  trg.onkeydown=e=>{ if((e.key==='ArrowDown'||e.key==='Enter'||e.key===' ') && !ipickOpen){ e.preventDefault(); openIpick(); } };
  q.oninput=()=>{ ipickCursor=-1; renderIpick(q.value); };
  q.onkeydown=e=>{ const flat=($('#ipickList')._flat)||[];
    if(e.key==='ArrowDown'){ e.preventDefault(); ipickCursor=Math.min(ipickCursor+1,flat.length-1); renderIpick(q.value); ipkScrollCursor(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); ipickCursor=Math.max(ipickCursor-1,0); renderIpick(q.value); ipkScrollCursor(); }
    else if(e.key==='Enter'){ e.preventDefault(); const pick=flat[ipickCursor]||flat[0]; if(pick){ selectSymbol(pick); closeIpick(); trg.focus(); } }
    else if(e.key==='Escape'){ e.preventDefault(); closeIpick(); trg.focus(); } };
  document.addEventListener('click',e=>{ if(ipickOpen && !e.target.closest('#ipick')) closeIpick(); });
}
initIpick();

