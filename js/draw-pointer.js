// Posisi pointer di ruang #chart, dicatat di fase CAPTURE (sebelum klinecharts memproses event yg
// sama) — sumber X/Y titik karet di onDrawing (js/draw-tools.js). e.x milik klinecharts TAK bisa
// dipakai mentah: saat kursor di atas sumbu harga, event datang dari widget sumbu-Y dgn x RELATIF
// SUMBU (≈0–60px), dan titik karet terlempar ke tepi KIRI chart. X di-clamp ke area plot: di atas
// sumbu harga titik menempel di tepi kanan, spt TV. Pointer events → mouse & sentuh sama-sama tercatat.
let drawPtrPx=null;
function plotWidth(){ try{ const s=chart.getSize('candle_pane','main'); if(s && s.width>0) return s.width; }catch(_){} return null; }
['pointermove','pointerdown'].forEach(t=>$('#chart').addEventListener(t, ev=>{
  if(!inProgressId){ drawPtrPx=null; return; }
  const r=$('#chart').getBoundingClientRect(), w=plotWidth();
  let x=ev.clientX-r.left; if(w!=null) x=Math.min(Math.max(x,0), w-1);
  drawPtrPx={x, y:ev.clientY-r.top};
}, true));

// tangkap klik PRESISI saat menggambar (sebelum klinecharts snap ke bar) → simpan
// waktu sub-bar; bila magnet aktif, snap ke nilai OHLC candle terdekat.
// `k` = indeks klik yg sedang dicatat (menentukan jangkar kunci Shift). Balikan: entri pendingClicks / null.
function clickEntryAt(ev, k){
  const r=$('#chart').getBoundingClientRect();
  let px=ev.clientX-r.left, py=ev.clientY-r.top;
  // Shift = kunci sudut (js/draw-constrain.js). WAJIB di sini juga, bukan cuma di onDrawing:
  // titik yang benar-benar di-commit datang dari pendingClicks ini, jadi tanpa penguncian di
  // jalur klik garis akan "lompat" ke kursor mentah tepat saat tombol ditekan.
  let locked=false;
  { const nm=(chart.getOverlayById(inProgressId)||{}).name, ai=lockAnchorIdx(nm, k);
    if(ai>=0 && pendingClicks[ai]){
      // Jangkar WAJIB dibaca dgn aturan anchor yg sama dgn jalur commit (onDrawEnd): klik magnet
      // memakai `timestamp`, klik biasa memakai `fidx` PECAHAN. pendingClicks membawa KEDUANYA,
      // dan `timestamp` sendiri meng-snap ke pusat bar saat dikonversi — memakainya untuk klik
      // biasa menggeser jangkar s/d ½ bar, dan garis "vertikal" meleset beberapa piksel.
      const pc=pendingClicks[ai];
      const a=anchorPx(pc.mag||!isFinite(pc.fidx) ? pc : {dataIndex:pc.fidx, value:pc.value});
      if(a){ const c=lockPx(a.x, a.y, px, py); px=c.x; py=c.y; locked=true; } } }
  const xa=xAnchorFromPx(px), v=pxToValue(py);
  if(!xa||v==null) return null;
  // fidx = fractional dataIndex PRESISI di piksel klik (utk trendline; tsToPx meng-snap timestamp
  // jadi tak bisa direkonstruksi dari timestamp di onDrawEnd). Field ekstra → tool lain mengabaikan.
  const fa=barAnchorFromPx(px), fidx=fa?fa.dataIndex:undefined;
  // magnet HANYA utk titik di dalam data (punya timestamp). Titik di area future (dataIndex,
  // tanpa candle) tak boleh di-snap: magnetSnap akan menariknya ke bar TERAKHIR → garis
  // "kelempar ke kiri". Biarkan anchor dataIndex-nya apa adanya supaya memanjang ke future.
  // `mag:true` menandai klik yang SUDAH di-snap: onDrawEnd memakainya untuk membiarkan anchor
  // timestamp-nya (= terkunci di candle) alih-alih menimpanya dengan fidx kursor.
  if(magnetActive() && !locked && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s) return {timestamp:s.timestamp, value:s.value, fidx, mag:true}; }
  return Object.assign({value:v, fidx}, xa);
}

// ===== klik "goyang" saat menggambar (T2, tests/drawing/11-click-wiggle.spec.js) =====
// Tangan jarang diam sempurna antara mousedown & mouseup. klinecharts membatalkan klik begitu
// geseran tertekan ≥5px manhattan (`_mouseMoveWithDownHandler` → `_cancelClick`) dan mengubahnya
// jadi pan: titik tak tertanam, chart bergeser, dan entri pendingClicks dari mousedown jadi yatim
// (desync → Esc Path menyimpan titik karet, refine onDrawEnd memasang klik yang salah). TradingView
// memperlakukan goyangan kecil sebagai klik. Selama menggambar, geseran tertekan ≤ DRAW_CLICK_SLOP_PX
// (euclid, dari titik mousedown) tak diteruskan ke klinecharts → klik tetap utuh & tak ada pan.
// Lewat ambang = seret sungguhan: diteruskan apa adanya (pan, spt biasa) dan entri pendingClicks
// mousedown itu dicabut, karena klinecharts tak akan memancarkan kliknya.
//
// Kenapa menimpa method INSTANCE: handler move-tertekan di-`bind` ulang di SETIAP mousedown
// (`this._mouseMoveWithDownHandler.bind(this)` di `_mouseDownHandler`), jadi properti instance yg
// ditimpa di sini terbaca di mousedown berikutnya. Defensif spt js/click-guard.js: bentuk internal
// berubah setelah upgrade → no-op, perilaku kembali ke klinecharts mentah.
const DRAW_CLICK_SLOP_PX = 8;
let drawPress=null;   // {x,y: page px mousedown, n: indeks klik, pushed, moved, panned}
function fixDrawClickSlop(inst){
  try{
    const se = inst && inst._chartEvent && inst._chartEvent._event;
    if(!se || typeof se._mouseMoveWithDownHandler!=='function') return false;
    const orig=se._mouseMoveWithDownHandler;
    se._mouseMoveWithDownHandler=function(ev){
      const p=drawPress;
      if(p && !p.panned && inProgressId){
        if(Math.hypot(ev.pageX-p.x, ev.pageY-p.y)<=DRAW_CLICK_SLOP_PX){ p.moved=true; return; }
        p.panned=true;
        if(p.pushed && pendingClicks.length===p.n+1) pendingClicks.pop();
      }
      return orig.call(this, ev);
    };
    return true;
  }catch(_){ return false; }
}
const drawSlopOn=fixDrawClickSlop(chart);

$('#chart').addEventListener('mousedown', (ev)=>{
  drawPress=null;
  if(!inProgressId || ev.button!==0) return;   // hanya klik kiri (klik kanan/tengah tak boleh jadi titik)
  const n=pendingClicks.length, pc=clickEntryAt(ev, n);
  if(pc) pendingClicks.push(pc);
  if(drawSlopOn) drawPress={x:ev.pageX, y:ev.pageY, n, pushed:!!pc, moved:false, panned:false};
}, true);
// Klik goyang: klinecharts menanam titik di posisi MOUSEUP → entri pendingClicks ikut dipindah ke
// sana, supaya refine onDrawEnd melihat klik ↔ titik selaras. Capture di window = jalan SEBELUM
// handler mouseup klinecharts (bubble di documentElement) yg memancarkan klik & bisa memicu onDrawEnd.
window.addEventListener('mouseup', (ev)=>{
  const p=drawPress; drawPress=null;
  if(!p || ev.button!==0 || !p.moved || p.panned || !p.pushed || !inProgressId) return;
  if(pendingClicks.length!==p.n+1) return;
  const pc=clickEntryAt(ev, p.n); if(pc) pendingClicks[p.n]=pc;
}, true);

// posisi kursor terakhir (client px) — untuk menempatkan popup setting objek.
// Sengaja HANYA di-update oleh mousemove di #chart: seluruh pemakainya (popup setting/konfirmasi,
// jaring pengaman anchor di onDrawEnd & posisi paper, hit-test badge alert, overPlaceholder)
// berjalan saat pointer memang berada di atas chart dan butuh koordinat yg valid di dalam chart.
let lastPtr={x:innerWidth/2,y:innerHeight/2};
// Apakah pointer SEDANG di atas chart. Dipisah dari lastPtr justru karena lastPtr basi by design:
// ia menyimpan posisi terakhir DI DALAM chart, jadi ia tak pernah bisa memberitahu "pointer sudah
// di luar". Instant-drop (Alt+H/V) butuh info itu — lihat instantDropPoint (Temuan 4 E2E).
let ptrOverChart=false;

// reticle preview live: penanda titik yg akan mendarat saat menggambar — tampil di SEMUA
// kondisi draw. Magnet ON → menempel ke OHLC terdekat (walau kursor jauh dari candle);
// magnet OFF / area future → mengikuti kursor persis (= titik yg akan di-drop).
const magDot=document.createElement('div'); magDot.className='mag-dot'; $('#chart').appendChild(magDot);
function hideMagDot(){ magDot.style.display='none'; }
function updateMagDot(ev){
  if(!inProgressId || cursorMode!=='dot'){ hideMagDot(); return; }   // reticle titik HANYA di cursor 'dot' (cross → cuma garis; arrow → bersih). Magnet tetap men-snap posisinya.
  const r=$('#chart').getBoundingClientRect();
  let px=ev.clientX-r.left, py=ev.clientY-r.top;
  // Reticle ikut terkunci saat Shift ditahan — kalau tidak, penanda dan garis menunjuk tempat
  // berbeda, dan justru penanda itulah yang dipercaya pengguna saat membidik.
  const o0=chart.getOverlayById(inProgressId);
  let locked=false;
  const ai0=(o0 && o0.points) ? lockAnchorIdx(o0.name, o0.points.length-1) : -1;
  if(ai0>=0){ const a=anchorPx(o0.points[ai0]);
    if(a){ const c=lockPx(a.x, a.y, px, py); px=c.x; py=c.y; locked=true; } }
  const v=pxToValue(py); if(v==null){ hideMagDot(); return; }
  // Reticle WAJIB memakai anchor yg IDENTIK dgn titik yg akan di-commit, lalu dirender lewat
  // convertToPixel yg SAMA dgn mesin render → dijamin mendarat tepat di posisi titik sebenarnya.
  // (Kursor mentah meleset: convertToPixel(timestamp) meny-snap ke bar utk tool BAR_ANCHOR,
  // sedang tool sub-bar beranchor dataIndex pecahan/presisi. Menyatukan jalur magnet ON/OFF.)
  let anchor=null;
  if(magnetActive() && !locked){
    const xa=xAnchorFromPx(px);
    if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s) anchor={timestamp:s.timestamp, value:s.value}; }
  }
  if(!anchor){
    const o=chart.getOverlayById(inProgressId), name=o&&o.name;
    // name falsy (overlay tak ketemu) → jatuh ke cabang BAR_ANCHOR (perilaku lama): subBar(undefined)
    // sendiri bernilai true (bukan anggota BAR_ANCHOR), jadi name dicek eksplisit lebih dulu.
    if(name && subBar(name)){ const fa=barAnchorFromPx(px); if(fa) anchor={dataIndex:fa.dataIndex, value:v}; }   // X = pusat candle (fidx bulat)
    else { const xa=xAnchorFromPx(px); if(xa) anchor=Object.assign({value:v}, xa); }                             // BAR_ANCHOR: timestamp (ikut snap render)
  }
  if(!anchor){ hideMagDot(); return; }
  const key = anchor.timestamp!=null ? {timestamp:anchor.timestamp, value:anchor.value} : {dataIndex:anchor.dataIndex, value:anchor.value};
  let cp=chart.convertToPixel(key,{paneId:'candle_pane',absolute:true}); if(Array.isArray(cp)) cp=cp[0];
  if(!cp){ hideMagDot(); return; }
  magDot.style.left=cp.x+'px'; magDot.style.top=cp.y+'px'; magDot.style.display='block';
}
$('#chart').addEventListener('mousemove',ev=>{ lastPtr={x:ev.clientX,y:ev.clientY}; ptrOverChart=true; updateMagDot(ev); });
$('#chart').addEventListener('mouseenter',()=>{ ptrOverChart=true; });
// mouseleave (bukan mouseout) → tak ikut memadamkan flag saat pointer pindah ke elemen ANAK #chart
// (reticle, legend, marker news). Pointer pindah ke panel melayang di atas chart = benar-benar
// keluar dari chart → instant-drop jatuh ke mode gambar biasa, sesuai niat yg ditulis di sana.
$('#chart').addEventListener('mouseleave',()=>{ ptrOverChart=false; hideMagDot(); });

