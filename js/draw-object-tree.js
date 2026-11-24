// ===================== Object Tree (daftar objek gambar) — ala TradingView =====================
// Panel kanan berisi semua objek gambar instrumen aktif: klik baris = pilih objeknya di chart,
// lalu per baris tombol Lock / Hide / Delete (muncul saat hover; Lock & Hide tetap tampak bila
// aktif, sama spt TV). Urutan = paling baru di ATAS, mengikuti TV yang mendaftar dari objek teratas.
//
// Hide PER OBJEK disimpan di `objHidden[id]` dan ikut payload (field `hidden:1`, lihat
// js/draw-persist.js). Ia BERBEDA dari "Hide all drawings" di rail (drawsHidden) yang sengaja
// sementara (tak tersimpan). Visibilitas akhir = keduanya: lihat drawVisible().
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md
let objHidden={};
function isDrawHidden(id){ return !!objHidden[id]; }
function drawVisible(id){ return !drawsHidden && !objHidden[id]; }
function setDrawHidden(id,on){
  if(id==null) return;
  if(on) objHidden[id]=true; else delete objHidden[id];
  try{ chart.overrideOverlay({id, visible:drawVisible(id)}); }catch(_){}
  // objek yang disembunyikan tak boleh tetap terpilih: Delete berikutnya akan menghapus sesuatu
  // yang tak tampak di layar.
  if(on && selectedId===id) try{ deselectOverlay(); }catch(_){}
  if(on) try{ msForget(id); }catch(_){}
  if(on && hoverId===id) hoverId=null;
  try{ scheduleSaveDraws(); }catch(_){}
  objTreeDirty();
}

// Nama tampilan: judul tool dari katalog rail; teks objek (text/callout/label) ditempelkan
// supaya dua "Text" bisa dibedakan.
function drawToolTitle(name){
  for(const g of DRAW_GROUPS) for(const t of g.tools) if(t.name===name && !g.cursor) return t.title;
  return name;
}
function drawToolSvg(name){
  for(const g of DRAW_GROUPS) for(const t of g.tools) if(t.name===name && !g.cursor) return t.svg;
  return '';
}
function drawLabel(o){
  const base=drawToolTitle(o.name);
  const t=(typeof o.extendData==='string') ? o.extendData.trim() : '';
  return t ? base+': '+(t.length>28 ? t.slice(0,28)+'…' : t) : base;
}

const OT_LOCK_OPEN_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9.5" rx="1.6"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.3-1.4"/></svg>';
let _otTimer=0;
// Dipanggil dari banyak jalur (buat/hapus/kunci/simpan/seleksi) → digabung per frame.
function objTreeDirty(){
  if(_otTimer) return;
  _otTimer=requestAnimationFrame(()=>{ _otTimer=0; renderObjTree(); });
}
function objTreeOpen(){ const p=$('#objTreePane'); return !!(p && p.classList.contains('open')); }
function renderObjTree(){
  const list=$('#objTreeList'); if(!list || !objTreeOpen()) return;
  const ids=drawIds.filter(id=>{ try{ const o=chart.getOverlayById(id); return o && o.name!=='measure' && id!==inProgressId; }catch(_){ return false; } });
  $('#objTreeCount').textContent=ids.length ? String(ids.length) : '';
  if(!ids.length){ list.innerHTML='<div class="ot-empty">No drawings on this chart yet.</div>'; return; }
  const frag=document.createDocumentFragment();
  ids.slice().reverse().forEach(id=>{
    const o=chart.getOverlayById(id); if(!o) return;
    const locked=!!o.lock, hidden=isDrawHidden(id);
    const row=document.createElement('div');
    const sel=msIsSel(id);
    row.className='ot-row'+(sel?' sel':'')+(hidden?' is-hidden':'')+(locked?' is-locked':'');
    row.dataset.id=id; row.setAttribute('role','option'); row.setAttribute('aria-selected', sel?'true':'false');
    row.innerHTML='<span class="ot-ico">'+drawToolSvg(o.name)+'</span><span class="ot-name"></span>'+
      '<button class="ot-btn ot-lock'+(locked?' on':'')+'" title="'+(locked?'Unlock':'Lock')+'" aria-label="'+(locked?'Unlock':'Lock')+'">'+(locked?LOCK_SVG:OT_LOCK_OPEN_SVG)+'</button>'+
      '<button class="ot-btn ot-eye'+(hidden?' on':'')+'" title="'+(hidden?'Show':'Hide')+'" aria-label="'+(hidden?'Show':'Hide')+'">'+(hidden?EYEOFF_SVG:EYE_SVG)+'</button>'+
      '<button class="ot-btn ot-del" title="Remove" aria-label="Remove">'+TRASH_SVG+'</button>';
    row.querySelector('.ot-name').textContent=drawLabel(o);
    frag.appendChild(row);
  });
  list.replaceChildren(frag);
}
// Satu listener terdelegasi untuk semua baris (daftar dirender ulang utuh).
$('#objTreeList').addEventListener('click',(e)=>{
  const row=e.target.closest('.ot-row'); if(!row) return;
  const id=row.dataset.id;
  if(e.target.closest('.ot-lock')){ toggleDrawLock(id); objTreeDirty(); return; }
  if(e.target.closest('.ot-eye')){ setDrawHidden(id, !isDrawHidden(id)); return; }
  if(e.target.closest('.ot-del')){ if(blockedByLock(id)) return; try{ chart.removeOverlay(id); }catch(_){} objTreeDirty(); return; }
  // klik baris = pilih objek di chart. Objek tersembunyi dimunculkan dulu (TV melakukan hal sama
  // — memilih objek yang tak tampak tak ada gunanya).
  if(isDrawHidden(id)) setDrawHidden(id,false);
  if(drawsHidden){ drawsHidden=false; applyDrawsVisibility(); syncHideDrawBtn(); }
  // Ctrl/⌘+klik = tambah/lepas, Shift+klik = rentang menurut urutan baris (js/draw-multi-select.js)
  if(e.ctrlKey||e.metaKey){ msTreeToggle(id); return; }
  if(e.shiftKey){ msTreeRange(id, [...e.currentTarget.querySelectorAll('.ot-row')].map(r=>r.dataset.id)); return; }
  try{ msSelectOnly(id); _msAnchor=id; }catch(_){}
  objTreeDirty();
});

// ---- buka/tutup panel (pola sama dgn panel Alerts; keduanya menempati slot kanan yang sama,
// jadi membuka satu menutup yang lain, spt widget panel kanan TV) ----
function setObjTreePane(open){
  const p=$('#objTreePane'), b=$('#railObjTree');
  p.classList.toggle('open', open);
  b.classList.toggle('on', open);
  b.setAttribute('aria-pressed', open?'true':'false');
  try{ localStorage.setItem('br_objTreePane', open?'1':'0'); }catch(_){}
  if(open){ try{ setAlertsPane(false); }catch(_){} renderObjTree(); }
}
$('#railObjTree').onclick=()=>setObjTreePane(!objTreeOpen());
$('#objTreeClose').onclick=()=>setObjTreePane(false);
try{ if(localStorage.getItem('br_objTreePane')==='1') setObjTreePane(true); }catch(_){}
