// ===== Bar Replay: forming bar TF aktif @ cursor T (agregasi sub-bar TF halus, anti-lookahead) =====
function pickFineTF(coarseTF, spanMs){
  for(const f of ['M1','M5','M15','M30','H1','H4']){
    if(DUR[f]>=DUR[coarseTF]) break;
    if(spanMs/DUR[f] <= 1000) return f;
  }
  return null;   // coarseTF sudah cukup halus → forming bar tak perlu
}
// Hybrid: pakai data ter-load bila menutupi [open,end); kalau tidak fetch on-demand (di-cache).
async function ensureFineWindow(fineTF, open, end){
  const key=inst+'|'+fineTF+'|'+open+'|'+end; if(fineWinCache[key]) return fineWinCache[key];
  const loaded=tfData[fineTF];
  if(loaded && loaded.length && loaded[0].timestamp<=open && loaded[loaded.length-1].timestamp+DUR[fineTF]>=end){
    const slice=loaded.filter(b=>b.timestamp>=open && b.timestamp<end);
    if(slice.length){ fineWinCache[key]=slice; return slice; }
  }
  const count=Math.min(5000, Math.ceil((end-open)/DUR[fineTF])+3);
  try{ const data=await fetchCandles(fineTF,{from:new Date(open).toISOString(), count});
       const slice=data.filter(b=>b.timestamp>=open && b.timestamp<end); fineWinCache[key]=slice; return slice; }
  catch(e){ return null; }
}
// Susun candle partial TF `tf` @ cursor T. Return {timestamp,open,high,low,close} atau null.
async function buildReplayPartial(tf){
  if(!replayMode || T==null) return null;
  const arr=tfData[tf]; if(!arr||!arr.length) return null;
  const rev=revealed(tf);                       // bar tutup penuh ≤ T
  const forming=arr[rev.length];                // bar pertama yg BELUM tutup (pemuat T)
  if(!forming) return null;
  const open=forming.timestamp;                  // HANYA open (waktu) dipakai; OHLC bar kasar diabaikan
  if(open>=T) return null;                        // T di boundary/gap → tak ada partial
  const end=arr[rev.length+1]?arr[rev.length+1].timestamp:open+DUR[tf];
  const fineTF=pickFineTF(tf, end-open); if(!fineTF) return null;
  // window sub-bar = rentang PENUH bar kasar [open,end) → kunci cache STABIL antar-frame saat Play
  // (fetch sekali per bar, bukan tiap frame). Anti-lookahead tetap dijaga loop di bawah (b.timestamp+fdur>T).
  const fine=await ensureFineWindow(fineTF, open, end); if(!fine||!fine.length) return null;
  let o=null,h=-Infinity,l=Infinity,c=null, fdur=DUR[fineTF];
  for(const b of fine){
    if(b.timestamp<open) continue;
    if(b.timestamp>=end) break;
    if(b.timestamp+fdur>T) break;                 // sub-bar belum tutup pada T → stop (anti-lookahead)
    if(o==null) o=b.open;
    if(b.high>h) h=b.high; if(b.low<l) l=b.low; c=b.close;
  }
  if(o==null) return null;
  return {timestamp:open, open:o, high:h, low:l, close:c};
}
const MAGNET_REFINE_SKIP={rect:1, fib3:1, verticalStraightLine:1, horizontalStraightLine:1,
  priceLine:1, callout:1}; // box & penanda axis & teks: dilewati
// Berlaku untuk titik ber-timestamp MAUPUN ber-dataIndex pecahan (lewat tsOf). Yang
// disempurnakan hanya VALUE; anchor X tak disentuh supaya presisi sub-bar tak hilang.
async function refineMagnetPoints(id){
  try{
    const o=chart.getOverlayById(id); if(!o||MAGNET_REFINE_SKIP[o.name]) return;
    if(DUR[currentTF]<=DUR.M5) return;                         // sudah ≤M5 → tak ada gunanya
    const cur=currentTF; if(!tfData[cur]||!tfData[cur].length) return;
    // clone PENUH (pertahankan dataIndex titik future!). Dulu map ke {timestamp,value} saja →
    // titik future kehilangan dataIndex saat override → anchorless → garis "kelempar ke kiri".
    const pts=(o.points||[]).map(p=>Object.assign({},p));
    let changed=false;
    for(const p of pts){
      if(p.value==null) continue;
      const t=tsOf(p); if(t==null) continue;   // titik ber-dataIndex pecahan ikut terlayani (fidxToTs)
      // titik FUTURE (di kanan candle TERUNGKAP terakhir): tak ada candle nyata utk di-magnet.
      // Tanpa gate ini, barRangeContaining tak punya batas atas → utk ts apa pun setelah candle
      // terakhir ia balik ke rentang bar TERAKHIR, lalu magnet keras menarik value titik ke OHLC
      // bar itu diam2. Sumber batas WAJIB revealed(cur), bukan tfData[cur]: di mode Bar Replay
      // tfData memuat bar setelah kursor T yang belum terungkap (revealed memotongnya), tapi
      // menggambar tetap aktif di area itu — pakai tfData akan membocorkan OHLC candle yang
      // belum bisa dilihat pengguna ke titik yg dijatuhkan di area "kosong" kanan kursor replay.
      const arrC=revealed(cur); if(!arrC.length) continue;
      if(t>=arrC[arrC.length-1].timestamp+DUR[cur]) continue;
      const rng=barRangeContaining(cur,t); if(!rng) continue;
      const m5=await ensureM5Window(rng.open,rng.end); if(!m5||!m5.length) continue;
      let best=null,bd=Infinity;
      for(const c of m5){ if(c.timestamp>=rng.open && c.timestamp<rng.end){
        for(const v of [c.open,c.high,c.low,c.close]){ const d=Math.abs(v-p.value); if(d<bd){bd=d; best={value:v};} }
      }}
      // magnet "keras": semua titik digeser ke nilai OHLC M5 sebenarnya (tanpa gate jarak).
      // HANYA value yang disempurnakan — anchor X dibiarkan apa adanya, sesuai kebijakan magnet:
      // "magnet hanya menyetel VALUE; X tetap ikut kursor". Menulis p.timestamp di sini akan
      // MENGHAPUS presisi sub-bar titik ber-dataIndex (render meng-snap timestamp ke pusat bar).
      if(best && best.value!==p.value){ p.value=best.value; changed=true; }
    }
    if(changed){ try{chart.overrideOverlay({id, points:pts});}catch(e){} }
  }catch(e){}
}
// klik presisi yang dikumpulkan selama menggambar (menggantikan snap-ke-bar klinecharts)
let pendingClicks=[];

// Penambatan sumbu X. Presisi sub-bar (dataIndex PECAHAN, tanpa timestamp) adalah DEFAULT —
// titik mendarat tepat di piksel klik. klinecharts merender titik ber-`timestamp` dgn men-snap
// ke pusat bar, jadi anchor timestamp = presisi hilang di layar (lihat
// docs/superpowers/specs/2026-07-10-trendline-precision-design.md).
// Snap per-bar disisakan HANYA untuk tool yang memang membutuhkannya:
//   verticalStraightLine — penanda waktu harus = waktu candle yg diklik (snapTimeToBar)
//   long/shortPosition   — entry harus mendarat di center candle terpilih (expandPosition)
// Pasangan tabel ini di sisi test: kolom `anchor` pada TOOL_SPEC (tests/helpers/spec.js).
const BAR_ANCHOR={verticalStraightLine:1, longPosition:1, shortPosition:1};
const subBar=(name)=>!BAR_ANCHOR[name];

