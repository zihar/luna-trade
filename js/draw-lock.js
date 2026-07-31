// ===================== Lock objek gambar (per objek & semua) =====================
// Kunci BUKAN state paralel: ia properti `lock` milik overlay klinecharts, diubah lewat
// chart.overrideOverlay dan ikut tersimpan di br_draws_<INSTRUMENT>. Di klinecharts 9.8.10 `lock`
// men-short-circuit dispatch pressed-move (hook onPressedMoving Luna tak dipanggil sama sekali),
// tapi TIDAK menggerbang klik/hover/select — jadi modal Style tetap bisa dibuka, dan itulah jalan
// untuk membuka kuncinya. Proteksi hapus harus kita buat sendiri (lihat blockedByLock).
// Rancangan: docs/superpowers/specs/2026-07-31-lock-drawings-design.md

function isLocked(id){ try{ const o=chart.getOverlayById(id); return !!(o&&o.lock); }catch(_){ return false; } }
// Isyarat visual: objek terkunci tak menampilkan buletan handle → afordansi "bisa digenggam" hilang
// sesuai kenyataannya. setStyles klinecharts me-MERGE, jadi ini tak menyentuh gaya garis objeknya.
function applyLockVisual(id,on){ try{ chart.overrideOverlay({id, styles:{point: on?HIDDEN_POINT:OVERLAY_POINT}}); }catch(_){} }
function setDrawLock(id,on){
  if(id==null) return;
  try{ chart.overrideOverlay({id, lock:!!on}); }catch(_){}
  applyLockVisual(id,!!on);
  try{ scheduleSaveDraws(); }catch(_){}      // kunci ikut snapshot → bisa di-undo spt perubahan gaya
  try{ syncLockAllBtn(); }catch(_){}
}
function toggleDrawLock(id){ setDrawLock(id, !isLocked(id)); }
function lockedDrawCount(){ return drawIds.filter(isLocked).length; }
function setLockAllDrawings(on){
  drawIds.slice().forEach(id=>{ try{ chart.overrideOverlay({id, lock:!!on}); }catch(_){} applyLockVisual(id,!!on); });
  try{ scheduleSaveDraws(); }catch(_){}
  try{ syncLockAllBtn(); }catch(_){}
}
// Aksi pengguna "buang semua gambar". SENGAJA terpisah dari clearDrawings(): yang itu dipakai
// applyDrawsSnapshot (undo, js/draw-undo.js) & loadChart (ganti instrumen) dan HARUS tanpa syarat —
// kalau ia menghormati lock, undo menghasilkan objek dobel dan ganti instrumen menyeret gambar lama.
function removeAllDrawings(){
  const keep=lockedDrawCount();
  drawIds.slice().forEach(id=>{ if(isLocked(id)) return; try{ chart.removeOverlay(id); }catch(_){} });
  selectedId=hoverId=null;
  try{ syncLockAllBtn(); }catch(_){}
  if(keep) try{ toast(keep+' locked drawing'+(keep===1?'':'s')+' kept','info'); }catch(_){}
}
// Gerbang untuk jalur hapus per objek (Delete, eraser). true = dihentikan.
function blockedByLock(id){
  if(id==null || !isLocked(id)) return false;
  try{ toast('Drawing is locked — unlock it first','warn'); }catch(_){}
  return true;
}
