// ===================== QT Fractal (Modul C) — util waktu NY (DST-aware) =====================
// Anchor Quarterly Theory selalu America/New_York, independen dari timezone tampilan user.
const _qtDtf = new Intl.DateTimeFormat('en-US', {timeZone:NY_TZ, hourCycle:'h23',
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short'});
const _qtDOW = {Sun:1,Mon:2,Tue:3,Wed:4,Thu:5,Fri:6,Sat:7};
const _qtNyCache = new Map();   // memo nyParts (pure per-ts) → redam Intl.formatToParts per tick
function nyParts(ts){
  let r = _qtNyCache.get(ts); if(r) return r;
  const p = {}; for(const {type,value} of _qtDtf.formatToParts(ts)) p[type]=value;
  r = {y:+p.year, mo:+p.month, d:+p.day, h:+p.hour, min:+p.minute, dow:_qtDOW[p.weekday]};
  if(_qtNyCache.size > 20000) _qtNyCache.clear();   // batasi pertumbuhan (jarang tercapai)
  _qtNyCache.set(ts, r); return r;
}
// Cari epoch-ms utk waktu dinding NY (y,mo,d,h,min). Offset NY = -5 (EST) / -4 (EDT);
// coba kedua offset, pilih yang saat di-nyParts kembali persis ke input (hindari jam ilang/dobel DST).
function nyTimestamp(y, mo, d, h, min){
  min = min || 0;
  for(const off of [4,5]){                     // jam yg ditambah ke waktu NY utk dapat UTC
    const guess = Date.UTC(y, mo-1, d, h+off, min);
    const p = nyParts(guess);
    if(p.y===y && p.mo===mo && p.d===d && p.h===h && p.min===min) return guess;
  }
  // fallback (transisi DST): pakai offset EST.
  return Date.UTC(y, mo-1, d, h+5, min);
}
// Anchor siklus QT (epoch-ms, NY wall-clock) + level/quarter/label. Level: 1=Session 2=Daily 3=Weekly 4=Monthly.
const MS_DAY = 86400000, MS_WK = 604800000, MS_Q90 = 5400000;
function qtSessStart(t){ const {y,mo,d,h}=nyParts(t); const sh = h>=18?18 : h<6?0 : h<12?6 : 12; return nyTimestamp(y,mo,d,sh,0); }
function qtDayStart(t){ const p=nyParts(t); if(p.h<18){ const pr=nyParts(t-18*3600000); return nyTimestamp(pr.y,pr.mo,pr.d,18,0);} return nyTimestamp(p.y,p.mo,p.d,18,0); }
function qtWeekStart(t){
  const p=nyParts(t); const noon=nyTimestamp(p.y,p.mo,p.d,12,0);
  const s=nyParts(noon-(p.dow-1)*MS_DAY); let s18=nyTimestamp(s.y,s.mo,s.d,18,0);
  if(t<s18){ const pw=t-MS_WK; const pr=nyParts(pw); const prNoon=nyTimestamp(pr.y,pr.mo,pr.d,12,0);
    const s2=nyParts(prNoon-(pr.dow-1)*MS_DAY); s18=nyTimestamp(s2.y,s2.mo,s2.d,18,0);} return s18;
}
function qtMonthAnchor(y,mo){ const dow1=nyParts(nyTimestamp(y,mo,1,12,0)).dow; const fmDay=1+((2-dow1+7)%7); return qtWeekStart(nyTimestamp(y,mo,fmDay,12,0)); }
function qtMonthCycleStart(t){
  const {y,mo}=nyParts(t); const aThis=qtMonthAnchor(y,mo); let cs=aThis;
  if(t<aThis){ const py=mo===1?y-1:y, pmo=mo===1?12:mo-1; cs=qtMonthAnchor(py,pmo); }
  else { const ny=mo===12?y+1:y, nmo=mo===12?1:mo+1; const aNext=qtMonthAnchor(ny,nmo); if(t>=aNext) cs=aNext; }
  return cs;
}
function qtCycleStart(lvl,t){ return lvl===2?qtDayStart(t) : lvl===3?qtWeekStart(t) : lvl===4?qtMonthCycleStart(t) : qtSessStart(t); }
function qtLevel(tfSec, opt){
  const auto = tfSec<=300?1 : tfSec<=900?2 : tfSec<=3600?3 : tfSec<=14400?4 : 0;
  return opt==='session'?1 : opt==='daily'?2 : opt==='weekly'?3 : opt==='monthly'?4 : auto;
}
function qtQuarter(lvl,t){
  if(lvl===1){ let q=Math.floor((t-qtSessStart(t))/MS_Q90); return q<0?0:q>3?3:q; }
  if(lvl===2){ const h=nyParts(t).h; return h>=18?0 : h<6?1 : h<12?2 : 3; }
  if(lvl===3){ const off=Math.round((qtDayStart(t)-qtWeekStart(t))/MS_DAY); return off<0?-1 : off<=4?off : -1; }
  if(lvl===4){ const off=Math.round((qtWeekStart(t)-qtMonthCycleStart(t))/MS_WK); return off<0?-1 : off<=3?off : off===4?4 : -1; }
  return -1;
}
function qtLabelText(lvl,t,q){
  if(lvl===1){ const h=nyParts(t).h; const sn=h>=18?'Asia':h<6?'London':h<12?'NY-AM':'PM'; return `${sn} · Q${q+1}`; }
  if(lvl===2){ const sn=q===0?'Asia':q===1?'London':q===2?'NY-AM':'PM'; return `${sn} · Q${q+1}`; }
  if(lvl===3){ const dn=['Mon','Tue','Wed','Thu','Fri'][q]||'Fri'; return q<=3?`${dn} · Q${q+1}`:`${dn} · sp`; }
  return q<=3?`W${q+1} · Q${q+1}`:`W5 · sp`;
}
// calcParams posisi: [levelCode:0=auto..4=monthly, N, fill:0|1, label:0|1].
const LVL_OPT = ['auto','session','daily','weekly','monthly'];
// Bangun segmen per (siklus,quarter) dari dataList kline utk N siklus terakhir.
function qtBuildSegments(dataList, lvl, N){
  if(!dataList || !dataList.length || lvl<=0) return [];
  const segs = new Map();                        // key `${cycleStart}|${q}` → seg
  for(const k of dataList){
    const t = k.timestamp;
    const q = qtQuarter(lvl, t);
    if(q < 0) continue;                          // di luar siklus (weekend/jeda)
    const cs = qtCycleStart(lvl, t);
    const key = cs + '|' + q;
    let s = segs.get(key);
    if(!s){ s = {cycleStart:cs, startTs:t, endTs:t, hi:k.high, lo:k.low, level:lvl, q, text:qtLabelText(lvl, t, q)}; segs.set(key, s); }
    else { s.endTs=t; if(k.high>s.hi)s.hi=k.high; if(k.low<s.lo)s.lo=k.low; }
  }
  // urut waktu, ambil N siklus terakhir.
  const arr = [...segs.values()].sort((a,b)=> a.startTs-b.startTs);
  const cycles = [...new Set(arr.map(s=>s.cycleStart))].sort((a,b)=>a-b);
  const keep = new Set(cycles.slice(-N));
  return arr.filter(s=> keep.has(s.cycleStart));
}
// State draw dibagi calc→draw (klinecharts panggil calc lalu draw pada indikator yg sama).
function registerCustomIndicators(){
  klinecharts.registerIndicator({
    name: 'QT',
    shortName: 'QT Fractal',
    // calcParams: [levelCode, N, fill, label]
    calcParams: [0, 4, 0, 1],
    figures: [],
    calc: (dataList, indicator) => {
      const cp = indicator.calcParams || [0,4,0,1];
      const lvl = qtLevel(tfSeconds(currentTF), LVL_OPT[cp[0]] || 'auto');
      indicator.extendData = { segments: qtBuildSegments(dataList, lvl, cp[1]|0 || 4), fill: !!cp[2], label: cp[3]!==0, lvl };
      return dataList.map(() => ({}));   // per-bar ringan → klinecharts anggap "punya data"
    },
    draw: ({ ctx, indicator, xAxis, yAxis }) => {
      const ed = indicator.extendData; if(!ed || !ed.segments || !ed.segments.length) return false;
      const NEUTRAL = '#8892a6';                       // warna netral PR-1 (warna fase AMD → PR-2)
      ctx.save();
      ctx.font = '10px '+AXIS_FONT;
      for(const s of ed.segments){
        // xAxis.convertToPixel butuh dataIndex (bukan timestamp) di klinecharts 9.8.10 →
        // konversi via tsToFracIndex (gap-aware, sudah dipakai trendline/overlay lain).
        const i1 = tsToFracIndex(s.startTs), i2 = tsToFracIndex(s.endTs);
        if(i1==null || i2==null || !isFinite(i1) || !isFinite(i2)) continue;
        const x1 = xAxis.convertToPixel(i1), x2 = xAxis.convertToPixel(i2);
        const yT = yAxis.convertToPixel(s.hi), yB = yAxis.convertToPixel(s.lo);
        if(!isFinite(x1) || !isFinite(x2) || !isFinite(yT) || !isFinite(yB)) continue;
        const x = Math.min(x1,x2), w = Math.max(2, Math.abs(x2-x1)), y = Math.min(yT,yB), h = Math.max(1, Math.abs(yB-yT));
        if(ed.fill){ ctx.fillStyle = 'rgba(136,146,166,0.10)'; ctx.fillRect(x, y, w, h); }
        ctx.strokeStyle = NEUTRAL; ctx.lineWidth = 1; ctx.setLineDash([2,2]);
        ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
        if(ed.label){
          ctx.fillStyle = NEUTRAL; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillText(s.text, x + w - 2, y + h - 2);
        }
      }
      ctx.restore();
      return false;
    }
  });
}
registerCustomIndicators();

const chart = klinecharts.init('chart', {styles:darkStyles, timezone:chartTZ, customApi:{formatDate:chartFormatDate}});
new ResizeObserver(()=>{ chart.resize(); try{updatePriceTimer();}catch(e){} try{repositionNewsMarkers();}catch(e){} }).observe($('#chart'));
// Jaring pengaman: setelah web-font siap, satu re-measure bersih (sumbu klinecharts diukur ulang dgn Inter final)
try{ if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{ try{ chart.resize(); }catch(e){} }); }catch(e){}

