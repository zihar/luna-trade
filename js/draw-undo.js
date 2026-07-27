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

// tangkap klik PRESISI saat menggambar (sebelum klinecharts snap ke bar) → simpan
// waktu sub-bar; bila magnet aktif, snap ke nilai OHLC candle terdekat.
$('#chart').addEventListener('mousedown', (ev)=>{
  if(!inProgressId || ev.button!==0) return;   // hanya klik kiri (klik kanan/tengah tak boleh jadi titik)
  const r=$('#chart').getBoundingClientRect();
  const px=ev.clientX-r.left, py=ev.clientY-r.top;
  const xa=xAnchorFromPx(px), v=pxToValue(py);
  if(!xa||v==null) return;
  // fidx = fractional dataIndex PRESISI di piksel klik (utk trendline; tsToPx meng-snap timestamp
  // jadi tak bisa direkonstruksi dari timestamp di onDrawEnd). Field ekstra → tool lain mengabaikan.
  const fa=fracAnchorFromPx(px), fidx=fa?fa.dataIndex:undefined;
  // magnet HANYA utk titik di dalam data (punya timestamp). Titik di area future (dataIndex,
  // tanpa candle) tak boleh di-snap: magnetSnap akan menariknya ke bar TERAKHIR → garis
  // "kelempar ke kiri". Biarkan anchor dataIndex-nya apa adanya supaya memanjang ke future.
  if(magnetOn && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s){ pendingClicks.push({timestamp:s.timestamp, value:s.value, fidx}); return; } }
  pendingClicks.push(Object.assign({value:v, fidx}, xa));
}, true);

// posisi kursor terakhir (client px) — untuk menempatkan popup setting objek.
// Sengaja HANYA di-update oleh mousemove di #chart: seluruh pemakainya (popup setting/konfirmasi,
// jaring pengaman anchor di onDrawEnd & posisi paper, hit-test badge alert, overPlaceholder)
// berjalan saat pointer memang berada di atas chart dan butuh koordinat yg valid di dalam chart.
let lastPtr={x:innerWidth/2,y:innerHeight/2};
// Apakah pointer SEDANG di atas chart. Dipisah dari lastPtr justru karena lastPtr basi by design:
// ia menyimpan posisi terakhir DI DALAM chart, jadi ia tak pernah bisa memberitahu "pointer sudah
// di luar". Instant-drop (Alt+H/V) butuh info itu — lihat instantDropPoint (Temuan 4 E2E).
let ptrOverChart=false;

// reticle preview live: penanda titik yg akan mendarat saat menggambar — tampil di SEMUA
// kondisi draw. Magnet ON → menempel ke OHLC terdekat (walau kursor jauh dari candle);
// magnet OFF / area future → mengikuti kursor persis (= titik yg akan di-drop).
const magDot=document.createElement('div'); magDot.className='mag-dot'; $('#chart').appendChild(magDot);
function hideMagDot(){ magDot.style.display='none'; }
function updateMagDot(ev){
  if(!inProgressId || cursorMode!=='dot'){ hideMagDot(); return; }   // reticle titik HANYA di cursor 'dot' (cross → cuma garis; arrow → bersih). Magnet tetap men-snap posisinya.
  const r=$('#chart').getBoundingClientRect();
  const px=ev.clientX-r.left, py=ev.clientY-r.top;
  const v=pxToValue(py); if(v==null){ hideMagDot(); return; }
  // Reticle WAJIB memakai anchor yg IDENTIK dgn titik yg akan di-commit, lalu dirender lewat
  // convertToPixel yg SAMA dgn mesin render → dijamin mendarat tepat di posisi titik sebenarnya.
  // (Kursor mentah meleset: convertToPixel(timestamp) meny-snap ke bar utk tool BAR_ANCHOR,
  // sedang tool sub-bar beranchor dataIndex pecahan/presisi. Menyatukan jalur magnet ON/OFF.)
  let anchor=null;
  if(magnetOn){
    const xa=xAnchorFromPx(px);
    if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, px, py); if(s) anchor={timestamp:s.timestamp, value:s.value}; }
  }
  if(!anchor){
    const o=chart.getOverlayById(inProgressId), name=o&&o.name;
    // name falsy (overlay tak ketemu) → jatuh ke cabang BAR_ANCHOR (perilaku lama): subBar(undefined)
    // sendiri bernilai true (bukan anggota BAR_ANCHOR), jadi name dicek eksplisit lebih dulu.
    if(name && subBar(name)){ const fa=fracAnchorFromPx(px); if(fa) anchor={dataIndex:fa.dataIndex, value:v}; }   // presisi sub-bar (fidx)
    else { const xa=xAnchorFromPx(px); if(xa) anchor=Object.assign({value:v}, xa); }                             // BAR_ANCHOR: timestamp (ikut snap render)
  }
  if(!anchor){ hideMagDot(); return; }
  const key = anchor.timestamp!=null ? {timestamp:anchor.timestamp, value:anchor.value} : {dataIndex:anchor.dataIndex, value:anchor.value};
  let cp=chart.convertToPixel(key,{paneId:'candle_pane',absolute:true}); if(Array.isArray(cp)) cp=cp[0];
  if(!cp){ hideMagDot(); return; }
  magDot.style.left=cp.x+'px'; magDot.style.top=cp.y+'px'; magDot.style.display='block';
}
$('#chart').addEventListener('mousemove',ev=>{ lastPtr={x:ev.clientX,y:ev.clientY}; ptrOverChart=true; updateMagDot(ev); });
$('#chart').addEventListener('mouseenter',()=>{ ptrOverChart=true; });
// mouseleave (bukan mouseout) → tak ikut memadamkan flag saat pointer pindah ke elemen ANAK #chart
// (reticle, legend, marker news). Pointer pindah ke panel melayang di atas chart = benar-benar
// keluar dari chart → instant-drop jatuh ke mode gambar biasa, sesuai niat yg ditulis di sana.
$('#chart').addEventListener('mouseleave',()=>{ ptrOverChart=false; hideMagDot(); });

// Text: editor inline di chart (input teks LANGSUNG di canvas, TANPA modal). Dipakai saat objek
// text/callout baru dibuat (onDrawEnd → applyTextInput) & saat klik undangan "+ Add text" pd rect/
// trendline/callout kosong (lihat onClick overlay). Modal Style/Text hanya via double-click / klik-kanan.
let textEditorEl=null;
function applyTextInput(o){ editTextOverlay(o); }   // auto-buka editor inline saat tool Text/Callout dipakai
function editTextOverlay(o){ if(!o) return;
  if(o.name==='text') openOverlayTextEditor(o,true);            // 'text': kosong = hapus
  else if(o.name==='callout') openOverlayTextEditor(o,false); } // 'callout': kosong = tetap (default "Text")
// titik overlay → pixel CLIENT (viewport), atau null bila konversi gagal.
// getBoundingClientRect() per titik → aman selama satu-satunya pemanggil overPlaceholder tetap
// onClick overlay (index.html:3251, sekali per klik); kalau ini pernah dikawat ke mousemove,
// rectBoxPx (2 titik) + getBoundingClientRect overlayTextAnchor sendiri jadi 3 forced layout/event.
function ptToClientPx(p){
  if(!p) return null;
  let px=null; try{ px=chart.convertToPixel(Object.assign(keyOf(p),{value:p.value}),{paneId:'candle_pane',absolute:true}); }catch(e){}
  if(Array.isArray(px)) px=px[0];
  if(!px) return null;
  const r=$('#chart').getBoundingClientRect();
  return {x:r.left+px.x, y:r.top+px.y};
}
// Kotak `rect` dalam pixel client: pusat + ukuran. Sudut diambil dari 2 titik berlawanan —
// TL & BR bila titiknya sudah mengembang jadi 8 (expandBox), atau 2 titik awal saat baru
// digambar. SATU sumber, dipakai bareng overlayTextAnchor & overPlaceholder: gerbang visual
// dan gerbang hit-area undangan "+ Add text" wajib sepakat soal ukuran kotak.
function rectBoxPx(o){
  const pts=(o&&o.points)||[]; if(pts.length<2) return null;
  const a=ptToClientPx(pts[0]), b=ptToClientPx(pts[pts.length>=8?4:1]); if(!a||!b) return null;
  return {cx:(a.x+b.x)/2, cy:(a.y+b.y)/2, w:Math.abs(b.x-a.x), h:Math.abs(b.y-a.y)};
}
// lokasi (client px) tempat teks dirender → editor muncul persis di situ (in-place)
function overlayTextAnchor(o){
  const rect=$('#chart').getBoundingClientRect();
  const toPx=p=>{ let px=null; try{ px=chart.convertToPixel(Object.assign(keyOf(p),{value:p.value}),{paneId:'candle_pane',absolute:true}); }catch(e){} if(Array.isArray(px)) px=px[0]; return px; };
  const pts=o.points||[];
  if(o.name==='trendline' && pts.length>=2){ const a=toPx(pts[0]), b=toPx(pts[1]); if(a&&b) return {x:rect.left+(a.x+b.x)/2, y:rect.top+(a.y+b.y)/2}; }
  // rect: tengah kotak (2 sudut berlawanan — TL & BR bila sudah 8 titik, atau 2 titik awal)
  if(o.name==='rect'){ const b=rectBoxPx(o); if(b) return {x:b.cx, y:b.cy}; }
  if(o.name==='callout' && pts.length>=2){ const b=toPx(pts[1]); if(b) return {x:rect.left+b.x, y:rect.top+b.y}; }   // pusat kotak teks (titik ke-2), bukan jangkar penunjuk
  const p=pts[0]; if(!p) return null; const px=toPx(p);
  return {x:rect.left+(px?px.x:rect.width/2), y:rect.top+(px?px.y:rect.height/2)};
}
function openOverlayTextEditor(o, removeIfEmpty){
  if(!o) return;
  const a=overlayTextAnchor(o); if(!a) return;
  const x=a.x, y=a.y;

  if(textEditorEl){ try{textEditorEl.remove();}catch(e){} textEditorEl=null; }
  const ta=document.createElement('textarea');
  ta.className='text-editor'; ta.value=o.extendData||''; ta.rows=1;
  ta.placeholder='Add text'; ta.wrap='off';   // wrap off → auto-size lebar ikut baris terpanjang
  // WYSIWYG: editor pakai font/ukuran/warna/align PERSIS seperti figure canvas yang di-render
  // (lihat createPointFigures tiap overlay) → tak ada "loncatan" gaya saat commit.
  const st=dstyle(o), name=o.name;
  const mir = name==='text'     ? { size:(st.size||13), color:(st.color||drawTextColor), lh:16, align:(st.textAlign||'left') }
            : name==='callout'  ? { size:12, color:drawTextColor, lh:15, align:'left' }
            : name==='rect'     ? { size:12, color:drawTextColor, lh:15, align:(st.textAlign||'center') }
            : name==='trendline'? { size:10, color:drawTextColor, lh:14, align:(st.textAlign||'center') }
            :                     { size:13, color:drawTextColor, lh:16, align:'left' };
  ta.style.fontFamily=AXIS_FONT;
  ta.style.fontSize=mir.size+'px';
  ta.style.lineHeight=mir.lh+'px';
  ta.style.color=mir.color;
  ta.style.textAlign=mir.align;
  // posisi in-place: samakan titik jangkar teks canvas ↔ pojok/tengah editor
  if(name==='text'){                         // baseline 'top' di titik klik → pojok kiri-atas editor di situ
    ta.style.left=Math.round(x)+'px'; ta.style.top=Math.round(y-2)+'px'; ta.style.transform='none';
  } else if(name==='callout'){               // teks rata kiri-atas di dalam kotak (pusat kotak = anchor)
    const t=(o.extendData||'')||'Add text', lines=String(t).split('\n'), lh=15, pad=6;
    const cw=Math.max(...lines.map(l=>l.length))*7+pad*2, ch=lines.length*lh+pad*2;
    ta.style.left=Math.round(x-cw/2+pad)+'px'; ta.style.top=Math.round(y-ch/2+pad)+'px'; ta.style.transform='none';
  } else {                                   // rect/trendline: teks di tengah anchor
    ta.style.left=Math.round(x)+'px'; ta.style.top=Math.round(y)+'px'; ta.style.transform='translate(-50%,-50%)';
  }
  document.body.appendChild(ta); textEditorEl=ta;
  // sembunyikan teks overlay aslinya selagi editor terbuka → tidak dobel
  editingTextId=o.id; try{chart.overrideOverlay({id:o.id,points:o.points});}catch(e){}
  ta.focus(); ta.select();

  let done=false;
  const close=(save)=>{
    if(done) return; done=true;
    try{ta.remove();}catch(e){} if(textEditorEl===ta) textEditorEl=null;
    editingTextId=null;   // tampilkan kembali teks overlay (commit di bawah akan me-render ulang)
    const fresh=(o.extendData==null||o.extendData==='');
    if(save){
      const v=ta.value;
      if(v.trim()===''){ if(removeIfEmpty){ try{chart.removeOverlay(o.id);}catch(e){} } else { try{chart.overrideOverlay({id:o.id,extendData:''});}catch(e){} } }
      else { try{chart.overrideOverlay({id:o.id,extendData:v});}catch(e){} }
      scheduleSaveDraws();
    }else if(fresh && removeIfEmpty){ try{chart.removeOverlay(o.id);}catch(e){} }  // batal saat baru (khusus Text)
    else { try{ const ov=chart.getOverlayById(o.id); if(ov) chart.overrideOverlay({id:o.id,points:ov.points}); }catch(e){} }  // batal edit: tampilkan lagi teks lama
  };
  const grow=()=>{ ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px';
    if(ta.value===''){ ta.style.width='64px'; }                              // ruang utk placeholder "Add text"
    else { ta.style.width='0px'; ta.style.width=(ta.scrollWidth+2)+'px'; } };  // ring memeluk baris terpanjang
  ta.addEventListener('input',grow); grow();
  ta.addEventListener('keydown',ev=>{
    ev.stopPropagation();                              // Enter = baris baru (perilaku textarea default)
    if(ev.key==='Escape'){ ev.preventDefault(); close(false); }
  });
  ta.addEventListener('blur',()=>close(true));         // simpan saat klik ke tempat lain
}

const DEFAULT_POS_RR = 3;  // klik tool → klik 1x di chart → posisi 1:3, lalu bisa di-adjust
// risk default = rata-rata range candle (ATR sederhana) TF aktif → ukuran selalu proporsional TF
function tfDefaultRisk(){
  const arr=revealed(currentTF), n=arr.length;
  if(n>=2){
    const k=Math.min(14,n); let sum=0;
    for(let i=n-k;i<n;i++) sum += (arr[i].high-arr[i].low);
    const avg=sum/k; if(avg>0) return avg;
  }
  return (parseFloat($('#slPips').value)||20)*(parseFloat($('#pipSize').value)||0.0001); // fallback
}
// 6 titik: 0 Entry-kiri(tengah) · 1 TP-kanan · 2 SL-kanan · 3 TP-kiri · 4 SL-kiri · 5 Entry-kanan(tengah).
// Pojok (1,2,3,4) = drag 2 arah; tengah (0,5) = horizontal saja. Level TP/SL dibaca dari pts[1]/pts[2].
function expandPosition(o){
  if(!o || (o.name!=='longPosition' && o.name!=='shortPosition')) return;
  if(!o.points || o.points.length>=6) return;          // sudah di-expand
  const p0=o.points[0]; if(!p0 || p0.value==null) return;
  // p0 WAJIB punya anchor-X valid. klinecharts kadang menaruh titik area-future TANPA anchor
  // (timestamp & dataIndex null) → keyOf(p0)={dataIndex:undefined} & tsOf(p0)=null → Lxa/Rxa jadi
  // undefined/NaN → override menaruh titik ngawur → x kolaps → garis "kelempar" ke tepi kanan.
  // Turunkan anchor dari posisi kursor terakhir (sama seperti jaring pengaman di onDrawEnd).
  if(p0.timestamp==null && (p0.dataIndex==null || !isFinite(p0.dataIndex))){
    try{ const rect=$('#chart').getBoundingClientRect(); const a=xAnchorFromPx(lastPtr.x-rect.left); if(a) Object.assign(p0,a); }catch(_){}
  }
  // [fix geser-kiri] klinecharts merender titik ber-timestamp di PUSAT BAR bawah/kiri (floor via
  // timestampToDataIndex), BUKAN sub-bar → entry meleset ke kiri hingga ~1 lebar-bar tergantung
  // posisi klik dalam bar. Snap timestamp entry ke bar TERDEKAT: entry mendarat tepat di center
  // candle terpilih (simetris, tanpa bias kiri) & durable. Titik future (dataIndex) dibiarkan presisi.
  if(p0.timestamp!=null) p0.timestamp=snapTimeToBar(p0.timestamp);
  const dir=o.name==='longPosition'?'long':'short';
  const entry=p0.value;
  const risk=tfDefaultRisk();
  const sl=dir==='long'? entry-risk : entry+risk;
  const tp=dir==='long'? entry+DEFAULT_POS_RR*risk : entry-DEFAULT_POS_RR*risk;
  // sisi kanan = 15 bar ke kanan; bila melewati candle terakhir → pakai dataIndex (area future, tak ter-clamp)
  const li=revealed(currentTF).length-1; let fL=fidxOf(p0); if(!isFinite(fL)) fL=li;
  const Lxa=(p0.timestamp!=null||p0.dataIndex!=null)?keyOf(p0):{dataIndex:fL};
  const Rxa=(fL+15>li)?{dataIndex:fL+15}:{timestamp:tsOf(p0)+15*DUR[currentTF]};
  try{ chart.overrideOverlay({ id:o.id, points:[
    Object.assign({value:entry},Lxa), Object.assign({value:tp},Rxa), Object.assign({value:sl},Rxa),
    Object.assign({value:tp},Lxa),    Object.assign({value:sl},Lxa),  Object.assign({value:entry},Rxa) ] }); }
  catch(e){ setStatus('Position expand error: '+e.message,true); }
}
// Pojok TP/SL = drag VERTIKAL saja (ubah level, lebar kotak tetap), level di-clamp tak
// melewati Entry (titik tengah). Handle tengah (Entry kiri/kanan) = HORIZONTAL saja
// (atur lebar kotak, level Entry tetap).
function posPressedMove(t){
  const pts=t.points, k=t.performPointIndex, pp=t.performPoint;
  if(!pts||pts.length<6||pp==null) return;
  // klinecharts SUDAH mengubah titik yg di-drag sebelum handler ini → baca nilai stabil
  // dari titik KEMBAR yg tak di-drag (entry di 0&5, tp di 1&3, sl di 2&4).
  const entry = (k===0)?pts[5].value : pts[0].value;
  const tpRef = (k===1)?pts[3].value : pts[1].value;
  const slRef = (k===2)?pts[4].value : pts[2].value;
  // Arah tiap level relatif Entry. Kalau referensinya PAS di Entry (sign 0) — persis yang terjadi
  // sesaat setelah sebuah level ter-clamp — jangan pakai orientasi long sebagai fallback: pada
  // shortPosition TP ada di BAWAH & SL di ATAS, jadi fallback itu membalik arah clamp dan gerakan
  // berikutnya lolos menyeberangi Entry. Turunkan dari level seberang dulu (selalu sisi lawan).
  const tpSide=Math.sign(tpRef-entry)|| -Math.sign(slRef-entry)||1;
  const slSide=Math.sign(slRef-entry)|| -Math.sign(tpRef-entry)||-1;
  const clamp=(v,side)=> side>0 ? Math.max(v,entry) : Math.min(v,entry);  // TP/SL tak boleh seberangi Entry
  let tp=tpRef, sl=slRef;
  if(k===1||k===3) tp=clamp(pp.value,tpSide);   // pojok TP: ubah level (clamp)
  if(k===2||k===4) sl=clamp(pp.value,slSide);   // pojok SL: ubah level (clamp)
  // x/lebar: HANYA handle tengah (Entry) yg boleh mengubahnya. Pojok TP/SL vertikal murni →
  // abaikan X titik yg di-drag (pp), pakai anchor stabil Entry-kiri(pts0)/Entry-kanan(pts5)
  // supaya lebar tak "mengecil/geser" walau gerakan mouse tak persis vertikal.
  let tL, tR;
  if(k===0){ tL=keyOf(pp);      tR=keyOf(pts[5]); }   // Entry-kiri: geser sisi KIRI, kanan tetap
  else if(k===5){ tL=keyOf(pts[0]); tR=keyOf(pp); }   // Entry-kanan: geser sisi KANAN, kiri tetap
  else { tL=keyOf(pts[0]);     tR=keyOf(pts[5]); }    // pojok TP/SL: lebar tetap (level saja)
  if(fidxOf(tL)>fidxOf(tR)){ const tmp=tL; tL=tR; tR=tmp; }   // jaga kiri < kanan
  pts[0]=Object.assign({value:entry}, tL);   // Entry-kiri (tengah)
  pts[1]=Object.assign({value:tp},    tR);   // TP-kanan (pojok)
  pts[2]=Object.assign({value:sl},    tR);   // SL-kanan (pojok)
  pts[3]=Object.assign({value:tp},    tL);   // TP-kiri (pojok)
  pts[4]=Object.assign({value:sl},    tL);   // SL-kiri (pojok)
  pts[5]=Object.assign({value:entry}, tR);   // Entry-kanan (tengah)
  scheduleSaveDraws();
}

// Drawing tools dikelompokkan ke kategori ala TradingView. Tiap kategori 1 ikon di rail;
// klik → flyout ke kanan berisi tool-nya. Grup `cursor:true` mengubah mode kursor (bukan overlay).
const DRAW_GROUPS=[
  {key:'cursor', title:'Cursor', cursor:true, tools:[
    {name:'cross', title:'Cross', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18"/></svg>'},
    {name:'dot', title:'Dot', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>'},
    {name:'arrow', title:'Arrow (no crosshair)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3l6 16 2-6 6-2z"/></svg>'},
    {name:'eraser', title:'Eraser (click object to delete)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 15l6-6 8 8-3 3H9zM14 5l5 5"/></svg>'},
  ]},
  {key:'trend', title:'Trend Lines', tools:[
    {name:'trendline', sc:'T', title:'Trend Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.7"/><circle cx="20" cy="4" r="1.7"/></svg>'},
    {name:'rayLine', sc:'Y', title:'Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="22" y2="2"/><circle cx="4" cy="20" r="1.7"/></svg>'},
    {name:'straightLine', sc:'E', title:'Extended Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="2" y1="22" x2="22" y2="2"/></svg>'},
    {name:'horizontalStraightLine', sc:'H', title:'Horizontal Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'horizontalRayLine', title:'Horizontal Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="12" x2="22" y2="12"/><circle cx="4" cy="12" r="1.7"/></svg>'},
    {name:'verticalStraightLine', sc:'V', title:'Vertical Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'priceLine', sc:'P', title:'Price Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="9" x2="21" y2="9" stroke-dasharray="3 3"/><path d="M3 15h10"/></svg>'},
  ]},
  {key:'channel', title:'Channels', tools:[
    {name:'parallelStraightLine', title:'Parallel Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="17" x2="21" y2="7"/><line x1="3" y1="21" x2="21" y2="11"/></svg>'},
    {name:'priceChannelLine', title:'Price Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="16" x2="21" y2="8"/><line x1="3" y1="20" x2="21" y2="12"/><line x1="3" y1="12" x2="21" y2="4"/></svg>'},
  ]},
  {key:'fib', title:'Fibonacci', tools:[
    {name:'fib3', sc:'F', title:'Fib Retracement', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>'},
    {name:'fibonacciLine', title:'Fib Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="4" y1="20" x2="20" y2="20"/></svg>'},
  ]},
  {key:'shapes', title:'Shapes', tools:[
    {name:'rect', sc:'R', title:'Rectangle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>'},
    {name:'circle', sc:'O', title:'Circle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'},
    {name:'ellipse', title:'Ellipse', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>'},
    {name:'arrow', sc:'A', title:'Arrow', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><path d="M20 4v6M20 4h-6"/></svg>'},
    {name:'arrowMarkUp', title:'Arrow Mark Up', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l6 8h-4v10h-4V11H6z"/></svg>'},
    {name:'arrowMarkDown', title:'Arrow Mark Down', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21l6-8h-4V3h-4v10H6z"/></svg>'},
  ]},
  {key:'positions', title:'Positions', tools:[
    // Long/Short monokrom: arah = siluet dominan (bukan detail mungil spt ikon lama). Dua sinyal:
    // panah naik dari lantai (long) vs turun dari langit-langit (short) + posisi baseline (bawah vs atas).
    {name:'longPosition', pos:'long', title:'Long Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20.5h16"/><path d="M12 17.5V6"/><path d="M7 11 12 6l5 5"/></svg>'},
    {name:'shortPosition', pos:'short', title:'Short Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5h16"/><path d="M12 6.5V18"/><path d="M7 13 12 18l5-5"/></svg>'},
    {name:'dateRange', title:'Date Range', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 5 V19 M18 5 V19 M9 12 h6 M9 12 l2 -2 M9 12 l2 2 M15 12 l-2 -2 M15 12 l-2 2"/></svg>'},
  ]},
  {key:'text', title:'Text', tools:[
    {name:'text', sc:'X', title:'Text', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 6 h14 M12 6 V19"/></svg>'},
    {name:'callout', title:'Callout', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 16l-2 4 6-4"/></svg>'},
    // simpleAnnotation ("Annotation") & simpleTag ("Tag") DITARIK dari rail 2026-07-27 (Temuan 3
    // E2E). Keduanya overlay BAWAAN klinecharts yang menandai semua figure-nya `ignoreEvent:true`
    // dan tak punya handle default → hit-test tak pernah kena → sekali tergambar objeknya tak bisa
    // di-hover, dipilih, di-drag, dihapus lewat klik/Delete, atau dibuka setting-nya; satu-satunya
    // jalan keluar Undo atau trash (hapus semua). Itu desain upstream untuk anotasi PROGRAMATIK,
    // bukan objek yang digambar & disunting user, jadi memakainya sebagai tool gambar salah tempat.
    // Tak diperbaiki karena keduanya redundan dengan tool yang sudah bekerja penuh:
    // simpleTag ≈ priceLine (garis + penanda harga di sumbu Y), simpleAnnotation ≈ callout /
    // arrowMarkUp-Down (teks berpointer & penanda di bar). Kalau suatu saat mau dihidupkan lagi,
    // harus didaftarkan ulang sendiri tanpa `ignoreEvent` + masuk DRAW_DEFAULT + ikut jalur editor
    // teks inline — lihat docs/e2e-drawing-findings.md (Temuan 3). Dijaga oleh test di
    // tests/drawing/50-rail.spec.js agar tak diam-diam kembali.
  ]},
];
const TRASH_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>';
