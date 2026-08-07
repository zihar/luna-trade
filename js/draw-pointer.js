// tangkap klik PRESISI saat menggambar (sebelum klinecharts snap ke bar) → simpan
// waktu sub-bar; bila magnet aktif, snap ke nilai OHLC candle terdekat.
$('#chart').addEventListener('mousedown', (ev)=>{
  if(!inProgressId || ev.button!==0) return;   // hanya klik kiri (klik kanan/tengah tak boleh jadi titik)
  const r=$('#chart').getBoundingClientRect();
  const px=ev.clientX-r.left, py=ev.clientY-r.top;
  const xa=xAnchorFromPx(px), v=pxToValue(py);
  if(!xa||v==null) return;
  // fidx = fractional dataIndex PRESISI di piksel klik (utk trendline; tsToPx meng-snap timestamp
  // jadi tak bisa direkonstruksi dari timestamp di onDrawEnd). Field ekstra → tool lain mengabaikan.
  const fa=fracAnchorFromPx(px), fidx=fa?fa.dataIndex:undefined;
  // magnet HANYA utk titik di dalam data (punya timestamp). Titik di area future (dataIndex,
  // tanpa candle) tak boleh di-snap: magnetSnap akan menariknya ke bar TERAKHIR → garis
  // "kelempar ke kiri". Biarkan anchor dataIndex-nya apa adanya supaya memanjang ke future.
  // `mag:true` menandai klik yang SUDAH di-snap: onDrawEnd memakainya untuk membiarkan anchor
  // timestamp-nya (= terkunci di candle) alih-alih menimpanya dengan fidx kursor.
  if(magnetOn && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s){ pendingClicks.push({timestamp:s.timestamp, value:s.value, fidx, mag:true}); return; } }
  pendingClicks.push(Object.assign({value:v, fidx}, xa));
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
  const px=ev.clientX-r.left, py=ev.clientY-r.top;
  const v=pxToValue(py); if(v==null){ hideMagDot(); return; }
  // Reticle WAJIB memakai anchor yg IDENTIK dgn titik yg akan di-commit, lalu dirender lewat
  // convertToPixel yg SAMA dgn mesin render → dijamin mendarat tepat di posisi titik sebenarnya.
  // (Kursor mentah meleset: convertToPixel(timestamp) meny-snap ke bar utk tool BAR_ANCHOR,
  // sedang tool sub-bar beranchor dataIndex pecahan/presisi. Menyatukan jalur magnet ON/OFF.)
  let anchor=null;
  if(magnetOn){
    const xa=xAnchorFromPx(px);
    if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s) anchor={timestamp:s.timestamp, value:s.value}; }
  }
  if(!anchor){
    const o=chart.getOverlayById(inProgressId), name=o&&o.name;
    // name falsy (overlay tak ketemu) → jatuh ke cabang BAR_ANCHOR (perilaku lama): subBar(undefined)
    // sendiri bernilai true (bukan anggota BAR_ANCHOR), jadi name dicek eksplisit lebih dulu.
    if(name && subBar(name)){ const fa=fracAnchorFromPx(px); if(fa) anchor={dataIndex:fa.dataIndex, value:v}; }   // presisi sub-bar (fidx)
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

