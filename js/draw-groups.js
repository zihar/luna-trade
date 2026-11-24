// ===================== Grup objek gambar — ala TradingView =====================
// Beberapa objek dijadikan satu grup → diperlakukan sbg satu kesatuan:
//  - Klik salah satu anggota di chart = SELURUH grup terpilih (multiSel, js/draw-multi-select.js),
//    jadi seret badannya menggeser semua anggota & Delete menghapus semuanya. Seret objek anggota
//    yang BELUM terpilih pun membawa seluruh grup (lihat msDragStart).
//  - Seret HANDLE titik tetap mengubah objek itu saja (sama spt seleksi ganda biasa).
//  - Object Tree: grup tampil sbg baris folder yang bisa dilipat, dgn Lock / Hide / Remove /
//    Ungroup untuk seluruh anggota; klik dua kali namanya = ganti nama. Klik baris ANGGOTA di tree
//    memilih objek itu saja (jalan untuk mengedit satu anggota, sama spt TV).
//  - Grup BERSARANG spt TV: mengelompokkan seleksi yang memuat satu grup UTUH menjadikan grup itu
//    sub-grup dari grup baru. Klik anggota di chart memilih grup TERLUAR; tombol per folder di tree
//    (Lock/Hide/Remove/seleksi/hitungan) berlaku ke SELURUH isinya, termasuk sub-grup.
//
// Keanggotaan disimpan PER OBJEK di payload (`grp` = id grup terdalam, `gname` = nama, `gpar` =
// rantai leluhurnya [[gid,nama],…] dari luar ke dalam; absen = grup tingkat atas), lihat
// js/draw-persist.js. Id overlay klinecharts berganti tiap restore/undo, tapi id grup ikut payload
// jadi grup utuh melewati reload, undo, dan sync antarperangkat tanpa tabel terpisah.
// Rancangan: docs/superpowers/specs/2026-11-24-object-tree-design.md (bagian PR3)
let objGroup={};            // id overlay → id grup TERDALAM yang memuatnya langsung
let grpName={};             // id grup → nama tampilan (sekaligus daftar grup yang hidup)
let grpParent={};           // id grup → id grup induk (absen = tingkat atas)
let grpCollapsed=new Set(); // id grup yang dilipat di Object Tree (sesi saja, spt TV)
let _grpEditing=false;      // input ganti nama sedang terbuka → tahan render ulang tree

function grpOf(id){ return (id!=null && objGroup[id]) || null; }
// Rantai grup dari LUAR ke DALAM untuk sebuah grup (termasuk dirinya). Penjaga siklus: data rusak
// dari payload tak boleh membuat loop tak berujung.
function grpChain(gid){
  const a=[], seen=new Set();
  for(let g=gid; g && !seen.has(g); g=grpParent[g]||null){ seen.add(g); a.unshift(g); }
  return a;
}
function grpPath(id){ return grpChain(grpOf(id)); }          // grup yang memuat objek, luar → dalam
function grpTopOf(id){ const p=grpPath(id); return p.length ? p[0] : null; }
function grpHas(gid,id){ return !!gid && grpPath(id).includes(gid); }
// SELURUH objek di dalam grup, termasuk lewat sub-grup.
function grpMembers(gid){ return gid ? drawIds.filter(id=>grpHas(gid,id)) : []; }
// Grup kosong (anggotanya terhapus/pindah semua) dibuang; sub-grup yang induknya hilang naik ke atas.
function grpPrune(){
  Object.keys(grpName).forEach(g=>{ if(!grpMembers(g).length){ delete grpName[g]; delete grpParent[g]; grpCollapsed.delete(g); } });
  Object.keys(grpParent).forEach(g=>{ if(!grpName[grpParent[g]]) delete grpParent[g]; });
}
// Urutan baris tree untuk `order` (depan → belakang): entri {gid, depth, members} untuk folder dan
// {id, depth} untuk objek. Folder menempati posisi isinya yang paling depan; isinya menyusul di
// bawahnya. Dipakai renderObjTree DAN drag & drop (js/draw-zorder.js) supaya keduanya sepakat.
function grpWalk(order){
  const out=[], path=new Map(order.map(id=>[id,grpPath(id)]));
  const rec=(ids, L, depth)=>{
    const done=new Set();
    ids.forEach(id=>{
      const p=path.get(id), k=L ? p.indexOf(L)+1 : 0;
      if(k>=p.length){ out.push({id, depth}); return; }
      const g=p[k]; if(done.has(g)) return; done.add(g);
      const sub=ids.filter(x=>path.get(x)[k]===g);
      out.push({gid:g, depth, members:sub});
      rec(sub, g, depth+1);
    });
  };
  rec(order, null, 0);
  return out;
}
// Himpunan yang dipilih bila `id` diklik di chart: seluruh isi grup TERLUAR-nya yang tampak, atau id itu sendiri.
function grpExpand(id){
  const g=grpTopOf(id); if(!g) return [id];
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

// Seleksi → "unit" yang akan dikelompokkan: grup TERLUAR yang seluruh isinya terpilih (jadi sub-grup),
// selain itu objeknya sendiri (keluar dari grup lamanya, spt TV).
function grpUnits(ids){
  ids=(ids||[...multiSel]).filter(id=>drawIds.includes(id));
  const set=new Set(ids), units=[], seen=new Set();
  ids.forEach(id=>{
    const g=grpPath(id).find(x=>grpMembers(x).every(m=>set.has(m)));
    const u=g ? {gid:g} : {id};
    const k=g ? 'g:'+g : 'o:'+id;
    if(!seen.has(k)){ seen.add(k); units.push(u); }
  });
  return units;
}
function grpCanCreate(ids){ return grpUnits(ids).length>=2; }
// Seleksi → satu grup baru. Mengembalikan id grup, atau null bila tak memenuhi syarat.
function grpCreate(ids){
  const units=grpUnits(ids);
  if(units.length<2) return null;
  const gid=grpNewId();
  // induk bersama semua unit (mis. semua di dalam "Group 1") → grup baru jadi sub-grupnya
  const par=units.map(u=>u.gid ? (grpParent[u.gid]||null) : grpOf(u.id));
  const common=par.every(p=>p===par[0]) ? par[0] : null;
  units.forEach(u=>{ if(u.gid) grpParent[u.gid]=gid; else objGroup[u.id]=gid; });
  grpName[gid]=grpNextName();
  if(common) grpParent[gid]=common;
  grpPrune();
  try{ track('draw_group'); }catch(_){}
  grpChanged();
  return gid;
}
// Bubarkan satu tingkat: isi langsungnya (objek & sub-grup) naik ke induk grup itu.
function grpUngroup(gid){
  if(!gid || !grpName[gid]) return;
  const p=grpParent[gid]||null;
  drawIds.forEach(id=>{ if(objGroup[id]===gid){ if(p) objGroup[id]=p; else delete objGroup[id]; } });
  Object.keys(grpParent).forEach(g=>{ if(grpParent[g]===gid){ if(p) grpParent[g]=p; else delete grpParent[g]; } });
  delete grpName[gid]; delete grpParent[gid]; grpCollapsed.delete(gid);
  grpChanged();
}
// Grup TERLUAR yang tersentuh seleksi saat ini (untuk "Ungroup" di menu klik kanan).
function grpSelectedGroups(){
  const s=new Set(); multiSel.forEach(id=>{ const g=grpTopOf(id); if(g) s.add(g); });
  if(selectedId!=null){ const g=grpTopOf(selectedId); if(g) s.add(g); }
  return [...s];
}
// Dipanggil onRemoved (js/draw-tools.js). Grup tanpa anggota tersisa ikut hilang.
function grpForget(id){
  if(!objGroup[id]) return;
  delete objGroup[id];
  grpPrune();
}
// Pemulihan dari payload (js/draw-persist.js buildDrawsFromArray).
function grpRestore(id, d){
  if(typeof d.grp!=='string' || !d.grp) return;
  objGroup[id]=d.grp;
  const chain=(Array.isArray(d.gpar) ? d.gpar : []).filter(x=>Array.isArray(x) && typeof x[0]==='string' && x[0])
    .concat([[d.grp, d.gname]]);
  chain.forEach(([g,name],i)=>{
    if(typeof name==='string' && name) grpName[g]=name;
    else if(!grpName[g]) grpName[g]=grpNextName();
    if(i>0 && g!==chain[i-1][0]) grpParent[g]=chain[i-1][0];
  });
}
function grpSerialize(id){
  const p=grpPath(id); if(!p.length) return {};
  const g=p[p.length-1], out={grp:g, gname:grpName[g]||''};
  if(p.length>1) out.gpar=p.slice(0,-1).map(x=>[x, grpName[x]||'']);
  return out;
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
  const n=[...multiSel].filter(id=>drawIds.includes(id)).length, ok=n>=2 && grpCanCreate();
  b.disabled = !ok;
  b.title = n<2 ? 'Select 2 or more drawings to group them' : ok ? 'Group '+n+' selected drawings' : 'Already one group';
}
$('#objTreeGroup').onclick=()=>{ const g=grpCreate(); if(g) grpCollapsed.delete(g); };

// Ganti nama inline (klik dua kali nama grup). Enter/blur = simpan, Esc = batal.
function grpStartRename(row){
  const gid=row.dataset.gid, span=row.querySelector('.ot-name'); if(!gid || !span) return;
  _grpEditing=true;
  const inp=document.createElement('input');
  inp.className='ot-rename'; inp.value=grpName[gid]||''; inp.setAttribute('aria-label','Group name'); inp.maxLength=60;
  span.replaceWith(inp); inp.focus(); inp.select();
  let done=false;
  const end=(save)=>{ if(done) return; done=true; _grpEditing=false;
    if(save) grpRename(gid, inp.value); renderObjTree(); };
  inp.addEventListener('keydown',ev=>{ ev.stopPropagation();
    if(ev.key==='Enter'){ ev.preventDefault(); end(true); } else if(ev.key==='Escape'){ ev.preventDefault(); end(false); } });
  inp.addEventListener('blur',()=>end(true));
  inp.addEventListener('click',ev=>ev.stopPropagation());
  inp.addEventListener('mousedown',ev=>ev.stopPropagation());
}
$('#objTreeList').addEventListener('dblclick',(e)=>{
  const row=e.target.closest('.ot-group'); if(!row || !e.target.closest('.ot-name')) return;
  grpStartRename(row);
});
