// ===================== Object Tree (daftar objek gambar) — ala TradingView =====================
// Panel kanan berisi semua objek gambar instrumen aktif: klik baris = pilih objeknya di chart,
// lalu per baris tombol Lock / Hide / Delete (muncul saat hover; Lock & Hide tetap tampak bila
// aktif, sama spt TV). Urutan = paling baru di ATAS, mengikuti TV yang mendaftar dari objek teratas.
//
// Hide PER OBJEK disimpan di `objHidden[id]` dan ikut payload (field `hidden:1`, lihat
// js/draw-persist.js). Ia BERBEDA dari "Hide all drawings" di rail (drawsHidden) yang sengaja
// sementara (tak tersimpan). Visibilitas akhir = keduanya: lihat drawVisible().
// Grup (js/draw-groups.js) dirender di sini sbg baris folder; logikanya di modul itu.
// Kolom Search di atas daftar menyaring baris (label objek / nama grup), lihat otMatches().
// Di bawah daftar: "Other symbols" = instrumen lain yang punya objek (lihat fetchObjOther).
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md
let objHidden={};
let _otDrag=null;   // {kind:'obj', id} | {kind:'grp', gid} selama baris diseret (js/draw-zorder.js)
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
// Nama pilihan pengguna per objek (klik dua kali nama di Object Tree, spt TV). Ikut payload
// (field `oname`, js/draw-persist.js); absen = nama otomatis di bawah.
let objName={};
function setDrawName(id,name){
  if(id==null || !drawIds.includes(id)) return;
  name=(name||'').trim().slice(0,60);
  if(name) objName[id]=name; else delete objName[id];   // kosong = kembali ke nama otomatis
  try{ scheduleSaveDraws(); }catch(_){}
  objTreeDirty();
}
function drawLabel(o){
  if(objName[o.id]) return objName[o.id];
  const base=drawToolTitle(o.name);
  const t=objText(o).trim();
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
function otObjRow(id, depth){
  const o=chart.getOverlayById(id); if(!o) return null;
  const locked=!!o.lock, hidden=isDrawHidden(id);
  const row=document.createElement('div');
  const sel=msIsSel(id);
  row.className='ot-row'+(depth?' ot-child':'')+(sel?' sel':'')+(hidden?' is-hidden':'')+(locked?' is-locked':'');
  row.dataset.id=id; row.draggable=true; if(depth) row.style.setProperty('--d', depth); row.setAttribute('role','option'); row.setAttribute('aria-selected', sel?'true':'false');
  row.innerHTML='<span class="ot-ico">'+drawToolSvg(o.name)+'</span><span class="ot-name" title="Double-click to rename"></span>'+otBtns(locked,hidden,'');
  row.querySelector('.ot-name').textContent=drawLabel(o);
  return row;
}
function otBtns(locked,hidden,extra){
  return extra+
    '<button class="ot-btn ot-lock'+(locked?' on':'')+'" title="'+(locked?'Unlock':'Lock')+'" aria-label="'+(locked?'Unlock':'Lock')+'">'+(locked?LOCK_SVG:OT_LOCK_OPEN_SVG)+'</button>'+
    '<button class="ot-btn ot-eye'+(hidden?' on':'')+'" title="'+(hidden?'Show':'Hide')+'" aria-label="'+(hidden?'Show':'Hide')+'">'+(hidden?EYEOFF_SVG:EYE_SVG)+'</button>'+
    '<button class="ot-btn ot-del" title="Remove" aria-label="Remove">'+TRASH_SVG+'</button>';
}
const OT_FOLDER_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
const OT_UNGROUP_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="8" height="8" rx="1.4"/><rect x="12.5" y="12.5" width="8" height="8" rx="1.4"/><path d="M15 8.5h2.5V11M9 15.5H6.5V13" stroke-dasharray="2 1.6"/></svg>';
const OT_CARET_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>';
// Baris folder grup (js/draw-groups.js): status Lock/Hide = "semua anggota".
function otGroupRow(gid, members, depth){
  const locked=grpAllLocked(gid), hidden=grpAllHidden(gid), open=!grpCollapsed.has(gid);
  const live=members.filter(id=>!isDrawHidden(id));
  const sel=live.length>0 && live.every(msIsSel);
  const row=document.createElement('div');
  row.className='ot-row ot-group'+(open?' open':'')+(sel?' sel':'')+(hidden?' is-hidden':'')+(locked?' is-locked':'');
  row.dataset.gid=gid; row.draggable=true; if(depth) row.style.setProperty('--d', depth); row.setAttribute('role','option'); row.setAttribute('aria-selected', sel?'true':'false');
  row.setAttribute('aria-expanded', open?'true':'false');
  row.innerHTML='<button class="ot-caret" title="'+(open?'Collapse':'Expand')+'" aria-label="'+(open?'Collapse':'Expand')+'">'+OT_CARET_SVG+'</button>'+
    '<span class="ot-ico">'+OT_FOLDER_SVG+'</span><span class="ot-name" title="Double-click to rename"></span><span class="ot-gcount">'+members.length+'</span>'+
    otBtns(locked,hidden,'<button class="ot-btn ot-ungroup" title="Ungroup" aria-label="Ungroup">'+OT_UNGROUP_SVG+'</button>');
  row.querySelector('.ot-name').textContent=grpName[gid]||'Group';
  return row;
}
function renderObjTree(){
  const list=$('#objTreeList'); if(!list || !objTreeOpen()) return;
  try{ grpSyncBtn(); }catch(_){}
  if(_otOther.inst!==inst) fetchObjOther(); else renderObjOther();
  if(_grpEditing) return;   // input ganti nama grup sedang terbuka (js/draw-groups.js)
  if(_otDrag) return;       // baris sedang diseret: render ulang akan membuang elemen sumber seret
  const ids=drawIds.filter(id=>{ try{ const o=chart.getOverlayById(id); return o && o.name!=='measure' && id!==inProgressId; }catch(_){ return false; } });
  $('#objTreeCount').textContent=ids.length ? String(ids.length) : '';
  if(!ids.length){ list.innerHTML='<div class="ot-empty">No drawings on this chart yet.</div>'; return; }
  // Pencarian: objek yang labelnya ATAU nama salah satu grup di jalurnya memuat kata kunci. Folder
  // induknya ikut tampil sbg konteks dan dipaksa terbuka (tak ada gunanya cocok tapi terlipat).
  const q=otQuery();
  const shown=q ? ids.filter(id=>otMatches(id,q)) : ids;
  if(!shown.length){ list.innerHTML='<div class="ot-empty">No matching drawings.</div>'; return; }
  const frag=document.createDocumentFragment();
  // Paling depan (z-order, js/draw-zorder.js) di atas. Folder menempati posisi isinya yang paling
  // depan; isinya (objek & sub-grup) menjorok di bawahnya. Isi folder yang dilipat dilewati.
  let fold=Infinity;
  grpWalk(shown.slice().reverse()).forEach(e=>{
    if(e.depth>fold) return;
    fold=Infinity;
    if(e.gid){ frag.appendChild(otGroupRow(e.gid, e.members, e.depth)); if(!q && grpCollapsed.has(e.gid)) fold=e.depth; return; }
    const r=otObjRow(e.id, e.depth); if(r) frag.appendChild(r);
  });
  list.replaceChildren(frag);
}
function otQuery(){ const i=$('#objTreeSearch'); return i ? i.value.trim().toLowerCase() : ''; }
function otMatches(id,q){
  try{ const o=chart.getOverlayById(id); if(o && drawLabel(o).toLowerCase().includes(q)) return true; }catch(_){}
  return grpPath(id).some(g=>(grpName[g]||'').toLowerCase().includes(q));
}
{
  const inp=$('#objTreeSearch');
  inp.addEventListener('input', ()=>renderObjTree());
  // Escape mengosongkan dulu; baru bila sudah kosong ia dilepas (fokus kembali ke chart).
  inp.addEventListener('keydown',(e)=>{
    if(e.key!=='Escape') return;
    e.stopPropagation();
    if(inp.value){ inp.value=''; renderObjTree(); } else inp.blur();
  });
}
// ---- "Other symbols": instrumen lain yang punya objek gambar (GET /api/drawings/summary). Klik =
// buka chart simbol itu. Diambil saat panel dibuka & saat instrumen berganti — jumlah objek simbol
// LAIN tak berubah selama kita di chart ini, jadi tak perlu diperbarui tiap simpan. Gagal / anonim
// → bagiannya disembunyikan saja (fitur tambahan, bukan jalur penting).
let _otOther={inst:null, rows:[]}, _otOtherSeq=0;
async function fetchObjOther(){
  const my=++_otOtherSeq, at=inst;
  _otOther={inst:at, rows:_otOther.rows};
  try{
    const r=await fetch('/api/drawings/summary'); if(!r.ok) throw 0;
    const j=await r.json();
    if(my!==_otOtherSeq) return;   // respons basi (instrumen sudah berganti lagi)
    _otOther={inst:at, rows:Array.isArray(j && j.instruments) ? j.instruments : []};
  }catch(_){ if(my===_otOtherSeq) _otOther={inst:at, rows:[]}; }
  renderObjOther();
}
function renderObjOther(){
  const box=$('#objTreeOther'); if(!box) return;
  const q=otQuery();
  const rows=_otOther.rows.filter(x=>x && x.instrument && x.instrument!==inst && x.count>0 &&
    (!q || (dispSym(x.instrument)+' '+x.instrument).toLowerCase().includes(q)));
  if(!rows.length){ box.replaceChildren(); return; }
  const frag=document.createDocumentFragment();
  const h=document.createElement('div'); h.className='ot-oh'; h.textContent='Other symbols'; frag.appendChild(h);
  rows.forEach(x=>{
    const b=document.createElement('button');
    b.className='ot-sym'; b.dataset.sym=x.instrument; b.title='Open '+dispSym(x.instrument)+' chart';
    b.innerHTML='<span class="ot-name"></span><span class="ot-gcount"></span>';
    b.querySelector('.ot-name').textContent=dispSym(x.instrument);
    b.querySelector('.ot-gcount').textContent=String(x.count);
    frag.appendChild(b);
  });
  box.replaceChildren(frag);
}
$('#objTreeOther').addEventListener('click',(e)=>{
  const b=e.target.closest('.ot-sym'); if(!b) return;
  try{ track('objtree_open_symbol'); }catch(_){}
  selectSymbol(b.dataset.sym);
});

// Satu listener terdelegasi untuk semua baris (daftar dirender ulang utuh).
$('#objTreeList').addEventListener('click',(e)=>{
  const row=e.target.closest('.ot-row'); if(!row) return;
  const gid=row.dataset.gid;
  if(gid){
    if(e.target.closest('.ot-caret')){ if(grpCollapsed.has(gid)) grpCollapsed.delete(gid); else grpCollapsed.add(gid); renderObjTree(); return; }
    if(e.target.closest('.ot-ungroup')){ grpUngroup(gid); return; }
    if(e.target.closest('.ot-lock')){ grpSetLock(gid, !grpAllLocked(gid)); return; }
    if(e.target.closest('.ot-eye')){ grpSetHidden(gid, !grpAllHidden(gid)); return; }
    if(e.target.closest('.ot-del')){ grpDelete(gid); return; }
    if(e.target.closest('.ot-rename')) return;
    grpSelect(gid, e.ctrlKey||e.metaKey); return;
  }
  const id=row.dataset.id;
  if(e.target.closest('.ot-lock')){ toggleDrawLock(id); objTreeDirty(); return; }
  if(e.target.closest('.ot-eye')){ setDrawHidden(id, !isDrawHidden(id)); return; }
  if(e.target.closest('.ot-del')){ if(blockedByLock(id)) return; try{ chart.removeOverlay(id); }catch(_){} objTreeDirty(); return; }
  // klik baris = pilih objek di chart. Objek tersembunyi dimunculkan dulu (TV melakukan hal sama
  // — memilih objek yang tak tampak tak ada gunanya).
  if(isDrawHidden(id)) setDrawHidden(id,false);
  if(drawsHidden){ drawsHidden=false; applyDrawsVisibility(); syncHideDrawBtn(); }
  // Ctrl/⌘+klik = tambah/lepas, Shift+klik = rentang menurut urutan baris (js/draw-multi-select.js).
  // Baris anggota grup memilih objek itu SAJA (jalan untuk mengedit satu anggota, spt TV).
  if(e.ctrlKey||e.metaKey){ msTreeToggle(id); return; }
  if(e.shiftKey){ msTreeRange(id, [...e.currentTarget.querySelectorAll('.ot-row[data-id]')].map(r=>r.dataset.id)); return; }
  try{ msSelectOnly(id); _msAnchor=id; }catch(_){}
  objTreeDirty();
});

// Ganti nama inline (grup & objek): span .ot-name diganti input. Enter/blur = simpan, Esc = batal.
// _grpEditing menahan render ulang tree selama input terbuka (render akan membuang input-nya).
function otInlineRename(span, value, label, onSave){
  _grpEditing=true;
  const inp=document.createElement('input');
  inp.className='ot-rename'; inp.value=value||''; inp.setAttribute('aria-label',label); inp.maxLength=60;
  span.replaceWith(inp); inp.focus(); inp.select();
  let done=false;
  const end=(save)=>{ if(done) return; done=true; _grpEditing=false;
    if(save) onSave(inp.value); renderObjTree(); };
  inp.addEventListener('keydown',ev=>{ ev.stopPropagation();
    if(ev.key==='Enter'){ ev.preventDefault(); end(true); } else if(ev.key==='Escape'){ ev.preventDefault(); end(false); } });
  inp.addEventListener('blur',()=>end(true));
  inp.addEventListener('click',ev=>ev.stopPropagation());
  inp.addEventListener('mousedown',ev=>ev.stopPropagation());
}
$('#objTreeList').addEventListener('dblclick',(e)=>{
  const span=e.target.closest('.ot-name'), row=e.target.closest('.ot-row[data-id]');
  if(!span || !row) return;
  const id=row.dataset.id, o=chart.getOverlayById(id); if(!o) return;
  otInlineRename(span, drawLabel(o), 'Drawing name', (v)=>setDrawName(id, v));
});

// ---- buka/tutup panel (pola sama dgn panel Alerts; keduanya menempati slot kanan yang sama,
// jadi membuka satu menutup yang lain, spt widget panel kanan TV) ----
function setObjTreePane(open){
  const p=$('#objTreePane'), b=$('#railObjTree');
  p.classList.toggle('open', open);
  b.classList.toggle('on', open);
  b.setAttribute('aria-pressed', open?'true':'false');
  try{ localStorage.setItem('br_objTreePane', open?'1':'0'); }catch(_){}
  if(open){ try{ setAlertsPane(false); }catch(_){} _otOther.inst=null; renderObjTree(); }   // inst=null → ambil ulang Other symbols
}
$('#railObjTree').onclick=()=>setObjTreePane(!objTreeOpen());
$('#objTreeClose').onclick=()=>setObjTreePane(false);
try{ if(localStorage.getItem('br_objTreePane')==='1') setObjTreePane(true); }catch(_){}
