// ===================== Urutan tumpukan (z-order) + drag & drop Object Tree — ala TradingView =====================
// Urutan tumpukan objek gambar = urutan `drawIds` (indeks 0 = paling BELAKANG). Object Tree
// menampilkannya terbalik (paling depan di atas), jadi menyeret baris di tree = mengubah urutan
// tumpukan di chart, persis spt TV. Payload disimpan dalam urutan drawIds (js/draw-persist.js) dan
// restore membuat overlay dalam urutan itu → urutan ikut reload, undo, dan sync tanpa field baru.
//
// klinecharts 9.8.10: overlay diurutkan stabil menurut `zLevel`, lalu urutan dibuat. Dua jebakan:
//  (1) HOVER menyetel zLevel objek ke Number.MAX_SAFE_INTEGER dan TAK PERNAH mengembalikannya →
//      objek yang pernah disorot pindah ke depan selamanya. onMouseEnter (js/draw-tools.js)
//      memanggil zApply() supaya nilai itu langsung ditimpa kembali.
//  (2) Objek baru lahir dgn zLevel 0. Karena itu zApply memberi NEGATIF (i - n): objek yang baru
//      dibuat (termasuk yang masih digambar) otomatis berada di depan tanpa perlu zApply dulu.
//
// Drag & drop baris (HTML5 DnD) di #objTreeList:
//  - seret baris objek ke separuh atas/bawah baris lain = sisipkan di atas/bawahnya; ikut menjadi
//    anggota grup baris itu (anggota grup) atau keluar dari grup (baris tingkat atas);
//  - seret ke TENGAH baris folder grup = masuk grup itu (paling atas); ke bawah folder yang terbuka
//    = juga masuk; seperempat bawah anggota TERAKHIR = keluar ke bawah grup;
//  - seret baris folder = pindahkan seluruh grup sbg satu blok (grup tak bisa bersarang, lihat
//    backlog item 5).
// Status seret `_otDrag` dideklarasikan di js/draw-object-tree.js (renderObjTree menahan diri selama seret).

function zApply(){
  const n=drawIds.length;
  drawIds.forEach((id,i)=>{
    try{ const o=chart.getOverlayById(id), z=i-n; if(o && o.zLevel!==z) chart.overrideOverlay({id, zLevel:z}); }catch(_){}
  });
}

// Urutan baris tree (atas → bawah), termasuk anggota grup yang terlipat — sama dgn renderObjTree.
function otVisualOrder(ids){
  const order=ids.slice().reverse(), out=[], done=new Set();
  order.forEach(id=>{
    const g=grpOf(id);
    if(!g){ out.push(id); return; }
    if(done.has(g)) return; done.add(g);
    order.forEach(x=>{ if(grpOf(x)===g) out.push(x); });
  });
  return out;
}
function otTreeIds(){
  return drawIds.filter(id=>{ try{ const o=chart.getOverlayById(id); return o && o.name!=='measure' && id!==inProgressId; }catch(_){ return false; } });
}

// Posisi jatuh relatif baris di bawah pointer: before | after | into (folder) | out (keluar grup).
function otSlot(row, y){
  const r=row.getBoundingClientRect(), f=(y-r.top)/Math.max(1,r.height);
  const gid=row.dataset.gid;
  if(_otDrag.kind==='grp'){
    // blok grup hanya bisa jatuh di tingkat atas: baris anggota dipetakan ke blok grupnya
    const g=gid || grpOf(row.dataset.id);
    if(!g) return {row, pos:f<.5?'before':'after'};
    return {row, pos:f<.5?'gbefore':'gafter', gid:g};
  }
  if(gid){
    if(f<.25) return {row, pos:'gbefore', gid};
    if(f>.75 && grpCollapsed.has(gid)) return {row, pos:'gafter', gid};
    return {row, pos:'into', gid};
  }
  const g=grpOf(row.dataset.id);
  if(g && f>.75){
    const vis=[...row.parentNode.querySelectorAll('.ot-row[data-id]')].filter(x=>grpOf(x.dataset.id)===g);
    if(vis[vis.length-1]===row) return {row, pos:'gafter', gid:g};
  }
  return {row, pos:f<.5?'before':'after'};
}
// Slot → indeks sisip di urutan visual TANPA yang diseret + grup tujuan (null = tingkat atas).
function otResolve(slot, rest){
  const span=(g)=>{ let a=-1,b=-1; rest.forEach((id,i)=>{ if(grpOf(id)===g){ if(a<0) a=i; b=i; } }); return [a,b]; };
  if(slot.gid && slot.pos!=='before' && slot.pos!=='after'){
    const [a,b]=span(slot.gid); if(a<0) return null;   // grup yang diseret dijatuhkan ke dirinya sendiri
    if(slot.pos==='gbefore') return {at:a, grp:null};
    if(slot.pos==='gafter')  return {at:b+1, grp:null};
    return {at:a, grp:slot.gid};                         // into
  }
  const id=slot.row.dataset.id, i=rest.indexOf(id); if(i<0) return null;
  return {at:slot.pos==='before'?i:i+1, grp:grpOf(id)};
}

// Terapkan perpindahan. Mengembalikan true bila sesuatu berubah.
function otMove(drag, slot){
  const tree=otTreeIds(), vis=otVisualOrder(tree);
  const moving=drag.kind==='grp' ? vis.filter(id=>grpOf(id)===drag.gid) : [drag.id];
  if(!moving.length || !moving.every(id=>vis.includes(id))) return false;
  const rest=vis.filter(id=>!moving.includes(id));
  const t=otResolve(slot, rest); if(!t) return false;
  const nv=rest.slice(0,t.at).concat(moving, rest.slice(t.at));
  const others=drawIds.filter(id=>!tree.includes(id));   // measure / objek yang masih digambar: tetap di depan
  const next=nv.slice().reverse().concat(others);
  let changed=next.some((id,i)=>drawIds[i]!==id);
  if(drag.kind==='obj'){
    const id=drag.id, old=grpOf(id);
    if(old!==t.grp){
      changed=true;
      if(t.grp) objGroup[id]=t.grp; else delete objGroup[id];
      if(old && !grpMembers(old).length){ delete grpName[old]; grpCollapsed.delete(old); }
    }
  }
  if(!changed) return false;
  drawIds=next;
  zApply();
  try{ track('draw_reorder'); }catch(_){}
  grpChanged();
  return true;
}

function otClearDropMarks(list){
  list.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(x=>x.classList.remove('drop-before','drop-after','drop-into'));
}
function otMarkDrop(list, slot){
  otClearDropMarks(list);
  let el=slot.row, cls;
  if(slot.pos==='into') cls='drop-into';
  else if(slot.pos==='before') cls='drop-before';
  else if(slot.pos==='after') cls='drop-after';
  else {
    // batas blok grup: garis di atas folder / di bawah baris terakhir grup
    const rows=[...list.querySelectorAll('.ot-row')].filter(x=>x.dataset.gid===slot.gid || grpOf(x.dataset.id)===slot.gid);
    el=slot.pos==='gbefore' ? rows[0] : rows[rows.length-1];
    cls=slot.pos==='gbefore' ? 'drop-before' : 'drop-after';
  }
  if(el) el.classList.add(cls);
}

{
  const list=$('#objTreeList');
  let slot=null;
  const end=()=>{ _otDrag=null; slot=null; otClearDropMarks(list); list.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging')); };
  list.addEventListener('dragstart',(e)=>{
    const row=e.target.closest && e.target.closest('.ot-row');
    if(!row || e.target.closest('.ot-rename,.ot-btn,.ot-caret')){ e.preventDefault(); return; }
    _otDrag=row.dataset.gid ? {kind:'grp', gid:row.dataset.gid} : {kind:'obj', id:row.dataset.id};
    row.classList.add('dragging');
    try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', ''); }catch(_){}
  });
  list.addEventListener('dragover',(e)=>{
    if(!_otDrag) return;
    const row=e.target.closest && e.target.closest('.ot-row');
    if(!row){ slot=null; otClearDropMarks(list); return; }
    e.preventDefault();
    try{ e.dataTransfer.dropEffect='move'; }catch(_){}
    slot=otSlot(row, e.clientY);
    otMarkDrop(list, slot);
  });
  list.addEventListener('drop',(e)=>{
    if(!_otDrag) return;
    e.preventDefault();
    const d=_otDrag, s=slot;
    end();
    if(s) otMove(d, s);
    renderObjTree();
  });
  list.addEventListener('dragend', ()=>{ if(_otDrag){ end(); renderObjTree(); } });
}
