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

// Deskripsi objek yang BERDIRI SENDIRI — cukup untuk membuat ulang objek tanpa objek aslinya.
// Dipisah dari createFromDesc karena clipboard (js/draw-copy-paste.js) bisa hidup lebih lama dari
// objeknya: objek dihapus, atau instrumen berganti sehingga overlay-nya sudah tak ada.
function descOf(id){
  const o=chart.getOverlayById(id); if(!o||!o.points||!o.points.length) return null;
  // styles WAJIB deep-copy, bukan Object.assign dangkal: setObjStyle pada BUILTIN_LINE memanggil
  // overrideOverlay({id,styles:…}) yang MEMUTASI o.styles in-place. Referensi dangkal berarti
  // menyalin lalu me-restyle ASLINYA diam-diam ikut mengubah warna deskripsi yang sudah "disalin" —
  // salinan tampak berubah warna sendiri (bahkan sesudah reload, karena objStyle[nid] tetap benar
  // tapi styles overlay-nya sudah ikut objek sumber).
  return {name:o.name, styles:o.styles?JSON.parse(JSON.stringify(o.styles)):null, extendData:o.extendData,
          objStyle:objStyle[id]?Object.assign({},objStyle[id]):null, points:o.points};
}

// Buat overlay baru dari deskripsi, dengan titik `pts` (wajib — pemanggil yang menentukan posisi).
// Mengembalikan id objek baru, atau null bila gagal.
function createFromDesc(desc, pts){
  if(!desc||!pts||!pts.length) return null;
  const base={name:desc.name, points:pts.map(p=>Object.assign({},p))};
  if(desc.extendData!==undefined) base.extendData=desc.extendData;   // teks "Add text" ikut tersalin
  if(desc.styles) base.styles=desc.styles;
  // delHooks(): salinan harus punya hook yang SAMA dgn objek biasa (drag presisi sub-bar, magnet,
  // kunci sudut, simpan-otomatis). Tanpa itu ia jadi objek kelas dua yang perilakunya beda.
  const nid=chart.createOverlay(Object.assign(base, delHooks()));
  if(!nid) return null;
  drawIds.push(nid);
  objDid[nid]=newDid();   // salinan adalah objek LAIN: did baru, jadi alert asalnya tak ikut
  // Jalur FULL-POINT ke-4 (bareng onDrawEnd, restore js/draw-persist.js, instant-drop di
  // js/draw-tools.js) — tanpa ini, garis built-in (rayLine/priceChannelLine/fibonacciLine/…) hasil
  // clone/paste menampilkan tag tanggal default sumbu-X klinecharts yang tak dipakai objek lain.
  try{ applyXDateFlag(chart.getOverlayById(nid)); }catch(_){}
  // Gaya per-objek hidup di peta terpisah (objStyle), jadi ia tak ikut lewat createOverlay.
  // Pola override-setelah-set menyusul js/draw-persist.js: overlay custom membaca gayanya saat
  // render, jadi ia perlu satu putaran render lagi; garis built-in sudah membawa `styles` di atas.
  if(desc.objStyle){ objStyle[nid]=Object.assign({}, desc.objStyle);
    if(!BUILTIN_LINE[desc.name]) try{ chart.overrideOverlay({id:nid, points:base.points}); }catch(_){} }
  return nid;
}

// Salin objek `id` di titik `pts` (default: titik objek itu sendiri).
//
// `pts` sengaja bisa dioper: pemanggilnya (drag) sudah memegang snapshot posisi AWAL gestur, dan
// itu yang harus ditinggalkan — membaca o.points di sini akan bergantung pada apakah drag sudah
// sempat menulis titik baru atau belum.
function cloneOverlay(id, pts){
  const d=descOf(id); if(!d) return null;
  return createFromDesc(d, pts||d.points);
}
