// ===================== cursor mode (cross / dot / arrow / eraser) =====================
// Bukan overlay — mengubah crosshair global + membatalkan mode gambar aktif. Eraser: klik objek → hapus.
let cursorMode = localStorage.getItem('br_cursor') || 'cross';
let eraserOn = (cursorMode==='eraser');
function applyCursorStyle(name){
  try{
    if(name==='arrow') chart.setStyles({crosshair:{show:false}});
    else if(name==='dot') chart.setStyles({crosshair:{show:true, horizontal:{show:true, line:{show:false}}, vertical:{show:true, line:{show:false}}}});
    else chart.setStyles({crosshair:{show:true, horizontal:{show:true, line:{show:true}}, vertical:{show:true, line:{show:true}}}}); // cross & eraser
  }catch(_){}
}
function setCursorMode(name){
  try{ clearMeasure(); }catch(_){}   // ganti mode cursor → hasil ukur tak relevan (js/measure.js)
  cancelInProgressDraw();
  disarmIcons();
  eraserOn=(name==='eraser'); cursorMode=name; try{localStorage.setItem('br_cursor',name);}catch(_){}
  applyCursorStyle(name);
  document.body.classList.toggle('eraser-on', eraserOn);
}

// ===================== rail berkategori + flyout ala TradingView =====================
const _dt=$('#drawtools');
const _fly=document.createElement('div'); _fly.id='dtFlyout'; document.body.appendChild(_fly);
let _flyOpenKey=null;
function toolByName(n){ for(const g of DRAW_GROUPS){ const t=g.tools.find(x=>x.name===n); if(t) return t; } return null; }
function lastToolOf(g){ const saved=localStorage.getItem('br_lasttool_'+g.key); return (saved&&g.tools.find(t=>t.name===saved))||g.tools[0]; }
function closeFlyout(){ _fly.classList.remove('show'); _flyOpenKey=null; }
// ---- favorites: bintang di flyout → bar melayang di atas chart (Image #3, ala TradingView) ----
let favBar=null;                                                   // elemen bar; dibuat saat init rail
function groupOfTool(n){ for(const g of DRAW_GROUPS){ if(g.tools.some(t=>t.name===n)) return g; } return null; }
// Favorite disimpan sebagai "<groupKey>:<toolName>", bukan nama telanjang (Temuan 5 E2E).
// Sebabnya: `arrow` ada DUA KALI di DRAW_GROUPS — grup Cursor ("Arrow (no crosshair)", mode kursor)
// dan grup Shapes ("Arrow", overlay). Nama telanjang harus di-resolve lewat toolByName/groupOfTool
// yang "yang pertama menang" → selalu dapat varian CURSOR. Akibat terukurnya: mem-favorite shape
// Arrow menghasilkan tombol favorites bertooltip "Cursor: Arrow (no crosshair)" yang KLIKNYA
// mengubah mode kursor, bukan meng-arm shape — jadi shape Arrow praktis tak bisa difavoritkan.
// Kunci ber-grup membuat maksudnya eksplisit dan tahan terhadap tabrakan nama berikutnya.
const favKey=(g,t)=>g.key+':'+t.name;
/** Kunci favorite → {g,t}; null bila tool/grupnya sudah tak ada (mis. tool ditarik). */
function resolveFav(key){
  const i=String(key).indexOf(':');
  if(i<0){                                        // data lama (nama telanjang) → lihat migrasi di bawah
    const g=favGroupOf(key), t=g&&g.tools.find(x=>x.name===key); return (g&&t)?{g,t}:null; }
  const gk=key.slice(0,i), nm=key.slice(i+1);
  const g=DRAW_GROUPS.find(x=>x.key===gk), t=g&&g.tools.find(x=>x.name===nm);
  return (g&&t)?{g,t}:null;
}
// Grup yang bisa difavoritkan saja: bintang HANYA dirender untuk grup non-cursor (lihat openFlyout),
// jadi favorite tak pernah bisa berarti mode kursor. Itu sekaligus yang membuat migrasi data lama
// TAK ambigu: nama telanjang `arrow` yang tersimpan pasti berasal dari shape Arrow, satu-satunya
// Arrow yang punya bintang.
function favGroupOf(n){ for(const g of DRAW_GROUPS){ if(!g.cursor && g.tools.some(t=>t.name===n)) return g; } return null; }
let favTools=[]; try{ favTools=JSON.parse(localStorage.getItem('br_fav_tools')||'[]')||[]; }catch(_){ favTools=[]; }
(function migrateFavKeys(){                       // sekali jalan: nama telanjang → berkualifikasi grup
  let changed=false;
  favTools=favTools.map(k=>{ if(String(k).indexOf(':')>=0) return k;
    const r=resolveFav(k); if(!r) return k;       // tak terpetakan (tool ditarik) → dibuang di filter bawah
    changed=true; return favKey(r.g,r.t); }).filter(k=>resolveFav(k));
  if(changed){ try{localStorage.setItem('br_fav_tools',JSON.stringify(favTools));}catch(_){} }
})();
function isFav(g,t){ return favTools.includes(favKey(g,t)); }
function toggleFav(g,t){ const k=favKey(g,t), i=favTools.indexOf(k); if(i>=0) favTools.splice(i,1); else favTools.push(k);
  try{localStorage.setItem('br_fav_tools',JSON.stringify(favTools));}catch(_){} buildFavBar(); }
// ---- keyboard shortcut drawing ala TradingView (Alt+huruf; Mac ⌥) ----
const IS_MAC=/Mac|iPhone|iPad|iPod/.test((navigator.platform||'')+' '+(navigator.userAgent||''));
function scLabel(sc){ return (IS_MAC?'⌥':'Alt+')+sc; }              // label hint/tooltip
function catTitle(g,t){ return g.title+': '+t.title+(t.sc?' ('+scLabel(t.sc)+')':''); }
// map dari e.code (fisik, OS/layout-independent) → {g,t}
const SC_BY_CODE={}; DRAW_GROUPS.forEach(g=>g.tools.forEach(t=>{ if(t.sc) SC_BY_CODE['Key'+t.sc]={g,t}; }));
// instant=true → jalur SHORTCUT: H/V langsung drop di posisi cursor tanpa klik (lihat createDraw)
function activateShortcut(hit){ const catBtn=_dt.querySelector('.dt-cat[data-cat="'+hit.g.key+'"]'); if(catBtn) pickTool(hit.g, hit.t, catBtn, true); }
function pickTool(g, t, catBtn, instant){
  catBtn.dataset.tool=t.name; catBtn.title=catTitle(g,t);
  const _ico=catBtn.querySelector('.dt-ico'); if(_ico) _ico.innerHTML=t.svg; else catBtn.innerHTML=t.svg;
  if(g.cursor){ setCursorMode(t.name); catBtn.classList.add('armed'); }
  else { try{localStorage.setItem('br_lasttool_'+g.key,t.name);}catch(_){} createDraw(t.name, catBtn, null, instant); }
  closeFlyout();
}
function openFlyout(g, catBtn){
  _fly.innerHTML=''; _flyOpenKey=g.key;
  const cur=(g.cursor?cursorMode:lastToolOf(g).name);
  const ttl=document.createElement('div'); ttl.className='dt-fly-title'; ttl.textContent=g.title.toUpperCase(); _fly.appendChild(ttl);
  g.tools.forEach(t=>{ const it=document.createElement('div'); it.className='dt-item'+(t.name===cur?' active':'');
    it.innerHTML=t.svg+'<span class="dt-nm">'+t.title+'</span>'+(t.sc?'<span class="dt-sc">'+scLabel(t.sc)+'</span>':'');
    it.onclick=(ev)=>{ ev.stopPropagation(); pickTool(g, t, catBtn); };
    if(!g.cursor){                                                 // bintang favorite (overlay saja, bukan cursor)
      const star=document.createElement('span'); star.className='dt-fav'+(isFav(g,t)?' on':'');
      star.setAttribute('role','button'); star.setAttribute('aria-label','Favorite'); star.title='Toggle favorite';
      star.textContent=isFav(g,t)?'★':'☆';
      star.onclick=(ev)=>{ ev.stopPropagation(); toggleFav(g,t); const on=isFav(g,t); star.classList.toggle('on',on); star.textContent=on?'★':'☆'; };
      it.appendChild(star);
    }
    _fly.appendChild(it); });
  const r=(catBtn.closest('.dt-catrow')||catBtn).getBoundingClientRect(); _fly.classList.add('show');   // buka dari tepi kanan baris (lewat caret)
  let top=r.top; const fh=_fly.offsetHeight; if(top+fh>window.innerHeight-8) top=Math.max(8,window.innerHeight-8-fh);
  _fly.style.left=(r.right+6)+'px'; _fly.style.top=top+'px';
}
function buildDrawRail(){
  DRAW_GROUPS.forEach(g=>{
    const row=document.createElement('div'); row.className='dt-catrow';
    const cat=document.createElement('button'); cat.className='dtool dt-cat'; cat.dataset.cat=g.key;
    const init=g.cursor?(toolByName(cursorMode)||g.tools[0]):lastToolOf(g);
    cat.dataset.tool=init.name; cat.title=catTitle(g,init);
    cat.innerHTML='<span class="dt-ico">'+init.svg+'</span>';
    // klik badan ikon = arm langsung tool terakhir grup (1-klik ala TradingView)
    cat.onclick=(e)=>{ e.stopPropagation(); pickTool(g, g.cursor?(toolByName(cursorMode)||g.tools[0]):lastToolOf(g), cat); };
    // caret expand TERPISAH di kanan (muncul saat hover) = buka daftar tool
    const caret=document.createElement('span'); caret.className='dt-caret'; caret.setAttribute('aria-hidden','true'); caret.textContent='▸';
    caret.title='More '+g.title+' tools';
    caret.onclick=(e)=>{ e.stopPropagation(); if(_flyOpenKey===g.key){ closeFlyout(); return; } openFlyout(g, cat); };
    row.appendChild(cat); row.appendChild(caret);
    _dt.appendChild(row);
  });
  const cc=_dt.querySelector('.dt-cat[data-cat="cursor"]'); if(cc) cc.classList.add('armed');
}
buildDrawRail();
// ---- Favorites drawing bar: pill melayang di atas chart (anak .cpanel-pri, pola .replaypill) ----
const _cpri=document.querySelector('.cpanel-pri');
favBar=document.createElement('div'); favBar.className='favbar'; favBar.id='favBar';
favBar.setAttribute('role','toolbar'); favBar.setAttribute('aria-label','Favorite drawing tools');
if(_cpri) _cpri.appendChild(favBar);
function buildFavBar(){
  if(!favBar) return;
  favBar.innerHTML='<span class="favbar-grip" aria-hidden="true"></span>';
  favTools.forEach(key=>{ const r=resolveFav(key); if(!r) return;    // kunci ber-grup → tool yang BENAR (Temuan 5)
    const {g,t}=r;
    const b=document.createElement('button'); b.className='dtool favbar-btn'; b.title=catTitle(g,t); b.innerHTML=t.svg;
    b.onclick=(e)=>{ e.stopPropagation(); const catBtn=_dt.querySelector('.dt-cat[data-cat="'+g.key+'"]'); if(catBtn) pickTool(g,t,catBtn); };
    favBar.appendChild(b); });
  favBar.classList.toggle('show', favTools.some(k=>resolveFav(k)));   // tampil hanya bila ada favorite valid
}
// restore posisi tersimpan (relatif ke .cpanel-pri); default dock atas-tengah via CSS transform
(function(){ try{ const p=JSON.parse(localStorage.getItem('br_favBarPos')||'null');
  if(p&&typeof p.x==='number'&&typeof p.y==='number'){ favBar.style.transform='none'; favBar.style.left=p.x+'px'; favBar.style.top=p.y+'px'; }
}catch(_){} })();
// drag via grip — koordinat relatif container (favBar position:absolute di .cpanel-pri) + persist
(function(){ if(!_cpri) return; let drag=false,sx,sy,ox,oy;
  favBar.addEventListener('pointerdown',e=>{ if(!e.target.closest('.favbar-grip')) return;
    const pr=_cpri.getBoundingClientRect(), br=favBar.getBoundingClientRect();
    drag=true; sx=e.clientX; sy=e.clientY; ox=br.left-pr.left; oy=br.top-pr.top;
    favBar.style.transform='none'; favBar.style.left=ox+'px'; favBar.style.top=oy+'px';
    favBar.classList.add('dragging'); try{favBar.setPointerCapture(e.pointerId);}catch(_){} e.preventDefault();
  });
  favBar.addEventListener('pointermove',e=>{ if(!drag) return;
    const pr=_cpri.getBoundingClientRect();
    let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    nx=Math.max(0,Math.min(pr.width-favBar.offsetWidth,nx)); ny=Math.max(0,Math.min(pr.height-favBar.offsetHeight,ny));
    favBar.style.left=nx+'px'; favBar.style.top=ny+'px';
    try{localStorage.setItem('br_favBarPos',JSON.stringify({x:nx,y:ny}));}catch(_){}
  });
  const stop=e=>{ if(!drag) return; drag=false; favBar.classList.remove('dragging'); try{favBar.releasePointerCapture(e.pointerId);}catch(_){} };
  favBar.addEventListener('pointerup',stop); favBar.addEventListener('pointercancel',stop);
})();
buildFavBar();
// terapkan cursor tersimpan saat load (tanpa membatalkan gambar)
applyCursorStyle(cursorMode);
document.body.classList.toggle('eraser-on', cursorMode==='eraser');
window.addEventListener('click',()=>{ if(_flyOpenKey) closeFlyout(); });
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && _flyOpenKey) closeFlyout(); });
const _sp=document.createElement('div'); _sp.className='spacer'; _dt.appendChild(_sp);
// toggle Hide/Show SEMUA gambar (tanpa menghapus) — pakai properti `visible` overlay klinecharts
let drawsHidden=false;
const EYE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.8 4.6A11 11 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-3.2 4.1M6.5 6.5A18.3 18.3 0 0 0 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4.4-.9"/></svg>';
// ikon aksi bergaya sama (stroke currentColor, 24-grid) — dipakai tombol legend indikator & lainnya
const GEAR_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const XMARK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function applyDrawsVisibility(){ drawIds.forEach(id=>{ try{chart.overrideOverlay({id, visible:!drawsHidden});}catch(e){} }); }
const _hd=document.createElement('button'); _hd.id='hideDrawBtn'; _hd.className='dtool';
function syncHideDrawBtn(){ _hd.innerHTML=drawsHidden?EYEOFF_SVG:EYE_SVG; _hd.title=drawsHidden?'Show all drawings':'Hide all drawings'; _hd.classList.toggle('armed',drawsHidden); }
syncHideDrawBtn();
_hd.onclick=()=>{ drawsHidden=!drawsHidden; applyDrawsVisibility(); syncHideDrawBtn(); };
const _tr=document.createElement('button'); _tr.className='dtool'; _tr.title='Remove drawings / indicators'; _tr.innerHTML=TRASH_SVG;
// klik trash → menu flyout ala TradingView (buka ke kanan tombol). stopPropagation supaya
// tak langsung ditutup oleh listener window-click yg menyembunyikan ctxMenu.
_tr.onclick=(e)=>{ e.stopPropagation(); const r=_tr.getBoundingClientRect(); openRemoveMenu(r.right+6, r.top); };
// toggle Magnet (snap ke nilai OHLC candle terdekat) — ala TradingView
const MAGNET_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 4 H4 v7 a8 8 0 0 0 16 0 V4 h-3 v7 a5 5 0 0 1-10 0 Z"/></svg>';
const _mag=document.createElement('button'); _mag.id='magBtn'; _mag.className='dtool'; _mag.title='Magnet: snap point to nearest candle OHLC (on/off)'; _mag.innerHTML=MAGNET_SVG;
if(magnetOn) _mag.classList.add('armed');
_mag.onclick=()=>{ magnetOn=!magnetOn; localStorage.setItem('br_magnet', magnetOn?'1':''); _mag.classList.toggle('armed', magnetOn); if(!magnetOn) try{hideMagDot();}catch(_){}
  // toggle saat sedang menggambar → sinkronkan mode overlay in-progress supaya garis preview langsung ikut/lepas snap
  if(inProgressId) try{chart.overrideOverlay({id:inProgressId, mode: magnetOn?'strong_magnet':'normal'});}catch(_){} };
// toggle Keep drawing ("Stay in Drawing Mode" ala TradingView) — tool tetap aktif setelah objek jadi.
// Ikon pensil + gembok, seperti TV. Tanpa hotkey: TV pun tak punya, dan Ctrl/⌘ di TV justru milik
// magnet sementara (jangan dirampas).
const KEEPDRAW_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 21l1.2-3.6L12 9.6l2.4 2.4L6.6 19.8z"/><path d="M17 4.5V3.6a1.9 1.9 0 0 1 3.8 0v.9"/><rect x="16" y="4.5" width="5.8" height="5" rx="1"/></svg>';
const _kd=document.createElement('button'); _kd.id='keepDrawBtn'; _kd.className='dtool';
_kd.title='Stay in drawing mode: keep the tool active after each drawing (on/off)';
_kd.setAttribute('aria-label','Stay in drawing mode');
_kd.innerHTML=KEEPDRAW_SVG;
if(keepDrawOn) _kd.classList.add('armed');
_kd.onclick=()=>{ keepDrawOn=!keepDrawOn;
  try{ localStorage.setItem('br_keepdraw', keepDrawOn?'1':''); }catch(_){}
  _kd.classList.toggle('armed', keepDrawOn); };
// urutan tombol bawah (atas→bawah): magnet, keep-drawing, hide, trash — urutan TV
_dt.appendChild(_mag); _dt.appendChild(_kd); _dt.appendChild(_hd); _dt.appendChild(_tr);

// Catatan: undangan "+ Add text" MENYATU di canvas — placeholder muted di dalam rect/trendline
// saat kosong & di-hover/pilih (lihat showAddTextHint + createPointFigures). Untuk rect, label
// dan hit-area-nya juga digerbang oleh ukuran kotak (ADDTEXT_MIN_W/ADDTEXT_MIN_H, index.html:847):
// kotak yang lebih kecil dari itu dibiarkan bersih — labelnya mati BERSAMA hit-area-nya, tak
// pernah salah satu saja (lihat docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md).
// Klik pada area placeholder → editor teks INLINE (openOverlayTextEditor), BUKAN modal (lihat
// onClick overlay). Modal Style/Text hanya via double-click / klik-kanan (onDoubleClick / contextmenu).

