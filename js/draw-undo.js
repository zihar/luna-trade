// ===================== undo / redo objek gambar (snapshot-based, per-instrumen) =====================
// Tiap perubahan gambar meng-commit satu snapshot (JSON serializeDraws) lewat saveDraws.
// Debounce saveDraws (350ms) membuat satu drag = satu langkah undo. suppressDrawSave menahan
// perekaman saat apply snapshot, jadi undo/redo tak mencemari history-nya sendiri.
let drawUndo=[], drawRedo=[], drawSnap=null;
const DRAW_HISTORY_MAX=60;
function recordDrawHistory(json){
  if(json===drawSnap) return;                    // tak ada perubahan efektif
  if(drawSnap!=null){ drawUndo.push(drawSnap); if(drawUndo.length>DRAW_HISTORY_MAX) drawUndo.shift(); }
  drawSnap=json; drawRedo=[]; syncUndoRedoBtns();
}
function applyDrawsSnapshot(arr){
  const prev=suppressDrawSave; suppressDrawSave=true;
  clearDrawings();
  buildDrawsFromArray(arr);
  suppressDrawSave=prev; clearTimeout(drawSaveTimer);
  try{ localStorage.setItem(drawsKey(), JSON.stringify(arr)); }catch(e){}
  // Sejak gambar hidup di SERVER, menulis localStorage saja berarti undo mendarat di tempat yang
  // tak pernah dibaca lagi (cermin cuma dibaca saat request gagal): layar & cermin menunjukkan 4
  // objek, server tetap 5, reload berikutnya menghidupkan lagi objek yang barusan di-undo.
  // Snapshot-nya sendiri yang didorong — bukan serializeDraws() ulang — supaya yang naik ke server
  // persis keadaan yang baru saja dipasang, bukan hasil pembacaan ulang kanvas yang bisa berbeda.
  // Gerbang suppressDrawSave dihormati persis seperti saveDraws(): saat clear/restore programatik
  // sedang berjalan, tak ada satu pun jalur yang boleh mendorong ke server.
  if(!suppressDrawSave) try{ scheduleSyncDraws(inst, arr); }catch(_){}
}
function undoDraw(){
  if(!drawUndo.length) return;
  drawRedo.push(drawSnap); drawSnap=drawUndo.pop();
  applyDrawsSnapshot(JSON.parse(drawSnap)); syncUndoRedoBtns();
}
function redoDraw(){
  if(!drawRedo.length) return;
  drawUndo.push(drawSnap); drawSnap=drawRedo.pop();
  applyDrawsSnapshot(JSON.parse(drawSnap)); syncUndoRedoBtns();
}
// dipanggil setelah restore per-instrumen: history bersifat per-instrumen, jadi di-reset.
function resetDrawHistory(){ drawUndo=[]; drawRedo=[]; drawSnap=JSON.stringify(serializeDraws()); syncUndoRedoBtns(); }
function syncUndoRedoBtns(){
  const u=$('#undoBtn'), r=$('#redoBtn');
  if(u) u.disabled=!drawUndo.length;
  if(r) r.disabled=!drawRedo.length;
}
$('#undoBtn').onclick=undoDraw;
$('#redoBtn').onclick=redoDraw;

