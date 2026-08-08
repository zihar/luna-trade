// ===================== util =====================
function priceDecimals(){ return symDecimals(inst); }   // sumber tunggal presisi (baca IPK_META: stocks, indeks, dst)
function fmt(p){ return p==null||isNaN(p)?'—':(+p).toFixed(priceDecimals()); }
function nyTime(ms){
  try{
    return new Intl.DateTimeFormat('en-CA',{timeZone:chartTZ,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms)).replace(',','');
  }catch(e){ return new Date(ms).toISOString().slice(0,16).replace('T',' '); }
}
// Candle Daily di-align buka 18:00 NY (sesi ICT/FOREX.com) → satu sesi membentang 18:00→18:00 (mayoritas
// hari berikutnya). Konvensi trading-day: candle dinamai per hari TUTUP-nya (buka + durasi), bukan hari buka.
// Contoh: sesi buka 17 Feb 18:00 (tutup 18 Feb 18:00) dilabeli "18 Feb". Hanya untuk D (W/MN tak diubah).
const CLOSE_LABEL_TF={D:1};
// MN butuh penawarnya sendiri: OANDA menandai bar bulanan dengan waktu BUKA-nya, yaitu 17:00 NY di
// hari TERAKHIR bulan sebelumnya — jadi tanpa pergeseran, bar Juli dilabeli "30 Jun". Menggeser
// sebesar DUR.MN tidak bisa dipakai (30,44 hari bisa mendarat di bulan yang salah untuk Februari);
// +12 jam sudah cukup mendarat di hari ke-1 bulan dagang, apa pun keadaan DST-nya.
function labelTs(ms){
  if(currentTF==='MN') return ms + 12*3600000;
  return CLOSE_LABEL_TF[currentTF] ? ms + DUR[currentTF] : ms;
}
// label tanggal crosshair sumbu-X: "Tue 30 Jun '26 10:00" (ada hari) — hormati timezone chart.
// TF Daily ke atas (D/W/MN): tanpa jam → cukup hari + tanggal ("Tue 30 Jun '26"), krn 1 bar = ≥1 hari.
function crosshairDate(ms){
  try{
    // MN: satu bar = satu bulan penuh, jadi hari & jam tak punya arti — "Jul '26", seperti TV.
    if(currentTF==='MN'){
      const p=new Intl.DateTimeFormat('en-GB',{timeZone:chartTZ,month:'short',year:'2-digit'}).formatToParts(new Date(labelTs(ms)));
      const g=t=>{const x=p.find(o=>o.type===t);return x?x.value:'';};
      return `${g('month')} '${g('year')}`;
    }
    const dayOnly = DUR[currentTF] >= DUR.D;
    const opt={timeZone:chartTZ,weekday:'short',day:'2-digit',month:'short',year:'2-digit'};
    if(!dayOnly){ opt.hour='2-digit'; opt.minute='2-digit'; opt.hour12=false; }
    const p=new Intl.DateTimeFormat('en-GB',opt).formatToParts(new Date(labelTs(ms)));
    const g=t=>{const x=p.find(o=>o.type===t);return x?x.value:'';};
    const base=`${g('weekday')} ${g('day')} ${g('month')} '${g('year')}`;
    return dayOnly ? base : `${base} ${g('hour')}:${g('minute')}`;
  }catch(e){ return nyTime(ms); }
}
// tick sumbu-X (klinecharts): hormati pola `format` (granularitas) + timezone chart.
function axisTickDate(ms, pattern){
  try{
    const p=new Intl.DateTimeFormat('en-GB',{timeZone:chartTZ,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(labelTs(ms)));
    const g=t=>{const x=p.find(o=>o.type===t);return x?x.value:'';};
    return String(pattern||'YYYY-MM-DD HH:mm').replace('YYYY',g('year')).replace('MM',g('month'))
      .replace('DD',g('day')).replace('HH',g('hour')).replace('mm',g('minute')).replace('ss',g('second'));
  }catch(e){ return nyTime(ms); }
}
// dipakai di klinecharts.init(customApi.formatDate). FormatDateType klinecharts: 0=Tooltip,
// 1=Crosshair, 2=XAxis. Tick sumbu (2) → ringkas hormati pola; crosshair/tooltip (0/1) → ada hari.
function chartFormatDate(_dtf, timestamp, format, type){
  return (type===2 || type==='xAxis') ? axisTickDate(timestamp, format) : crosshairDate(timestamp);
}
// candle terungkap = yang sudah CLOSED pada cursor T (anti-lookahead), via binary search
// Batas tutup lewat barEndAt (bukan timestamp+DUR): untuk MN, DUR salah 13j–58j tergantung bulan,
// dan di sini itu berarti bar bulanan telat/kecepatan terungkap di Bar Replay. barEndAt tetap
// monoton naik, jadi binary search di bawah tetap sah.
function revealed(tf){
  const arr=tfData[tf]; if(!arr) return [];
  let lo=0,h=arr.length;
  while(lo<h){ const m=(lo+h)>>1; if(barEndAt(tf,m,arr)<=T) lo=m+1; else h=m; }
  return arr.slice(0,lo);
}
function currentCandle(){ const a=revealed(currentTF); return a.length?a[a.length-1]:null; }

// Koordinat pixel tiap titik overlay (rect/trendline/fib/dateRange/text/position).
// DULU: interpolasi sub-bar (x pecahan antar bar) demi presisi dalam-bar. MASALAH: titik
// handle bawaan klinecharts (`needDefaultPointFigure`) SELALU di-snap ke pusat bar
// (timestampToDataIndex→binarySearchNearest→indeks integer). Jadi BENTUK (sub-bar) & HANDLE
// (snapped) bisa meleset s/d ±½ lebar bar → "titik drag bergeser dari pojok" + ukuran tampak
// berubah saat resize (drag klinecharts snap ke bar). SOLUSI: pakai koordinat NATIVE
// klinecharts (identik dengan posisi handle) → bentuk & handle SELALU sinkron, di semua TF.
// Harga/y tetap presisi (value→pixel akurat); hanya x yang ikut grid bar — sama spt TradingView.
function subBarCoords(overlay, coordinates){ return coordinates; }

// [presisi sub-bar] pixel-x → timestamp presisi (interpolasi antar 2 bar tetangga)
function pxToTime(x){
  const arr=revealed(currentTF); if(!arr.length) return null;
  let c=chart.convertFromPixel({x,y:0},{paneId:'candle_pane'}); if(Array.isArray(c)) c=c[0];
  let i = (c&&c.dataIndex!=null)?Math.round(c.dataIndex):(c&&c.timestamp!=null?arr.findIndex(b=>b.timestamp===c.timestamp):null);
  if(i==null||i<0) i=0; if(i>arr.length-1) i=arr.length-1;
  const px=t=>{let p=chart.convertToPixel({timestamp:t,value:0},{paneId:'candle_pane',absolute:true}); if(Array.isArray(p))p=p[0]; return p?p.x:null;};
  const xi=px(arr[i].timestamp);
  let j=(x>=xi)?Math.min(i+1,arr.length-1):Math.max(i-1,0);
  if(j===i||xi==null) return arr[i].timestamp;
  const xj=px(arr[j].timestamp); if(xj==null||xj===xi) return arr[i].timestamp;
  const f=(x-xi)/(xj-xi);
  return Math.round(arr[i].timestamp + f*(arr[j].timestamp-arr[i].timestamp));
}
function pxToValue(y){ let c=chart.convertFromPixel({x:10,y},{paneId:'candle_pane'}); if(Array.isArray(c))c=c[0]; return c?c.value:null; }
// ---- anchor x titik overlay: hybrid timestamp (in-data, durable) / dataIndex (area future) ----
// klinecharts meng-clamp timestamp ke candle terakhir, tapi MENG-EKSTRAPOLASI dataIndex tanpa
// clamp → titik di area kosong kanan WAJIB dibawa sebagai {dataIndex} (tanpa timestamp).
function idxToPx(idx){ let p=chart.convertToPixel({dataIndex:idx,value:0},{paneId:'candle_pane',absolute:true}); if(Array.isArray(p))p=p[0]; return p?p.x:null; }
function tsToPx(t){ let p=chart.convertToPixel({timestamp:t,value:0},{paneId:'candle_pane',absolute:true}); if(Array.isArray(p))p=p[0]; return p?p.x:null; }
function barSpacePx(){ const li=revealed(currentTF).length-1; const a=idxToPx(li), b=idxToPx(li-1); return (a!=null&&b!=null&&a!==b)?(a-b):8; }
// pixel-x → anchor durable: dalam-data → timestamp presisi sub-bar; future → dataIndex fractional.
// dataIndex diambil dari convertFromPixel (mesin koordinat chart sendiri) → DIJAMIN inverse dgn
// convertToPixel saat render, jadi titik selalu tergambar tepat di posisi klik. (Perhitungan manual
// li+((x-xLast)/bs) dulu memakai li=revealed() yg di mode Live beda 1 dgn dataList chart karena
// forming bar → bisa meleset jauh / "kelempar ke kiri". Pakai chart lgsg = konsisten & anti-drift.)
function xAnchorFromPx(x){
  const arr=revealed(currentTF); if(!arr.length) return null;
  const li=arr.length-1;
  let c=chart.convertFromPixel({x,y:0},{paneId:'candle_pane'}); if(Array.isArray(c)) c=c[0];
  const floatIdx = (c && c.dataIndex!=null) ? c.dataIndex : li;
  if(floatIdx <= li + 0.0001){ const t=pxToTime(x); return t!=null?{timestamp:t}:null; }   // in-range
  return {dataIndex: floatIdx};                                                              // future
}
// pixel-x (container-relative) → fractional dataIndex PRESISI. Dipakai jalur trendline supaya
// titik mendarat tepat di kursor. convertFromPixel().dataIndex mengembalikan INTEGER (snap),
// jadi fraksi sub-bar dihitung dari offset piksel terhadap bar integer itu (inverse linear
// dataIndexToCoordinate). Index-space = chart (konsisten dgn overrideOverlay/convertToPixel).
function fracAnchorFromPx(x){
  const arr=revealed(currentTF); if(!arr.length) return null;
  let c=chart.convertFromPixel({x,y:0},{paneId:'candle_pane'}); if(Array.isArray(c)) c=c[0];
  const i=(c&&c.dataIndex!=null)?c.dataIndex:(arr.length-1);
  const xi=idxToPx(i), bs=barSpacePx();
  if(xi==null||!bs) return {dataIndex:i};
  return {dataIndex: i + (x-xi)/bs};
}
// fractional dataIndex → wall-clock ms. In-data: interpolasi antar 2 bar tetangga (anti-gap
// weekend). Future (idx>=li): ekstrapolasi linear DUR. Kebalikan dari tsToFracIndex.
function fidxToTs(idx){
  const a=revealed(currentTF); if(!a.length||idx==null) return null;
  const li=a.length-1;
  if(idx>=li) return Math.round(tsAfterSteps(currentTF, a[li].timestamp, idx-li));
  if(idx<=0) return a[0].timestamp;
  const i=Math.floor(idx), f=idx-i, t0=a[i].timestamp, t1=a[Math.min(i+1,li)].timestamp;
  return Math.round(t0 + f*(t1-t0));
}
// wall-clock ms → fractional dataIndex. Future (vt>=last): ekstrapolasi DUR. In-data:
// cari bar pengapit lalu interpolasi. Kebalikan dari fidxToTs.
function tsToFracIndex(vt){
  const a=revealed(currentTF); if(!a.length||vt==null) return null;
  const li=a.length-1, lt=a[li].timestamp;
  if(vt>=lt) return li + barStepsFrom(currentTF, lt, vt);
  if(vt<=a[0].timestamp) return 0;
  let lo=0,hi=li; while(lo<hi){ const m=(lo+hi)>>1; if(a[m].timestamp<vt) lo=m+1; else hi=m; }
  const i=Math.max(0,lo-1), t0=a[i].timestamp, t1=a[Math.min(i+1,li)].timestamp;
  const fr=(t1>t0)?(vt-t0)/(t1-t0):0; return i+fr;
}
// timestamp (virtual bila future) — untuk label/durasi/anchor teks
function tsOf(p){ if(!p) return null; if(p.timestamp!=null) return p.timestamp;
  if(p.dataIndex!=null) return fidxToTs(p.dataIndex); return null; }
// objek key x untuk convertToPixel & rebuild point (pertahankan timestamp vs dataIndex)
function keyOf(p){ return (p&&p.timestamp!=null)?{timestamp:p.timestamp}:{dataIndex:p&&p.dataIndex}; }
// float index untuk ordering kiri/kanan & titik tengah
function fidxOf(p){ if(p&&p.dataIndex!=null) return p.dataIndex; const li=revealed(currentTF).length-1, xLast=idxToPx(li), xx=tsToPx(p&&p.timestamp); return (xLast!=null&&xx!=null)? li+(xx-xLast)/barSpacePx() : li; }
// titik tengah handle (TC/BC/ML/MR) → SELALU di tengah PIKSEL, bukan tengah timestamp.
// Posisi x di chart linear thd indeks bar (dataIndex), sedang timestamp tak rata per-piksel
// (ada gap akhir pekan & area future saat box memanjang ke kanan). fidxOf() memetakan
// timestamp → indeks bar pecahan yg konsisten dgn piksel, jadi midpoint-nya presisi.
function midAnchor(a,b){ return {dataIndex:(fidxOf(a)+fidxOf(b))/2}; }
// snap waktu sub-bar (hasil pxToTime) ke timestamp bar TERDEKAT — dipakai garis vertikal
// supaya penanda waktu = waktu candle yg diklik, dan garis nempel pas di bar itu (jadi
// bisa diklik ulang utk select/hapus). Di luar rentang bar (mis. area future) dibiarkan.
function snapTimeToBar(t){
  const arr=revealed(currentTF); if(!arr.length||t==null) return t;
  if(t<=arr[0].timestamp) return arr[0].timestamp;
  const last=arr[arr.length-1].timestamp; if(t>=last) return last;
  let lo=0,hi=arr.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(arr[m].timestamp<t) lo=m+1; else hi=m; }
  const b=arr[lo].timestamp, a=arr[lo-1]?arr[lo-1].timestamp:b;
  return (t-a<=b-t)?a:b;
}
// Pixel-x + harga → titik anchor menurut kebijakan per-tool: tool sub-bar dapat dataIndex PECAHAN
// (presisi), tool BAR_ANCHOR dapat timestamp lalu di-snap ke bar (x-nya memang harus align ke
// candle). Satu-satunya tempat kebijakan ini ditulis — instantDropPoint (js/draw-tools.js) dan
// pasteOverlayAt (js/draw-copy-paste.js) sama-sama memakainya, dan menyimpang dari kebijakan ini
// membuat titik "loncat" saat objek dibuat.
function anchorFromPx(name, x, v){
  const xa = subBar(name) ? fracAnchorFromPx(x) : xAnchorFromPx(x); if(!xa) return null;
  const np=Object.assign({value:v}, xa);
  if(name==='verticalStraightLine' && np.timestamp!=null) np.timestamp=snapTimeToBar(np.timestamp);
  return np;
}

// [magnet] snap (time,value) ke nilai OHLC candle terdekat — pakai data intraday
// terhalus yang ter-load dalam rentang bar saat ini → mendarat di OHLC PRESISI.
let magnetOn = (localStorage.getItem('br_magnet')==='1');
function finestLoadedTF(){ for(const tf of TF_LIST){ if(tfData[tf]&&tfData[tf].length) return tf; } return currentTF; }
// magnet "keras": snap (time,value) SELALU ke nilai OHLC (open/high/low/close) candle terdekat
// dalam rentang bar, tanpa peduli jarak kursor (px,py diabaikan — dipertahankan utk kompatibilitas pemanggil).
function magnetSnap(time, value, px, py){
  const cur=currentTF, arr=revealed(cur); if(!arr.length) return null;
  let a=0,b=arr.length; while(a<b){const m=(a+b)>>1; if(arr[m].timestamp<=time) a=m+1; else b=m;}
  let i=Math.max(0,a-1);
  // Bar TERDEKAT, bukan bar yang MEMUAT waktu itu. Sebuah candle digambar dgn timestamp-nya di
  // TENGAH, jadi separuh KIRI badan candle punya waktu < jam bukanya — "bar yang memuat" di sana
  // adalah candle SEBELUMNYA, dan magnet menempel ke tetangga yang tak ditunjuk kursor (terukur:
  // klik 3px di kiri pusat bar mendarat di O/H/L/C bar sebelah). pxToTime menginterpolasi linear
  // antar bar tetangga, jadi "terdekat dalam waktu" = "terdekat dalam piksel". Sama seperti
  // snapTimeToBar untuk garis vertikal.
  if(i+1<arr.length && (time-arr[i].timestamp) > (arr[i+1].timestamp-time)) i++;
  const bar=arr[i], barOpen=bar.timestamp, barEnd=barEndAt(cur,i,arr);
  // Kandidat harga PERSIS EMPAT: O/H/L/C bar yang tampak. Titik magnet harus DISKRIT — geser
  // kursor beberapa piksel di dalam candle yang sama tak boleh memindahkannya; yang memindahkan
  // hanya pindah candle atau pindah ke level OHLC lain.
  //
  // Data TF halus dulu ikut menyumbang O/H/L/C tiap sub-bar sebagai kandidat (`d<bestD`), padahal
  // komentar di atasnya sudah menyatakan niat "cuma menambah presisi timestamp untuk nilai yang
  // sama". Akibatnya daftar kandidat memuai: terukur 4 → 45 harga berbeda di satu bar M15 begitu
  // M1 ter-load — di wick setinggi 62px itu ±1.4px per kandidat, jadi magnet praktis kontinu dan
  // titiknya mengikuti kursor, bukan menempel. Sekarang TF halus hanya dipakai untuk MENAJAMKAN
  // WAKTU: mencari sub-bar yang benar-benar mencetak nilai terpilih.
  //
  // Bar yang TAMPAK tetap satu-satunya sumber harga, jadi kasus lama tetap tertutup: TF halus
  // yang cuma menutup SEBAGIAN rentang (tiap TF di-load 5000 bar, jadi jendelanya selalu lebih
  // pendek) maupun bar berjalan (tfData hanya memuat candle `complete`) tak bisa lagi menggeser
  // magnet keluar dari ujung wick — paling buruk waktunya saja yang tak tertajamkan.
  let kind=null, bestV=null, bestD=Infinity;
  for(const [k,v] of [['open',bar.open],['high',bar.high],['low',bar.low],['close',bar.close]]){
    const d=Math.abs(v-value); if(d<bestD){bestD=d; bestV=v; kind=k;}
  }
  if(bestV==null) return null;
  let ts=barOpen;
  const ftf=finestLoadedTF();
  if(DUR[ftf]<DUR[cur] && tfData[ftf]){
    // revealed(), bukan tfData mentah: bar kasarnya sendiri diambil dari revealed(), jadi sumber
    // halusnya harus dipotong di kursor yang sama — kalau tidak, di Bar Replay ia bisa menawarkan
    // waktu dari bagian bar yang belum boleh dilihat pengguna.
    const t=subBarTimeOf(revealed(ftf), barOpen, barEnd, kind, bestV); if(t!=null) ts=t;
  }
  // magnet "keras": selalu nempel ke nilai OHLC terdekat (tanpa gate jarak kursor).
  return {timestamp:ts, value:bestV};
}
// menit sub-bar dalam [open,end) yang mencetak `v` sebagai `kind` bagi bar kasarnya, atau null
// bila tak ada (mis. jendela TF halus tak menutup ujung bar). Nilai berasal dari agregasi
// min/max/first/last atas angka yang sama, jadi perbandingannya memang persis.
//
// Rentangnya disaring DI SINI (bukan lewat .filter pemanggil): fungsi ini dipanggil tiap
// mousemove atas array sepanjang 5000 bar, jadi array antara akan jadi sampah per-frame.
// open dicetak sub-bar PERTAMA & close oleh yang TERAKHIR (agregasi), high/low oleh sub-bar
// mana pun yang menyentuhnya → arah pencariannya beda per jenis.
function subBarTimeOf(sub, open, end, kind, v){
  if(!sub||!sub.length) return null;
  if(kind==='close'){
    for(let i=sub.length-1;i>=0;i--){ const c=sub[i]; if(c.timestamp>=end) continue; if(c.timestamp<open) break;
      if(c.close===v) return c.timestamp; }
    return null;
  }
  for(const c of sub){ if(c.timestamp<open) continue; if(c.timestamp>=end) break;
    if(c[kind]===v) return c.timestamp; }
  return null;
}
// [magnet presisi M5] Saat menggambar dgn magnet di TF besar (mis. Daily), nilai OHLC hanya
// se-presisi data terhalus yg KEBETULAN ter-load → sering mentok di jam buka candle (mis.
// Daily buka 18:00 NY). Setelah gambar selesai, ambil M5 ON-DEMAND utk rentang tiap candle
// yg di-magnet, lalu geser titik ke menit OHLC M5 yg sebenarnya → presisi saat pindah TF.
const m5WinCache={};                    // key: "INST|barOpenMs" → array M5 candle (rentang 1 bar)
const fineWinCache={};       // "INST|fineTF|open|end" → array sub-bar (forming bar replay)
function barRangeContaining(tf, ts){    // batas [open,end) bar TF `tf` yang memuat ts (anti-gap weekend)
  const arr=tfData[tf]; if(!arr||!arr.length||ts==null) return null;
  let a=0,b=arr.length; while(a<b){const m=(a+b)>>1; if(arr[m].timestamp<=ts) a=m+1; else b=m;}
  const i=Math.max(0,a-1), open=arr[i].timestamp;
  const end=barEndAt(tf,i,arr);
  return {open,end};
}
async function ensureM5Window(open,end){
  const key=inst+'|'+open; if(m5WinCache[key]) return m5WinCache[key];
  const count=Math.min(5000, Math.ceil((end-open)/DUR.M5)+3);   // from+count (hindari konflik from+to+count OANDA)
  try{ const data=await fetchCandles('M5',{from:new Date(open).toISOString(), count}); m5WinCache[key]=data; return data; }
  catch(e){ return null; }
}
