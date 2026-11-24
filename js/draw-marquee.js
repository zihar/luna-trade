// ===================== Kotak seleksi (marquee): Ctrl/⌘ + seret area kosong — ala TradingView =====================
// TV: "Hold Ctrl (Windows/Linux) or ⌘ (Mac) … drag the mouse cursor … to select the area that contains
// objects." Di klinecharts, seret area kosong = pan chart, jadi gestur ini butuh modifier.
//
// Keputusan (dokumen TV tak merinci; ini pilihan kita):
//  - Hanya mulai di AREA KOSONG plot candle (bukan di atas objek: Ctrl/⌘+seret badan = clone,
//    js/draw-clone.js; bukan saat sedang menggambar: Ctrl = magnet sementara, js/magnet-temp.js;
//    bukan di sumbu harga/waktu).
//  - Objek kena bila SALAH SATU titik jangkarnya di dalam kotak. Anggota grup ikut seluruhnya
//    (grpExpand), objek tersembunyi & `measure` dilewati.
//  - Hasil DITAMBAHKAN ke seleksi yang ada (konsisten dgn Ctrl/⌘+klik). Ctrl/⌘+klik tanpa seret
//    di area kosong = tak terjadi apa-apa.
//
// Mekanisme: mousedown fase CAPTURE di #chart → stopPropagation, jadi klinecharts tak pernah melihat
// mousedown-nya (tak pan, tak memasang listener mouseup/mousemove root miliknya). Gerak & lepas
// dilacak di window.
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian follow-up 1)
let _mq=null;            // {x0, y0, x1, y1, moved} container-relative selama seret
const MQ_MIN=4;          // px — di bawah ini dianggap klik, bukan seret
const mqBox=document.createElement('div');
mqBox.id='mqBox'; mqBox.className='mq-box';
$('#chart').appendChild(mqBox);

// Batas area plot candle (container-relative); null = tak diketahui → izinkan seluruh #chart.
function mqPlotRect(){
  try{ const s=chart.getSize('candle_pane','main'); if(s && s.width) return {left:s.left||0, top:s.top||0, right:(s.left||0)+s.width, bottom:(s.top||0)+s.height}; }catch(_){}
  return null;
}
function mqDraw(){
  const l=Math.min(_mq.x0,_mq.x1), t=Math.min(_mq.y0,_mq.y1);
  Object.assign(mqBox.style,{display:'block', left:l+'px', top:t+'px',
    width:Math.abs(_mq.x1-_mq.x0)+'px', height:Math.abs(_mq.y1-_mq.y0)+'px'});
}
// Id objek yang titik jangkarnya ada di dalam kotak (container-relative).
function mqHits(l,t,r,b){
  const out=[];
  drawIds.forEach(id=>{
    if(!msLive(id) || id===inProgressId) return;
    const o=chart.getOverlayById(id); if(!o || o.name==='measure' || !o.points) return;
    if(o.points.some(p=>{ const a=anchorPx(p); return a && a.x>=l && a.x<=r && a.y>=t && a.y<=b; })) out.push(id);
  });
  return out;
}
function mqSelect(ids){
  if(!ids.length) return;
  const set=new Set([...multiSel].filter(msLive));
  if(!set.size && selectedId!=null && msLive(selectedId)) grpExpand(selectedId).forEach(x=>set.add(x));
  ids.forEach(id=>grpExpand(id).forEach(x=>set.add(x)));
  multiSel=set;
  const last=ids[ids.length-1];
  msSetPrimary(set.has(selectedId) ? selectedId : last);
  msRender();
}

$('#chart').addEventListener('mousedown',(e)=>{
  if(e.button!==0 || !(e.ctrlKey||e.metaKey) || hoverId || inProgressId) return;
  const r=$('#chart').getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
  const p=mqPlotRect();
  if(p && (x<p.left || x>p.right || y<p.top || y>p.bottom)) return;
  e.stopPropagation(); e.preventDefault();
  _mq={x0:x, y0:y, x1:x, y1:y, moved:false, r};
},{capture:true});
addEventListener('mousemove',(e)=>{
  if(!_mq) return;
  _mq.x1=e.clientX-_mq.r.left; _mq.y1=e.clientY-_mq.r.top;
  if(!_mq.moved && Math.hypot(_mq.x1-_mq.x0,_mq.y1-_mq.y0)>=MQ_MIN) _mq.moved=true;
  if(_mq.moved) mqDraw();
},{capture:true});
addEventListener('mouseup',(e)=>{
  if(!_mq || e.button!==0) return;
  const m=_mq; _mq=null; mqBox.style.display='none';
  if(!m.moved) return;
  mqSelect(mqHits(Math.min(m.x0,m.x1), Math.min(m.y0,m.y1), Math.max(m.x0,m.x1), Math.max(m.y0,m.y1)));
},{capture:true});
// Jendela kehilangan fokus di tengah seret (Cmd+Tab) → batalkan tanpa memilih.
addEventListener('blur',()=>{ if(_mq){ _mq=null; mqBox.style.display='none'; } });
