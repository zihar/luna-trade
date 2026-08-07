// [clone] Ctrl (Windows/Linux) atau ⌘ (Mac) + seret BADAN objek → salinan tertinggal di posisi
// asal. Perilaku TradingView.
// Rancangan & keputusannya: docs/superpowers/specs/2026-08-07-clone-ctrl-drag-design.md
//
// Yang bergerak adalah objek ASLI; yang baru dibuat justru yang diam di tempat. Efek visualnya
// identik dengan TV, tapi kita tak perlu mengalihkan target drag di tengah gestur — mesin drag
// klinecharts sudah memegang objek aslinya sejak mousedown.

// Modifier dibaca dari state saat MOUSEDOWN, bukan sepanjang gestur: menekan Ctrl setelah drag
// berjalan tak meng-clone (TV sama), dan melepasnya di tengah tak membatalkan salinan yang sudah
// jadi. Listener mousedown dipasang di fase CAPTURE pada window supaya sudah tersegar sebelum
// klinecharts memanggil onPressedMoveStart. keydown/keyup menjaga state tetap benar bila gestur
// dimulai lewat jalur lain; `blur` mencegahnya nyangkut saat window kehilangan fokus.
let cloneModHeld=false;
addEventListener('mousedown',(e)=>{ cloneModHeld=e.ctrlKey||e.metaKey; },{capture:true});
addEventListener('keydown',(e)=>{ if(e.key==='Control'||e.key==='Meta') cloneModHeld=true; });
addEventListener('keyup',(e)=>{ if(e.key==='Control'||e.key==='Meta') cloneModHeld=false; });
addEventListener('blur',()=>{ cloneModHeld=false; });

// Salin objek `id` menjadi overlay baru di titik `pts` (default: titik objek itu sendiri).
// Mengembalikan id salinan, atau null bila gagal.
//
// `pts` sengaja bisa dioper: pemanggilnya (drag) sudah memegang snapshot posisi AWAL gestur, dan
// itu yang harus ditinggalkan — membaca o.points di sini akan bergantung pada apakah drag sudah
// sempat menulis titik baru atau belum.
function cloneOverlay(id, pts){
  const o=chart.getOverlayById(id); if(!o||!o.points||!o.points.length) return null;
  const src=pts||o.points;
  const base={name:o.name, points:src.map(p=>Object.assign({},p))};
  if(o.extendData!==undefined) base.extendData=o.extendData;   // teks "Add text" ikut tersalin
  if(o.styles) base.styles=o.styles;
  // delHooks(): salinan harus punya hook yang SAMA dgn objek biasa (drag presisi sub-bar, magnet,
  // kunci sudut, simpan-otomatis). Tanpa itu ia jadi objek kelas dua yang perilakunya beda.
  const nid=chart.createOverlay(Object.assign(base, delHooks()));
  if(!nid) return null;
  drawIds.push(nid);
  // Gaya per-objek hidup di peta terpisah (objStyle), jadi ia tak ikut lewat createOverlay.
  // Pola override-setelah-set menyusul js/draw-persist.js: overlay custom membaca gayanya saat
  // render, jadi ia perlu satu putaran render lagi; garis built-in sudah membawa `styles` di atas.
  if(objStyle[id]){ objStyle[nid]=Object.assign({}, objStyle[id]);
    if(!BUILTIN_LINE[o.name]) try{ chart.overrideOverlay({id:nid, points:base.points}); }catch(_){} }
  return nid;
}
