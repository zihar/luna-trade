// ===================== Grup objek gambar — ala TradingView =====================
// Beberapa objek dijadikan satu grup → diperlakukan sbg satu kesatuan:
//  - Klik salah satu anggota di chart = SELURUH grup terpilih (multiSel, js/draw-multi-select.js),
//    jadi seret badannya menggeser semua anggota & Delete menghapus semuanya. Seret objek anggota
//    yang BELUM terpilih pun membawa seluruh grup (lihat msDragStart).
//  - Seret HANDLE titik tetap mengubah objek itu saja (sama spt seleksi ganda biasa).
//  - Object Tree: grup tampil sbg baris folder yang bisa dilipat, dgn Lock / Hide / Remove /
//    Ungroup untuk seluruh anggota; klik dua kali namanya = ganti nama. Klik baris ANGGOTA di tree
//    memilih objek itu saja (jalan untuk mengedit satu anggota, sama spt TV).
//  - Grup datar: objek hanya milik satu grup. Mengelompokkan objek yang sudah bergrup memindahkannya
//    ke grup baru (grup bertingkat TV sengaja tak ditiru, lihat spec).
//
// Keanggotaan disimpan PER OBJEK di payload (`grp` = id grup, `gname` = nama), lihat
// js/draw-persist.js. Id overlay klinecharts berganti tiap restore/undo, tapi id grup ikut payload
// jadi grup utuh melewati reload, undo, dan sync antarperangkat tanpa tabel terpisah.
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian PR3)
let objGroup={};            // id overlay → id grup
let grpName={};             // id grup → nama tampilan
let grpCollapsed=new Set(); // id grup yang dilipat di Object Tree (sesi saja, spt TV)
let _grpEditing=false;      // input ganti nama sedang terbuka → tahan render ulang tree

function grpOf(id){ return (id!=null && objGroup[id]) || null; }
function grpMembers(gid){ return gid ? drawIds.filter(id=>objGroup[id]===gid) : []; }
// Himpunan yang dipilih bila `id` diklik di chart: seluruh anggota grupnya yang tampak, atau id itu sendiri.
function grpExpand(id){
  const g=grpOf(id); if(!g) return [id];
  const m=grpMembers(g).filter(x=>x===id || !isDrawHidden(x));
  return m.length ? m : [id];
}
function grpNewId(){ return 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function grpNextName(){
  let n=0;
  Object.values(grpName).forEach(s=>{ const m=/^Group (\d+)$/.exec(s||''); if(m) n=Math.max(n,+m[1]); });
  return 'Group '+(n+1);
}
function grpChanged(){ try{ scheduleSaveDraws(); }catch(_){} try{ objTreeDirty(); }catch(_){} }

// Objek terpilih (≥2) → satu grup baru. Mengembalikan id grup, atau null bila tak memenuhi syarat.
function grpCreate(ids){
  ids=(ids||[...multiSel]).filter(id=>drawIds.includes(id));
  if(ids.length<2) return null;
  const gid=grpNewId();
  const olds=new Set(ids.map(grpOf).filter(Boolean));
  ids.forEach(id=>{ objGroup[id]=gid; });
  olds.forEach(g=>{ if(!grpMembers(g).length) delete grpName[g]; });
  grpName[gid]=grpNextName();
  try{ track('draw_group'); }catch(_){}
  grpChanged();
  return gid;
}
function grpUngroup(gid){
  if(!gid) return;
  grpMembers(gid).forEach(id=>{ delete objGroup[id]; });
  delete grpName[gid]; grpCollapsed.delete(gid);
  grpChanged();
}
// Grup yang tersentuh seleksi saat ini (untuk "Ungroup" di menu klik kanan).
function grpSelectedGroups(){
  const s=new Set(); multiSel.forEach(id=>{ const g=grpOf(id); if(g) s.add(g); });
  if(selectedId!=null){ const g=grpOf(selectedId); if(g) s.add(g); }
  return [...s];
}
// Dipanggil onRemoved (js/draw-tools.js). Grup tanpa anggota tersisa ikut hilang.
function grpForget(id){
  const g=objGroup[id]; if(!g) return;
  delete objGroup[id];
  if(!grpMembers(g).length){ delete grpName[g]; grpCollapsed.delete(g); }
}
// Pemulihan dari payload (js/draw-persist.js buildDrawsFromArray).
function grpRestore(id, d){
  if(typeof d.grp!=='string' || !d.grp) return;
  objGroup[id]=d.grp;
  if(typeof d.gname==='string' && d.gname) grpName[d.grp]=d.gname;
  else if(!grpName[d.grp]) grpName[d.grp]=grpNextName();
}
function grpSerialize(id){
  const g=objGroup[id]; return g ? {grp:g, gname:grpName[g]||''} : {};
}

// ---- aksi per grup (Object Tree) ----
function grpAllLocked(gid){ const m=grpMembers(gid); return m.length>0 && m.every(isLocked); }
function grpAllHidden(gid){ const m=grpMembers(gid); return m.length>0 && m.every(isDrawHidden); }
function grpSetLock(gid,on){ grpMembers(gid).forEach(id=>setDrawLock(id,on)); objTreeDirty(); }
function grpSetHidden(gid,on){ grpMembers(gid).forEach(id=>setDrawHidden(id,on)); objTreeDirty(); }
function grpDelete(gid){
  const m=grpMembers(gid), locked=m.filter(isLocked);
  m.forEach(id=>{ if(!isLocked(id)) try{ chart.removeOverlay(id); }catch(_){} });
  if(locked.length) try{ toast(locked.length+' locked drawing'+(locked.length===1?'':'s')+' kept','info'); }catch(_){}
  objTreeDirty();
}
function grpRename(gid,name){
  name=(name||'').trim(); if(!gid || !name || !grpMembers(gid).length) return;
  grpName[gid]=name.slice(0,60); grpChanged();
}
// Klik baris grup = pilih seluruh anggota; Ctrl/⌘ = tambah ke / lepas dari seleksi yang ada.
function grpSelect(gid, mod){
  const m=grpMembers(gid); if(!m.length) return;
  if(drawsHidden){ drawsHidden=false; applyDrawsVisibility(); syncHideDrawBtn(); }
  if(grpAllHidden(gid)) m.forEach(id=>setDrawHidden(id,false));   // spt baris objek: memilih yg tak tampak tak berguna
  const live=m.filter(id=>!isDrawHidden(id));
  let set;
  if(mod){
    set=new Set([...multiSel].filter(msLive));
    if(!set.size && selectedId!=null && msLive(selectedId)) set.add(selectedId);
    const all=live.every(id=>set.has(id));
    live.forEach(id=>{ if(all) set.delete(id); else set.add(id); });
  } else set=new Set(live);
  multiSel=set;
  const prim=live.filter(id=>set.has(id)).pop() ?? ([...set].pop() ?? null);
  msSetPrimary(prim); _msAnchor=prim;
  msRender();
}

// ---- tombol Group di header Object Tree ----
function grpSyncBtn(){
  const b=$('#objTreeGroup'); if(!b) return;
  const n=[...multiSel].filter(id=>drawIds.includes(id)).length;
  b.disabled = n<2;
  b.title = n<2 ? 'Select 2 or more drawings to group them' : 'Group '+n+' selected drawings';
}
$('#objTreeGroup').onclick=()=>{ const g=grpCreate(); if(g) grpCollapsed.delete(g); };

// Ganti nama inline (klik dua kali nama grup) — mekanismenya otInlineRename (js/draw-object-tree.js).
function grpStartRename(row){
  const gid=row.dataset.gid, span=row.querySelector('.ot-name'); if(!gid || !span) return;
  otInlineRename(span, grpName[gid]||'', 'Group name', (v)=>grpRename(gid, v));
}
$('#objTreeList').addEventListener('dblclick',(e)=>{
  const row=e.target.closest('.ot-group'); if(!row || !e.target.closest('.ot-name')) return;
  grpStartRename(row);
});
