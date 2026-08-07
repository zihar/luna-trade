// [magnet sementara] Ctrl (Windows/Linux) atau ⌘ (Mac) ditahan MEMBALIK setelan magnet selama
// modifier itu ditahan: magnet mati → nempel sesaat; magnet nyala → bebas sesaat.
// Rancangan & keputusannya: docs/superpowers/specs/2026-08-08-magnet-sementara-design.md
//
// Tak bentrok dgn clone (js/draw-clone.js): clone hanya di cabang "seret BADAN objek yang sudah
// jadi", sedang magnet sementara berlaku saat MENGGAMBAR dan saat menyeret UJUNG. Pembagian
// konteks yang sama dipakai TradingView.

// LIVE, bukan dibaca sekali saat mousedown seperti `cloneModHeld`: magnet sementara harus
// menyala/padam seketika saat modifier ditekan atau dilepas di tengah gestur. Disegarkan dari
// event mouse (capture di window) dengan alasan yang sama seperti `shiftHeld` di
// js/draw-constrain.js: bila modifier dilepas ketika window kehilangan fokus, `keyup` tak datang.
let magnetTempHeld=false;
addEventListener('keydown',(e)=>{ if(e.key==='Control'||e.key==='Meta'){ magnetTempHeld=true; syncMagnetMode(); } });
addEventListener('keyup',(e)=>{ if(e.key==='Control'||e.key==='Meta'){ magnetTempHeld=false; syncMagnetMode(); } });
addEventListener('blur',()=>{ magnetTempHeld=false; syncMagnetMode(); });
addEventListener('mousemove',(e)=>{ const v=e.ctrlKey||e.metaKey; if(v!==magnetTempHeld){ magnetTempHeld=v; syncMagnetMode(); } },{capture:true});

// Magnet yang BERLAKU sekarang = setelan XOR modifier. Semua jalur gambar/ukur membaca ini;
// tombol rail sengaja tetap membaca `magnetOn` supaya ia tak berkedip oleh modifier sesaat.
function magnetActive(){ return magnetOn !== magnetTempHeld; }

// Overlay yang sedang digambar membawa `mode` sendiri, dan klinecharts memakainya untuk
// rubber-band bawaannya. Tanpa disamakan, magnet-ON + Ctrl (niatnya BEBAS) masih menyisakan
// preview yang menempel. Ini persis yang dilakukan tombol magnet saat di-toggle di tengah
// menggambar (js/draw-rail.js).
// try membungkus SELURUH badan, termasuk pembacaan inProgressId: listener di atas sudah hidup
// sejak file ini dieksekusi, sedang `inProgressId` (let, js/draw-tools.js) baru dideklarasikan di
// script berikutnya — membacanya di jendela sempit itu melempar ReferenceError, dan `typeof` pun
// tak menyelamatkan variabel `let` yang masih dalam TDZ.
function syncMagnetMode(){
  try{ if(inProgressId==null) return;
    chart.overrideOverlay({id:inProgressId, mode: magnetActive()?'strong_magnet':'normal'});
  }catch(_){}
}
