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

