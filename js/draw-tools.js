// ===================== drawing tools (ikon, ala TV) =====================
let selectedId=null, hoverId=null, hoverName=null, inProgressId=null, addTextTimer=null;
function disarmIcons(){ document.querySelectorAll('.dtool:not(#magBtn)').forEach(x=>x.classList.remove('armed')); }
// Batalkan gambar yang belum jadi — satu-satunya jalur batal (Esc, klik kanan, ganti cursor).
// Membuang overlay saja tak cukup: pendingClicks, tombol rail yang 'armed', dan reticle titik
// ikut nyangkut. drawIds dibersihkan oleh onRemoved. Balikan: true bila memang ada yg dibatalkan.
function cancelInProgressDraw(){
  if(!inProgressId) return false;
  try{chart.removeOverlay(inProgressId);}catch(_){}
  inProgressId=null; pendingClicks=[]; disarmIcons(); try{hideMagDot();}catch(_){}
  return true;
}
// Lepas seleksi objek gambar yang sudah jadi (Esc). selectedId=null saja TAK cukup: klinecharts
// menyimpan state seleksi di OverlayStore._clickInstanceInfo (inilah yang menggambar handle). Bersihkan
// lewat setClickInstanceInfo(instance:null) → memicu onDeselected (yang mereset selectedId) + re-render pane.
// Jalur internal ini valid utk klinecharts@9.8.10 yang di-pin; try/catch + fallback jaga-jaga bila berubah.
function deselectOverlay(){
  try{
    chart.getChartStore().getOverlayStore().setClickInstanceInfo(
      {paneId:'', instance:null, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}, {}
    );
  }catch(_){}
  selectedId=null;
}
// paksa render ulang overlay posisi saat select/hover → handle & teks muncul/hilang seketika.
// HANYA utk posisi yg sudah lengkap (6 titik) & tidak sedang digambar — jangan ganggu proses draw.
function posRerender(o){ try{
  if(!o||o.id===inProgressId||!o.points) return;
  if((o.name==='longPosition'||o.name==='shortPosition')&&o.points.length>=6) chart.overrideOverlay({id:o.id,points:o.points});
  else if(o.name==='fib3'&&o.points.length>=2) chart.overrideOverlay({id:o.id,points:o.points});  // toggle penanda harga Y saat aktif
  // rect/trendline kosong: paksa redraw saat hover/select → undangan "+ Add text" muncul/hilang seketika
  else if((o.name==='rect'||o.name==='trendline')&&o.points.length>=2&&!(o.extendData&&String(o.extendData).trim())) chart.overrideOverlay({id:o.id,points:o.points});
}catch(_){} }
function delHooks(){ return {
  // Preview PRESISI untuk SEMUA tool sub-bar. klinecharts men-snap titik in-progress ke pusat
  // bar (integer dataIndex + timestamp) → rubber-band tak mengikuti kursor & final "loncat".
  // Nilai balik onDrawing DIABAIKAN klinecharts (beda dari onPressedMoving yg di-gate), jadi
  // titik in-progress ditulis ulang LANGSUNG di sini: dataIndex PECAHAN tanpa timestamp (supaya
  // render tak re-snap), identik dgn jalur commit di onDrawEnd → preview == final.
  // Hook ini per-INSTANCE lewat createOverlay, jadi berlaku juga untuk 9 overlay BUILT-IN
  // klinecharts yang tak kita daftarkan sendiri.
  // Magnet hanya menyetel VALUE (harga) ke OHLC; X tetap ikut kursor supaya preview & commit
  // konsisten. e.x/e.y = container-relative (sama ruang dgn fracAnchorFromPx/pxToValue).
  onDrawing:(e)=>{ const o=e&&e.overlay; if(!o||!o.points||!o.points.length||!subBar(o.name)) return false;
    const m=o.points.length-1;                        // titik yg sedang ditarik = indeks terakhir
    for(let k=0;k<m;k++){ const pc=pendingClicks[k];  // titik yg sudah diklik → re-anchor ke fidx presisi
      if(pc && isFinite(pc.fidx) && pc.value!=null) o.points[k]={dataIndex:pc.fidx, value:pc.value}; }
    const fa=fracAnchorFromPx(e.x); let v=pxToValue(e.y);
    if(magnetOn && v!=null){ const xa=xAnchorFromPx(e.x);   // magnet: value → OHLC terdekat, X tetap kursor
      if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, e.x, e.y); if(s) v=s.value; } }
    if(fa && v!=null) o.points[m]={dataIndex:fa.dataIndex, value:v};
    return false;
  },
  // Drag PRESISI untuk tool sub-bar — pasangan onDrawing di atas, untuk objek yang SUDAH jadi
  // (dan untuk titik terakhir yang ditaruh lewat tekan-geser-lepas saat menggambar).
  // klinecharts default mengubah kursor→titik via _coordinateToPoint yg meng-snap ke indeks
  // INTEGER; dengan `return true` di onPressedMoving, default itu dilewati dan kita tulis
  // dataIndex PECAHAN sendiri (satu ujung) / translasi semua titik (badan objek). e.x/e.y
  // klinecharts = clientX-target.left (container-relative) → sama ruang dgn
  // fracAnchorFromPx/pxToValue (OX=OY=0).
  //
  // Sampai 2026-07-26 hook ini hanya terdaftar di registrasi `trendline`, jadi 18 tool lain
  // meleset ½ barSpace saat titiknya digeser dan 15 tool saat badannya digeser — terukur di
  // tests/drawing/31-drag-precision.spec.js (Temuan 6), sama besar di fixture maupun server asli.
  //
  // Guard subBar(): tool BAR_ANCHOR dilewati dengan sengaja. verticalStraightLine memang harus
  // snap ke bar, dan long/shortPosition punya jalur pressed-move sendiri (panel posisi + handle
  // SL/TP) yang tak boleh ditimpa.
  onPressedMoveStart:(e)=>{ const o=e&&e.overlay; if(o&&subBar(o.name)) dragBase={pts:(o.points||[]).map(p=>Object.assign({},p)), x:e.x, y:e.y}; return false; },
  onPressedMoving:(e)=>{ const o=e&&e.overlay; if(!o||!o.points||!subBar(o.name)) return false;
    const OX=0, OY=0;
    const xa=fracAnchorFromPx(e.x-OX), v=pxToValue(e.y-OY);
    if(!xa || v==null) return false;
    const pts=o.points.map(p=>Object.assign({},p));
    const key=e.figureKey||'';
    if(key.indexOf('overlay_figure_point_')===0){       // seret SATU ujung
      const i=e.figureIndex;
      if(BOX_TOOLS[o.name]){
        // rect/fib3 mendaftarkan performEventPressedMove (boxPressedMove) yg menulis ulang 8 titik
        // supaya kotaknya tetap kotak — dan `return true` di bawah melewati jalur klinecharts yg
        // biasanya memanggilnya. Jadi panggil sendiri, dengan performPoint PRESISI (dataIndex
        // pecahan) yang justru inti perbaikan ini; writeBox/keyOf sudah menerima anchor pecahan.
        // Tanpa ini, menarik satu handle menulis satu titik lepas → kotaknya rusak (terukur:
        // titik mendarat 202px dari kursor), bukan cuma kurang presisi.
        boxPressedMove({points:pts, performPointIndex:i, performPoint:{dataIndex:xa.dataIndex, value:v}});
      } else if(pts[i]) pts[i]={dataIndex:xa.dataIndex, value:v};
    } else {                                            // seret BADAN objek → translasi semua titik
      if(!dragBase) return false;
      const sx=fracAnchorFromPx(dragBase.x-OX), sv=pxToValue(dragBase.y-OY);
      if(!sx || sv==null) return false;
      const dIdx=xa.dataIndex-sx.dataIndex, dV=v-sv;
      for(let i=0;i<pts.length;i++){ const sp=dragBase.pts[i]; if(!sp) continue;
        const bi=(sp.dataIndex!=null)?sp.dataIndex:fidxOf(sp);
        pts[i]={dataIndex: bi+dIdx, value: (sp.value!=null?sp.value:v)+dV}; }
    }
    try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(_){}
    return true;                                        // lewati snap bawaan klinecharts
  },
  // scheduleSaveDraws() WAJIB ikut: tanpa itu hasil drag tak tersimpan & tak masuk history undo.
  onPressedMoveEnd:(e)=>{ dragBase=null; try{ if(magnetOn&&e&&e.overlay) refineMagnetPoints(e.overlay.id); }catch(_){}
    try{scheduleSaveDraws();}catch(_){} return false; },
  onDrawStart:(e)=>{ pendingClicks=[]; return false; },   // buang sisa klik dari gambar yg batal
  onDrawEnd:(e)=>{ const o=e&&e.overlay;
    applyXDateFlag(o);   // buang tanggal sumbu X utk draw non-waktu (built-in klinecharts set flag ini true)
    if(suppressDrawSave) return false;   // restore programatik: jangan expand/buka editor/simpan
    // kembalikan handle titik yg disembunyikan saat menggambar → buletan hover/drag normal lagi (muncul saat objek di-hover/pilih)
    try{ if(o) chart.overrideOverlay({id:o.id, styles:{point:OVERLAY_POINT}}); }catch(_){}
    // Tempelkan klik presisi ke titik final by-index (klik & titik urut sama), lalu JARING
    // PENGAMAN: klinecharts kadang menaruh titik di area future TANPA anchor (timestamp &
    // dataIndex null) → tergambar ke tepi kiri chart (x=0) = "kelempar". Titik anchorless
    // apa pun diberi anchor dari posisi klik terakhir (lastPtr) via xAnchorFromPx.
    try{ if(o&&o.points){
      const rect=$('#chart').getBoundingClientRect();
      const toPt=(pc)=>{ const np = pc.timestamp!=null?{timestamp:pc.timestamp,value:pc.value}:{dataIndex:pc.dataIndex,value:pc.value};
        if(o.name==='verticalStraightLine' && np.timestamp!=null) np.timestamp=snapTimeToBar(np.timestamp); return np; };
      // Refine ke presisi sub-bar HANYA bila klik ↔ titik klinecharts SELARAS: jumlah sama &
      // tiap titik berdekatan secara pixel di X. Saat klik cepat, pendingClicks bisa desync (klik
      // ekstra dianggap noise / push ter-skip) → pemetaan by-index memasang klik yg salah &
      // kotak "mengecil". Bila desync, pakai titik klinecharts apa adanya (ukuran benar, x snap-ke-bar).
      // Y HANYA dicek di titik TERAKHIR, bukan semua titik: beberapa overlay built-in (mis.
      // horizontalRayLine) menghomogenkan VALUE titik #0 mengikuti performPoint selama menggambar
      // (klinecharts performEventMoveForDrawing) — itu justru value yg mau kita timpa balik ke
      // klik asli, jadi mensyaratkan Y titik #0 sudah dekat malah menolak koreksi yg dicari.
      // Titik TERAKHIR aman dicek di kedua sumbu karena ia SENDIRI adalah performPoint (klinecharts
      // menyalin value performPoint ke titik lain, bukan sebaliknya) → pendingClicks[last].value
      // tetap ≈ o.points[last].value walau utk tool ber-invariant sekalipun. Sinyal desync klik
      // cepat (klik nyasar/tertelan bikin titik jatuh di Y yg jauh) tetap tertangkap lewat titik ini.
      const pxOf=(p)=>{ if(!p) return null; let c=chart.convertToPixel(p.timestamp!=null?{timestamp:p.timestamp,value:p.value}:{dataIndex:p.dataIndex,value:p.value},{paneId:'candle_pane',absolute:true}); if(Array.isArray(c))c=c[0]; return c||null; };
      let refine = pendingClicks.length===o.points.length;
      // Y dilewati HANYA utk titik yg memang sudah dihomogenkan overlay ke value titik terakhir
      // (lihat komentar di atas) — dideteksi dari BENTUK (value titik k ≈ value titik terakhir),
      // bukan dari nama tool, supaya tak melawan tujuan generik BAR_ANCHOR/subBar. Titik lain yg
      // TIDAK dihomogenkan (value-nya masih beda dari titik terakhir) tetap dicek Y spt sebelum
      // Temuan #penyempitan ini — jaring desync klik-cepat tak lagi bolong utk titik non-terakhir.
      if(refine){ const tolX=1.5*barSpacePx(), lastIdx=o.points.length-1;
        for(let k=0;k<o.points.length;k++){ const a=pxOf(toPt(pendingClicks[k])), b=pxOf(o.points[k]);
          if(!a||!b||Math.abs(a.x-b.x)>tolX||
             ((k===lastIdx || Math.abs(o.points[k].value-o.points[lastIdx].value)>1e-9) && Math.abs(a.y-b.y)>6)){ refine=false; break; } } }
      if(refine){ for(let k=0;k<o.points.length;k++) o.points[k]=toPt(pendingClicks[k]); }
      // Tool sub-bar: pindahkan anchor ke dataIndex PECAHAN (bukan timestamp) supaya bentuk &
      // handle dirender presisi di titik klik. Fraksi presisi diambil dari fidx klik
      // (pendingClicks) saat refine berhasil; fallback ke dataIndex titik / fidxOf (snap ke bar)
      // bila desync. Tool di BAR_ANCHOR sengaja dilewati — snap per-bar-nya memang diinginkan.
      if(subBar(o.name)){ o.points=o.points.map((p,k)=>{ if(!p||p.value==null) return p;
        const pc = refine ? pendingClicks[k] : null;
        const idx = (pc && isFinite(pc.fidx)) ? pc.fidx
                  : (p.dataIndex!=null && isFinite(p.dataIndex)) ? p.dataIndex
                  : fidxOf(p);
        return {dataIndex: idx, value: p.value}; }); }
      o.points.forEach((pt,i)=>{ if(pt && pt.timestamp==null && (pt.dataIndex==null || !isFinite(pt.dataIndex))){
        const a=xAnchorFromPx(lastPtr.x-rect.left); const val=(pt.value!=null)?pt.value:pxToValue(lastPtr.y-rect.top);
        if(a && val!=null) o.points[i]=Object.assign({value:val}, a); }});
      // Snapshot VALUE yg kita niatkan sbg angka lepas (bukan referensi) SEBELUM override: array
      // `o.points` yg dikirim ke overrideOverlay bisa jadi array yg sama dgn milik klinecharts
      // (dimutasi in-place oleh override-nya sendiri), jadi membandingkannya lagi SESUDAH
      // override cuma membandingkan sesuatu dgn dirinya sendiri.
      const intendedValues=o.points.map(p=>p&&p.value!=null?p.value:null);
      chart.overrideOverlay({id:o.id, points:o.points});
      // JARING PENGAMAN #2: beberapa overlay built-in (mis. horizontalRayLine) menegakkan
      // invariant "semua titik sama VALUE" di DALAM overrideOverlay sendiri (klinecharts
      // performEventPressedMove), memakai titik TERAKHIR sbg rujukan → menimpa balik value
      // titik #0 yg barusan kita perbaiki ke level presisi klik pertama. Kalau override
      // ternyata mengubah value dari yg kita niatkan, timpa ulang SEMUA titik pakai value titik
      // #0 (sumber presisi kita, sesuai createPointFigures yg memang cuma pakai titik #0)
      // supaya invariant klinecharts tetap terjaga TANPA kehilangan level yg benar-benar diklik.
      const afterOverride=chart.getOverlayById(o.id);
      if(afterOverride && afterOverride.points && afterOverride.points.length===intendedValues.length){
        const drifted=afterOverride.points.some((p,i)=>{ const v=intendedValues[i];
          return p&&p.value!=null&&v!=null&&Math.abs(p.value-v)>1e-9; });
        // Timpa ulang HANYA bila drift-nya memang pola HOMOGENISASI klinecharts (semua titik
        // berakhir di value yg SAMA satu sama lain) — itu tanda tangan performEventPressedMove
        // (lihat komentar di atas), bukan sekadar value yg berbeda dari niat kita krn sebab lain
        // yg tak kita kenali. Tanpa syarat ini, collapse bisa salah tembak diam-diam (ketutup
        // catch(_){} di luar) pada overlay lain di masa depan yg juga mengubah value saat override
        // tapi TIDAK dgn cara menyeragamkan semua titik.
        const homogenized = afterOverride.points.length>1 &&
          afterOverride.points.every(p=>p&&p.value!=null) &&
          afterOverride.points.every(p=>Math.abs(p.value-afterOverride.points[0].value)<1e-9);
        if(drifted && homogenized && intendedValues[0]!=null){ const lvl=intendedValues[0];
          chart.overrideOverlay({id:o.id, points:afterOverride.points.map(p=>p?Object.assign({}, p, {value:lvl}):p)}); }
      }
    } }catch(_){}
    pendingClicks=[];
    try{expandPosition(o); expandBox(o); applyTextInput(o);}catch(_){}
    if(magnetOn && o) refineMagnetPoints(o.id);   // magnet: geser titik ke OHLC M5 presisi (async, on-demand)
    inProgressId=null; disarmIcons(); try{hideMagDot();}catch(_){} scheduleSaveDraws(); return false; },
  onClick:(e)=>{ if(eraserOn){ try{chart.removeOverlay(e.overlay.id);}catch(_){} return false; }
    const o=e.overlay; selectedId=o&&o.id;
    // klik pada undangan "+ Add text" objek KOSONG → editor INLINE (bukan modal). Timer 220ms:
    // double-click (buka modal) akan membatalkannya lewat clearTimeout di onDoubleClick.
    if(o && ADDTEXT_CLICK.has(o.name) && !(o.extendData&&String(o.extendData).trim()) && overPlaceholder(o)){
      clearTimeout(addTextTimer);
      addTextTimer=setTimeout(()=>{ const c=chart.getOverlayById(o.id); if(c && !(c.extendData&&String(c.extendData).trim())) openOverlayTextEditor(c,false); }, 220);
    }
    return false; },
  // return true → cegah hapus default klinecharts; popup setting tetap via handler contextmenu DOM.
  // Objek yang MASIH digambar sengaja tak di-select: klik kanan di atasnya = batal (diurus handler
  // contextmenu), jadi ia tak boleh meninggalkan selectedId ke objek yang sebentar lagi dibuang.
  onRightClick:(e)=>{ if(e.overlay.id!==inProgressId) selectedId=e.overlay.id; return true; },
  onDoubleClick:(e)=>{ clearTimeout(addTextTimer); try{ const o=e.overlay, n=o&&o.name;   // batalkan editor inline → double-click = modal
    if(DRAW_DEFAULT[n]!==undefined) openObjSettings(o, lastPtr.x, lastPtr.y, DM_TEXT_OBJS.has(n)?'text':'style'); }catch(_){} return false; },
  onSelected:(e)=>{ selectedId=e.overlay.id; posRerender(e.overlay); return false; },
  onDeselected:(e)=>{ if(selectedId===e.overlay.id) selectedId=null; posRerender(e.overlay); return false; },
  onMouseEnter:(e)=>{ hoverId=e.overlay.id; hoverName=e.overlay.name; posRerender(e.overlay); return false; },
  onMouseLeave:(e)=>{ if(hoverId===e.overlay.id){ hoverId=null; hoverName=null; posRerender(e.overlay); } return false; },
  onRemoved:(e)=>{ drawIds=drawIds.filter(x=>x!==e.overlay.id); if(selectedId===e.overlay.id) selectedId=null; if(hoverId===e.overlay.id) hoverId=null; scheduleSaveDraws(); return false; },
};}
// Instant-drop ala TradingView: shortcut H/V → garis langsung terpasang di posisi cursor
// tanpa klik. Titik diambil dari cursor terakhir (lastPtr); null bila cursor di LUAR chart
// (mis. shortcut ditekan saat pointer tak di atas chart) → fallback ke mode gambar biasa.
//
// Gerbang "di luar chart" WAJIB memakai ptrOverChart, bukan membandingkan lastPtr dgn rect
// (Temuan 4 E2E): lastPtr hanya di-update mousemove pada #chart, jadi ia TAK PERNAH berisi
// koordinat di luar chart dan cek rect di bawah tak akan pernah gugur — fallback yg ditulis di
// sini dulu jadi kode mati, dan Alt+H yg ditekan sambil kursor di watchlist/header tetap
// menjatuhkan garis di posisi terakhir di dalam chart, tanpa diminta & di tempat yg tak dilihat
// user. Cek rect tetap dipertahankan sebagai lapis kedua (mis. chart menyusut setelah pointer
// terakhir tercatat, sehingga koordinat lama jatuh di luar area plot yg baru).
const INSTANT_DROP={horizontalStraightLine:1, verticalStraightLine:1};
function instantDropPoint(name){
  if(!ptrOverChart) return null;
  const el=$('#chart'), r=el.getBoundingClientRect();
  const px=lastPtr.x-r.left, py=lastPtr.y-r.top;
  if(px<0||py<0||px>r.width||py>r.height) return null;
  const v=pxToValue(py); if(v==null) return null;
  // anchor X WAJIB ada utk kedua garis: walau x tak relevan visual utk horizontal,
  // serializeDraws melewati titik tanpa `vt` → tanpa anchor X garis tak ter-persist & tak
  // masuk history undo (sama spt garis yg digambar manual: klik memberi anchor dari posisi-x).
  // Bentuk anchor ikut kebijakan subBar() yg sama dgn onDrawEnd: horizontalStraightLine
  // (sub-bar) → dataIndex PECAHAN via fracAnchorFromPx, supaya jalur instant-drop (dropped=true,
  // onDrawEnd/subBar() tak pernah jalan) mendarat presisi juga, bukan snap ke pusat bar spt
  // sebelumnya. verticalStraightLine (BAR_ANCHOR) tetap xAnchorFromPx lalu snap ke bar di bawah
  // (x memang relevan → wajib align ke candle yg diklik).
  const xa = subBar(name) ? fracAnchorFromPx(px) : xAnchorFromPx(px); if(!xa) return null;
  const np=Object.assign({value:v}, xa);
  if(name==='verticalStraightLine' && np.timestamp!=null) np.timestamp=snapTimeToBar(np.timestamp);
  return np;
}
function createDraw(name,btn,extra,instant){
  track('draw',{tool:name});
  try{
    pendingClicks=[];
    if(drawsHidden){ drawsHidden=false; applyDrawsVisibility(); syncHideDrawBtn(); }   // mau gambar baru → tampilkan lagi
    const base={name};
    if(BUILTIN_LINE[name]) base.styles=klineLineStyles(dstyle({name}));   // garis h/v: default dotted + warna
    // magnet ON → mode 'strong_magnet' bawaan klinecharts: garis preview (rubber-band) LANGSUNG
    // nempel ke OHLC candle terdekat saat ditarik, bukan cuma titik yg sudah diklik. Presisi
    // sub-bar (timestamp M5) tetap disempurnakan oleh pendingClicks + refineMagnetPoints di onDrawEnd.
    if(magnetOn) base.mode='strong_magnet';
    // instant-drop (H/V via shortcut): pre-fill 1 titik → overlay langsung jadi (tak masuk mode gambar)
    let dropped=false;
    if(instant && INSTANT_DROP[name]){ const pt=instantDropPoint(name); if(pt){ base.points=[pt]; dropped=true; } }
    const id=chart.createOverlay(Object.assign(base,delHooks(),extra||{}));
    if(id){ drawIds.push(id);
      if(dropped){   // sudah jadi (bukan mode gambar): onDrawEnd TAK terpanggil → tangani manual
        inProgressId=null; disarmIcons();
        try{ applyXDateFlag(chart.getOverlayById(id)); }catch(_){}   // spt jalur restore
        selectedId=id; scheduleSaveDraws();                          // pilih + persist + catat history utk undo
      } else { inProgressId=id; disarmIcons(); if(btn) btn.classList.add('armed');
        // sembunyikan buletan handle titik SELAMA menggambar (titik-bergerak di kursor + titik yg sudah
        // ditaruh) — dikembalikan di onDrawEnd. Kursor jadi bersih (crosshair saja) sesuai preferensi.
        try{ chart.overrideOverlay({id, styles:{point:HIDDEN_POINT}}); }catch(_){}
      }
    }
    else setStatus('Failed to activate '+name,true);
  }catch(e){ setStatus('Drawing error: '+e.message,true); }
}
function clearDrawings(){ drawIds.slice().forEach(id=>{ try{chart.removeOverlay(id);}catch(e){} }); drawIds=[]; selectedId=hoverId=null; }

