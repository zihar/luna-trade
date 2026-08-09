// [did] Id stabil per objek gambar. klinecharts membuat ulang id overlay tiap restore, jadi id-nya
// tak bisa dipakai untuk menunjuk "objek yang itu" lintas sesi — dan alert yang terikat objek
// (js/draw-alert.js) justru butuh persis itu.
//
// Hidup di peta samping, bukan di dalam objek klinecharts: pola yang sama dengan objStyle
// (js/draw-style.js), karena klinecharts tak punya tempat untuk data milik kita.
const objDid={};   // overlayId → did

// Id acak yang cukup unik tanpa koordinasi server: waktu (base36) + kepingan acak.
function newDid(){ return 'd-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }

// did objek — dibuatkan bila belum ada. Inilah SATU-SATUNYA tempat did lahir, supaya empat jalur
// pembuatan objek (onDrawEnd, restore, instant-drop, createFromDesc) tak masing-masing lupa
// seperti applyXDateFlag pernah terlewat di PR #178.
function didOf(overlayId){
  if(!overlayId) return '';
  if(!objDid[overlayId]) objDid[overlayId]=newDid();
  return objDid[overlayId];
}
