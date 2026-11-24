// ===================== Multi-select objek gambar (Ctrl/⌘+klik) — ala TradingView =====================
// klinecharts 9.8.10 hanya punya SATU seleksi (OverlayStore._clickInstanceInfo = `selectedId`).
// Multi-select dibangun di atasnya: `multiSel` = himpunan id terpilih, dan objek PRIMER tetap
// seleksi klinecharts (yang handle-nya digambar klinecharts sendiri). Anggota lain diberi handle
// tiruan di kanvas #msLayer.
//
// Perilaku (meniru TV):
//  - Ctrl/⌘+klik objek = tambah ke / lepas dari seleksi. Klik biasa = pilih objek itu saja.
//  - Seret BADAN salah satu anggota = semua anggota (yang tak terkunci) ikut bergeser dgn delta
//    bar/harga yang sama. Seret HANDLE titik = hanya objek itu yang diubah.
//  - Delete = hapus semua anggota tak terkunci. Esc / klik area kosong = lepas semua.
//  - Object Tree: Ctrl/⌘+klik baris = tambah/lepas, Shift+klik = rentang.
//
// Urutan event klinecharts yang dijadikan pegangan (cek tests/fixtures/klinecharts-9.8.10.min.js):
// mousedown → onPressedMoveStart; mouseup TANPA gerak → setClickInstanceInfo → onClick, lalu
// (bila id berubah) onDeselected(lama) + onSelected(baru). Seret membatalkan klik → seleksi tak
// berubah, jadi menyeret anggota mempertahankan himpunan. Karena onClick sudah menimpa
// selectedId sebelum onDeselected, seleksi SEBELUM klik dicatat sendiri di mousedown (fase capture).
//
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian PR2)
let multiSel=new Set();
let _msDown=null;        // {mod, prev} — dicatat mousedown capture di #chart
let _msClick=null;       // id objek yang diklik (dari hook onClick), menunggu rekonsiliasi
let _msTimer=0, _msGuard=false;
let msDrag=null;         // {x, y, others:[{id, pts}]} selama seret badan bersama
let _msAnchor=null;      // jangkar Shift+klik di Object Tree
// long/shortPosition punya jalur pressed-move sendiri (panel posisi + handle SL/TP) dan titiknya
// terikat bar — tak ikut digeser bersama.
const MS_NO_GROUP_DRAG={longPosition:1, shortPosition:1};

$('#chart').addEventListener('mousedown',(e)=>{
  _msDown={mod:!!(e.ctrlKey||e.metaKey), prev:selectedId};
},{capture:true});

function msModClick(){ return !!(_msDown && _msDown.mod); }
function msIsSel(id){ return id!=null && (id===selectedId || multiSel.has(id)); }
function msCount(){ return multiSel.size; }

// Dipanggil hook onClick (js/draw-tools.js) untuk SETIAP klik objek, termasuk klik ulang objek
// yang sudah primer (yang tak memicu onSelected).
function msOnClick(id){ _msClick=id; msSchedule(); }
// Dipanggil onSelected/onDeselected. Seleksi programatik milik modul ini dijaga _msGuard.
function msOnSelChange(){ if(!_msGuard) msSchedule(); }
// Ditunda satu tick: satu klik memicu onClick + onDeselected + onSelected berurutan, dan baru
// setelah ketiganya selesai keadaannya utuh.
function msSchedule(){ if(_msTimer) return; _msTimer=setTimeout(msReconcile,0); }

function msLive(id){ return drawIds.includes(id) && !isDrawHidden(id); }
function msReconcile(){
  _msTimer=0;
  const c=_msClick; _msClick=null;
  if(c!=null && drawIds.includes(c)){
    if(msModClick()){
      // Objek bergrup (js/draw-groups.js) masuk/keluar seleksi SEBAGAI SATU grup.
      const set=new Set([...multiSel].filter(msLive));
      const prev=_msDown && _msDown.prev;
      if(!set.size && prev!=null && prev!==c && msLive(prev)) grpExpand(prev).forEach(x=>set.add(x));
      const unit=grpExpand(c), had=set.has(c);
      unit.forEach(x=>{ if(had) set.delete(x); else set.add(x); });
      multiSel=set;
      msSetPrimary(set.has(c) ? c : ([...set].pop() ?? null));
    } else {
      multiSel=new Set(grpExpand(c));   // klik anggota grup = seluruh grup
    }
  } else if(selectedId==null){
    multiSel.clear();
  } else if(multiSel.size<2 || !multiSel.has(selectedId)){
    multiSel=new Set(grpExpand(selectedId));
  }
  msRender();
}
// Ganti objek primer tanpa memicu rekonsiliasi lagi.
function msSetPrimary(id){
  _msGuard=true;
  try{ if(id==null) deselectOverlay(); else if(selectedId!==id) selectPastedOverlay(id); }
  finally{ _msGuard=false; }
}
function msSelectOnly(id){ multiSel=new Set(id!=null?[id]:[]); msSetPrimary(id); msRender(); }
function msClear(){ multiSel.clear(); msRender(); }
// Objek dihapus / disembunyikan → keluar dari himpunan.
function msForget(id){ if(multiSel.delete(id)) msRender(); }

// Object Tree: Ctrl/⌘+klik = tambah/lepas, Shift+klik = rentang dari jangkar (urutan baris).
function msTreeToggle(id){
  const set=new Set([...multiSel].filter(msLive));
  if(!set.size && selectedId!=null && msLive(selectedId)) set.add(selectedId);
  if(set.has(id)) set.delete(id); else set.add(id);
  multiSel=set; _msAnchor=id;
  msSetPrimary(set.has(id) ? id : ([...set].pop() ?? null));
  msRender();
}
function msTreeRange(id, order){
  const a=order.indexOf(_msAnchor), b=order.indexOf(id);
  if(a<0 || b<0){ msSelectOnly(id); _msAnchor=id; return; }
  const [lo,hi]=a<b?[a,b]:[b,a];
  multiSel=new Set(order.slice(lo,hi+1).filter(msLive));
  msSetPrimary(multiSel.has(id) ? id : ([...multiSel].pop() ?? null));
  msRender();
}

// Delete untuk seleksi ganda. Objek terkunci dibiarkan (sama dgn removeAllDrawings).
function msDeleteSelected(){
  const ids=[...multiSel].filter(id=>drawIds.includes(id));
  const locked=ids.filter(isLocked);
  ids.forEach(id=>{ if(!isLocked(id)) try{ chart.removeOverlay(id); }catch(_){} });
  multiSel=new Set(locked);
  if(locked.length) try{ toast(locked.length+' locked drawing'+(locked.length===1?'':'s')+' kept','info'); }catch(_){}
  msSetPrimary(locked.length ? locked[locked.length-1] : null);
  msRender();
}

// ---- seret bersama ----
// Dipanggil onPressedMoveStart. Saat cloneArmed, `others` tetap dihitung: Ctrl/⌘+seret seleksi ganda
// menyalin SEMUA anggota (cloneSet, js/draw-clone.js) dan aslinya ikut bergeser bersama.
function msDragStart(o, e){
  msDrag=null;
  if(!o || MS_NO_GROUP_DRAG[o.name]) return;
  if((e.figureKey||'').indexOf('overlay_figure_point_')===0) return;   // handle titik = edit satu objek
  // Seleksi ganda yang memuat objek ini; bila tidak, grupnya (js/draw-groups.js) — menyeret anggota
  // grup yang belum terpilih tetap membawa seluruh grup, spt TV.
  const set=(multiSel.size>=2 && multiSel.has(o.id)) ? multiSel : new Set(grpExpand(o.id));
  if(set.size<2 || !set.has(o.id)) return;
  const others=[];
  set.forEach(id=>{ if(id===o.id) return;
    const m=chart.getOverlayById(id);
    if(!m || m.lock || MS_NO_GROUP_DRAG[m.name] || !m.points) return;
    others.push({id, pts:m.points.map(p=>Object.assign({},p))}); });
  if(others.length) msDrag={x:e.x, y:e.y, others};
}
// Delta dihitung dari kursor dgn rumus yang sama dgn translasi badan di onPressedMoving
// (bar dibulatkan ke pusat candle, harga bebas) → semua anggota bergeser persis sejajar.
function msDragMove(e){
  if(!msDrag || !e) return;
  const sx=barAnchorFromPx(msDrag.x), xa=barAnchorFromPx(e.x), sv=pxToValue(msDrag.y), v=pxToValue(e.y);
  if(!sx || !xa || sv==null || v==null) return;
  const dIdx=xa.dataIndex-sx.dataIndex, dV=v-sv;
  msDrag.others.forEach(m=>{
    const pts=m.pts.map(sp=>{ if(!sp) return sp;
      const bi=(sp.dataIndex!=null)?sp.dataIndex:fidxOf(sp);
      return {dataIndex:Math.round(bi+dIdx), value:sp.value!=null ? sp.value+dV : sp.value}; });
    try{ chart.overrideOverlay({id:m.id, points:pts}); }catch(_){}
  });
}
function msDragEnd(){ msDrag=null; }

// ---- handle tiruan untuk anggota non-primer ----
const msLayer=document.createElement('canvas');
msLayer.id='msLayer'; msLayer.className='ms-layer';
$('#chart').appendChild(msLayer);
let _msRaf=0;
function msRender(){
  try{ objTreeDirty(); }catch(_){}
  try{ grpSyncBtn(); }catch(_){}
  if(multiSel.size<2){ if(_msRaf){ cancelAnimationFrame(_msRaf); _msRaf=0; } msLayer.style.display='none'; return; }
  msLayer.style.display='block';
  if(!_msRaf) _msRaf=requestAnimationFrame(msPaint);
}
// Digambar ulang tiap frame selama seleksi ganda hidup: chart bisa di-scroll/zoom/seret kapan saja,
// dan himpunannya kecil (maks puluhan objek) jadi biayanya remeh.
function msPaint(){
  _msRaf=0;
  if(multiSel.size<2) return;
  const host=$('#chart'), w=host.clientWidth, h=host.clientHeight, dpr=window.devicePixelRatio||1;
  if(msLayer.width!==Math.round(w*dpr) || msLayer.height!==Math.round(h*dpr)){
    msLayer.width=Math.round(w*dpr); msLayer.height=Math.round(h*dpr);
    msLayer.style.width=w+'px'; msLayer.style.height=h+'px';
  }
  const g=msLayer.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  const P=OVERLAY_POINT;
  multiSel.forEach(id=>{ if(id===selectedId) return;
    const o=chart.getOverlayById(id); if(!o || !o.visible || !o.points) return;
    o.points.forEach(p=>{ const c=anchorPx(p); if(!c) return;
      g.beginPath(); g.arc(c.x, c.y, P.radius, 0, Math.PI*2);
      g.fillStyle=P.color; g.fill();
      g.lineWidth=P.borderSize; g.strokeStyle=P.borderColor; g.stroke(); });
  });
  _msRaf=requestAnimationFrame(msPaint);
}
