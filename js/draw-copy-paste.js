// [copy/paste] Ctrl/⌘+C menyalin objek TERPILIH ke clipboard aplikasi; Ctrl/⌘+V menaruh salinannya
// di posisi kursor. Rancangan & keputusannya:
// docs/superpowers/specs/2026-08-08-copy-paste-objek-design.md
//
// Bentuk objek direkam sebagai offset PIKSEL antar titik (saat copy), BUKAN delta bar/harga: itu
// satu-satunya satuan yang tetap masuk akal saat di-paste ke instrumen lain — delta harga 0.0050
// milik EUR tak berarti apa-apa di XAU. Konsekuensi yang diterima: paste sesudah zoom berubah
// menghasilkan objek yang mencakup lebih banyak/sedikit bar — ia mendarat seperti yang TERLIHAT.
//
// Clipboard hidup di memori saja: ia sengaja tak selamat dari reload (clipboard yang mengingat
// objek dari kemarin mengagetkan, untungnya tipis).
let drawClip=null;   // {name, styles, extendData, objStyle, off:[{dx,dy}]}

// Salin objek TERPILIH. Hanya `selectedId` — hover sengaja TIDAK dipakai (walau Delete memakainya):
// menyalin objek yang cuma kelewatan kursor tak punya niat di baliknya. Objek terkunci boleh
// disalin: menyalin tak mengubah apa pun.
function copyOverlay(){
  const id=selectedId; if(!id) return false;
  const d=descOf(id); if(!d) return false;
  // Gerbang PERSIST_DRAW (js/draw-persist.js): tool ephemeral (measure) lewat jalur normal yang
  // sama jadi BISA selectedId & lolos sampai sini, tapi menyalinnya melahirkan overlay `measure`
  // permanen di drawIds — persistence tak menjangkaunya (tak masuk PERSIST_DRAW) dan
  // clearMeasure() tak tahu id-nya, jadi ia jadi hantu yang cuma hilang saat reload.
  if(!PERSIST_DRAW[d.name]) return false;
  const px=d.points.map(anchorPx);
  if(px.some(p=>!p)) return false;   // ada titik yang tak terkonversi → jangan simpan bentuk separuh
  drawClip={ name:d.name, styles:d.styles, extendData:d.extendData, objStyle:d.objStyle,
             off:px.map(p=>({dx:p.x-px[0].x, dy:p.y-px[0].y})) };
  return true;
}

// Tempatkan isi clipboard sehingga TITIK KE-1 mendarat di (px,py) container-relative terhadap
// #chart. Mengembalikan id objek baru, atau null.
function pasteOverlayAt(px,py){
  if(!drawClip) return null;
  // Sama seperti createDraw() (js/draw-tools.js): mau membuat objek baru → tampilkan lagi semua
  // gambar. Tanpa ini, paste saat drawing disembunyikan melahirkan satu objek yang KELIHATAN
  // sendirian di tengah chart yang kosong, sementara tombol mata masih bilang "Show all drawings" —
  // membingungkan, seolah objek lama hilang padahal cuma disembunyikan.
  if(drawsHidden){ drawsHidden=false; applyDrawsVisibility(); syncHideDrawBtn(); }
  const pts=[];
  for(const o of drawClip.off){
    const x=px+o.dx, y=py+o.dy;
    const v=pxToValue(y); if(v==null) return null;
    // Jalur anchor: js/util.js:anchorFromPx() — kebijakan SAMA dgn instantDropPoint
    // (js/draw-tools.js), satu tempat, supaya salinan tak "loncat" saat dibuat.
    const np=anchorFromPx(drawClip.name, x, v); if(!np) return null;
    pts.push(np);
  }
  const nid=createFromDesc(drawClip, pts);
  if(!nid) return null;
  // Dua hal yang clone dapat GRATIS dari drag-nya, dan paste harus kerjakan sendiri:
  scheduleSaveDraws();   // tanpa ini objek hilang saat reload & Ctrl+Z tak bisa membatalkannya
  selectPastedOverlay(nid);
  return nid;
}

// Pilih objek yang baru di-paste — kebalikan deselectOverlay() (js/draw-tools.js), lewat jalur
// internal klinecharts@9.8.10 yang sama.
//
// onClick di-lepas SEMENTARA karena setClickInstanceInfo memanggilnya, dan onClick kita punya dua
// efek samping yang keliru di sini: mode eraser akan langsung MENGHAPUS objek yang baru lahir, dan
// objek kosong yang kursornya kebetulan di atas placeholder akan membuka editor teks inline.
// Yang kita mau cuma state seleksinya; onSelected (yang menyetel selectedId) tetap terpanggil.
function selectPastedOverlay(id){
  try{
    const inst=chart.getOverlayById(id);
    if(inst){
      const oc=inst.onClick; inst.onClick=null;
      try{
        chart.getChartStore().getOverlayStore().setClickInstanceInfo(
          {paneId:'candle_pane', instance:inst, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}, {}
        );
      } finally { inst.onClick=oc; }
    }
  }catch(_){}   // internal berubah → paste tetap jadi, cuma tak terpilih
  // WAJIB di luar try/catch, sama alasannya dgn deselectOverlay() (js/draw-tools.js): invariant
  // "selectedId tak boleh tertinggal di objek SUMBER" tak boleh bergantung pada jalur internal di
  // atas berhasil. Bila overlay belum ketemu (inst null) atau setClickInstanceInfo melempar,
  // selectedId tanpa baris ini masih menunjuk objek ASLI (copyOverlay mensyaratkan selectedId) —
  // Delete berikutnya akan menghapus objek sumber, bukan salinan yang dikira pengguna sudah dipilih.
  // Pada jalur sukses baris ini tak berefek: onSelected sudah menyetel nilai yang sama.
  selectedId=id;
}

// Titik jatuh untuk Ctrl/⌘+V: posisi kursor bila ia di atas chart, selain itu TENGAH area chart.
//
// Gerbangnya `ptrOverChart`, BUKAN membandingkan lastPtr dengan rect: lastPtr hanya di-update
// mousemove DI DALAM #chart, jadi ia tak pernah berisi koordinat di luar dan cek rect tak akan
// pernah gugur (Temuan 4 E2E — fallback instantDropPoint pernah jadi kode mati justru karena itu).
// Cek rect tetap dipertahankan sebagai lapis kedua, mis. chart menyusut sesudah pointer tercatat.
//
// Tengah chart dipilih sebagai fallback, bukan "posisi asal + offset": sesudah clipboard lintas
// instrumen, posisi asal bisa tak ada di layar — bahkan tak ada di data instrumen ini.
function pastePoint(){
  const el=$('#chart'); if(!el) return null;
  const r=el.getBoundingClientRect();
  if(ptrOverChart){
    const x=lastPtr.x-r.left, y=lastPtr.y-r.top;
    if(x>=0 && y>=0 && x<=r.width && y<=r.height) return {x,y};
  }
  return {x:r.width/2, y:r.height/2};
}
