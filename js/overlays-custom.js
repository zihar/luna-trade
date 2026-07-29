// ===================== custom overlay: rectangle/zona =====================
klinecharts.registerOverlay({
  name:'rect', totalStep:3, needDefaultPointFigure:true,
  performEventPressedMove:boxPressedMove,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates);
    const xs=C.map(c=>c.x), ys=C.map(c=>c.y);
    const x=Math.min(...xs), y=Math.min(...ys), w=Math.max(...xs)-x, h=Math.max(...ys)-y;
    const st=dstyle(overlay);
    const rl=lsLine(st);
    const figs=[{ type:'rect', attrs:{x,y,width:w,height:h},
      styles:{ style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:rl.style, borderDashedValue:rl.dashedValue||[2,2] } }];
    const raw=overlay&&overlay.extendData, t=(raw!=null?String(raw):'');    // teks opsional → posisi via textAlign/textValign
    if(t!==''){ const ha=st.textAlign||'center', va=st.textValign||'middle', pad=4, lines=t.split('\n'), lh=15;
      const cx = ha==='left' ? x+pad : ha==='right' ? x+w-pad : x+w/2;
      const cyTop = va==='top' ? y+pad : va==='bottom' ? y+h-pad-(lines.length-1)*lh : (y+h/2)-(lines.length-1)*lh/2;
      lines.forEach((ln,i)=>figs.push({type:'text',attrs:{x:cx,y:cyTop+i*lh,text:ln,align:ha,baseline:va},
        styles:{color:drawTextColor,size:12,family:AXIS_FONT,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}})); }
    else if(showAddTextHint(overlay) && w>=ADDTEXT_MIN_W && h>=ADDTEXT_MIN_H)    // kosong + hover/terpilih & kotak sanggup memuat label → undangan "+ Add text" menyatu di tengah (ala TradingView); kotak kecil dibiarkan bersih
      figs.push({type:'text',attrs:{x:x+w/2,y:y+h/2,text:'+ Add text',align:'center',baseline:'middle'},
        styles:{color:drawTextMuted,size:12,family:AXIS_FONT,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}});
    return figs;
  }
});

// ===================== custom overlay: circle (pusat → tepi) =====================
klinecharts.registerOverlay({
  name:'circle', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1];
    const r=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); const st=dstyle(overlay); const rl=lsLine(st);
    return [{type:'circle', attrs:{x:a.x,y:a.y,r},
      styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:rl.style, borderDashedValue:rl.dashedValue||[2,2]}}];
  }
});
// ===================== custom overlay: ellipse (bounding box 2 sudut) =====================
klinecharts.registerOverlay({
  name:'ellipse', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates); const xs=C.map(c=>c.x), ys=C.map(c=>c.y);
    const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2;
    const rx=Math.abs(xs[1]-xs[0])/2, ry=Math.abs(ys[1]-ys[0])/2;
    const st=dstyle(overlay); const rl=lsLine(st);
    const pts=[]; const N=48; for(let i=0;i<=N;i++){ const t=i/N*2*Math.PI; pts.push({x:cx+rx*Math.cos(t), y:cy+ry*Math.sin(t)}); }
    return [{type:'polygon', attrs:{coordinates:pts},
      styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:rl.style, borderDashedValue:rl.dashedValue||[2,2]}}];
  }
});
// ===================== custom overlay: arrow (pangkal → ujung, dgn kepala) =====================
klinecharts.registerOverlay({
  name:'arrow', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1]; const st=dstyle(overlay); const ls=lsLine(st);
    const ang=Math.atan2(b.y-a.y,b.x-a.x), hl=Math.max(10,st.size*6), spread=Math.PI/7;
    const h1={x:b.x-hl*Math.cos(ang-spread), y:b.y-hl*Math.sin(ang-spread)};
    const h2={x:b.x-hl*Math.cos(ang+spread), y:b.y-hl*Math.sin(ang+spread)};
    const line=Object.assign({color:st.color,size:st.size},ls);
    return [
      {type:'line', attrs:{coordinates:[a,b]}, styles:line},
      {type:'line', attrs:{coordinates:[h1,b]}, styles:line},
      {type:'line', attrs:{coordinates:[h2,b]}, styles:line},
    ];
  }
});
// ===================== custom overlay: callout (anchor → kotak teks + penunjuk) =====================
klinecharts.registerOverlay({
  name:'callout', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1]; const st=dstyle(overlay); const ls=lsLine(st);
    const raw=(overlay&&overlay.extendData)? String(overlay.extendData):'';
    const empty=(raw===''), t = empty ? 'Add text' : raw;   // kosong → placeholder muted, bukan teks literal
    const lines=t.split('\n'), lh=15, pad=6, cw=Math.max(...lines.map(l=>l.length))*7+pad*2, ch=lines.length*lh+pad*2;
    const bx=b.x-cw/2, by=b.y-ch/2;
    const figs=[
      {type:'line', attrs:{coordinates:[a,{x:b.x,y:b.y}]}, styles:Object.assign({color:st.color,size:st.size},ls)},
      {type:'rect', attrs:{x:bx,y:by,width:cw,height:ch}, styles:{style:'stroke_fill', color:'rgba(74,113,255,0.10)', borderColor:st.color, borderSize:st.size, borderStyle:ls.style}},
    ];
    if(overlay.id===editingTextId) return figs;   // sedang diedit → teks dirender oleh editor (kotak+penunjuk tetap tampil)
    lines.forEach((ln,i)=>figs.push({type:'text', attrs:{x:bx+pad,y:by+pad+i*lh, text:ln, align:'left', baseline:'top'},
      styles:{color:(empty?drawTextMuted:drawTextColor),size:12,family:AXIS_FONT,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}}));
    return figs;
  }
});

// ===================== custom overlay: arrow mark up / down (marker 1-klik, ukuran tetap) =====================
// Silhouette panah berukuran pixel-tetap di titik klik (anchor = ujung/tip panah).
function arrowMarkFigures(dir){ // dir: -1 = up (tip di atas), +1 = down (tip di bawah)
  return ({overlay,coordinates})=>{
    if(!coordinates.length) return [];
    const p=subBarCoords(overlay,coordinates)[0]; const st=dstyle(overlay);
    const H=22, hh=10, hw=7, sw=3;          // tinggi total, tinggi kepala, ½ lebar kepala, ½ lebar batang
    const x=p.x, y=p.y, d=dir;               // tip di (x,y); tumbuh ke arah -d
    const pts=[
      {x:x,      y:y},                        // tip
      {x:x+hw,   y:y-d*hh},                   // bahu kanan
      {x:x+sw,   y:y-d*hh},                   // dalam kanan
      {x:x+sw,   y:y-d*H},                    // bawah kanan
      {x:x-sw,   y:y-d*H},                    // bawah kiri
      {x:x-sw,   y:y-d*hh},                   // dalam kiri
      {x:x-hw,   y:y-d*hh},                   // bahu kiri
    ];
    return [{type:'polygon', attrs:{coordinates:pts}, styles:{style:'fill', color:st.color}}];
  };
}
klinecharts.registerOverlay({ name:'arrowMarkUp',   totalStep:2, needDefaultPointFigure:true, createPointFigures:arrowMarkFigures(-1) });
klinecharts.registerOverlay({ name:'arrowMarkDown', totalStep:2, needDefaultPointFigure:true, createPointFigures:arrowMarkFigures(+1) });

// state drag presisi (intercept onPressedMoving di delHooks; klinecharts default meng-snap ke bar).
// Berlaku untuk SEMUA tool sub-bar, bukan cuma trendline — karena itu namanya bukan tlDrag lagi.
let dragBase=null;
// custom overlay: Trendline (2 titik) dengan teks opsional — klik 2× utk edit
klinecharts.registerOverlay({
  name:'trendline', totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates);    // render via interpolasi sub-bar
    const a=C[0], b=C[1];
    const st=dstyle(overlay);
    const figs=[{type:'line',attrs:{coordinates:[a,b]},styles:Object.assign({color:st.color,size:st.size},lsLine(st))}];
    const raw=overlay&&overlay.extendData, t=(raw!=null?String(raw):'');
    if(t!==''){ const ha=st.textAlign||'center', va=st.textValign||'top', off=4;
      const px = ha==='left' ? a.x : ha==='right' ? b.x : (a.x+b.x)/2;
      const py = ha==='left' ? a.y : ha==='right' ? b.y : (a.y+b.y)/2;
      const ty = va==='top' ? py-off : va==='bottom' ? py+off : py;
      const bl = va==='top' ? 'bottom' : va==='bottom' ? 'top' : 'middle';
      figs.push({type:'text',attrs:{x:px,y:ty,text:t,align:ha,baseline:bl},
        styles:{color:drawTextColor,size:10,family:AXIS_FONT,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}}); }
    else if(showAddTextHint(overlay))    // kosong + hover/terpilih → "Add text" muted DI GARIS (bisa diklik utk input inline)
      figs.push({type:'text',attrs:{x:(a.x+b.x)/2,y:(a.y+b.y)/2,text:'Add text',align:'center',baseline:'middle'},
        styles:{color:drawTextMuted,size:10,family:AXIS_FONT,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}});
    // Selama MENGGAMBAR tak ada buletan handle sama sekali (default disembunyikan via HIDDEN_POINT).
    // Buletan hanya muncul saat objek yg SUDAH JADI di-hover/pilih (handle default dikembalikan di onDrawEnd).
    return figs;
  },
});

// garis horizontal/vertikal: override bawaan klinecharts agar penanda harga (axis Y) &
// penanda waktu (axis X) SELALU tampil — bukan cuma saat garis terpilih. Bawaan klinecharts
// meng-gate "default axis figure" ke overlay yang sedang aktif; di sini kita render lewat
// createY/XAxisFigures yang TIDAK ter-gate, jadi tag selalu nempel di axis.
function axisTagColor(o){ return (o&&o.styles&&o.styles.line&&o.styles.line.color)||'#4a71ff'; }
// pill tanggal di sumbu X — desain seragam persis label hover crosshair (crosshairDate +
// chTextStyle: Inter 10px bold, radius 4, padding 6/3). Background ikut warna objek (axisTagColor),
// bukan biru fixed spt hover. Dipakai semua overlay berbasis waktu (vertical line, date range).
function xDateFig(x, ts, overlay){ return {type:'text', ignoreEvent:true,
  attrs:{x, y:0, text:crosshairDate(ts), align:'center'},
  styles:{color:'#fff', backgroundColor:axisTagColor(overlay), borderColor:'rgba(0,0,0,0)',
    size:10, family:AXIS_FONT, weight:'bold', borderRadius:4,
    paddingLeft:6, paddingRight:6, paddingTop:3, paddingBottom:3}}; }
klinecharts.registerOverlay({
  name:'horizontalStraightLine', totalStep:2, needDefaultPointFigure:true,
  needDefaultXAxisFigure:false, needDefaultYAxisFigure:false,  // tag harga (Y) kita render sendiri; tanggal (X) tak perlu utk garis horizontal
  createPointFigures:({coordinates,bounding})=>{ const cy=coordinates[0].y; return [
    // grab-zone transparan ±6px (hit-test garis bawaan cuma ±2px → nyaris tak bisa diklik/dihapus)
    {type:'rect', attrs:{x:0,y:cy-6,width:bounding.width,height:12}, styles:{style:'fill',color:'rgba(0,0,0,0)',borderColor:'rgba(0,0,0,0)'}},
    {type:'line', attrs:{coordinates:[{x:0,y:cy},{x:bounding.width,y:cy}]}} ]; },
  createYAxisFigures:({overlay,coordinates,bounding,yAxis})=>{
    const c=coordinates[0], p=overlay.points[0]; if(!c||!p||p.value==null) return [];
    const fromZero = yAxis&&yAxis.isFromZero&&yAxis.isFromZero();
    // tag harga disamakan dgn gaya halus label hover crosshair: styling chTextStyle
    // (Inter 10px bold, radius 4, padding 6/3). Background tetap ikut warna garis
    // (axisTagColor), bukan biru fixed spt hover — mirror fix garis vertikal.
    return [{type:'text', ignoreEvent:true,
      attrs:{x:fromZero?0:bounding.width, y:c.y, text:fmtPx(p.value), align:fromZero?'left':'right', baseline:'middle'},
      styles:{color:'#fff', backgroundColor:axisTagColor(overlay), borderColor:'rgba(0,0,0,0)',
        size:10, family:AXIS_FONT, weight:'bold', borderRadius:4,
        paddingLeft:6, paddingRight:6, paddingTop:3, paddingBottom:3}}];
  }
});
klinecharts.registerOverlay({
  name:'verticalStraightLine', totalStep:2, needDefaultPointFigure:true,
  needDefaultXAxisFigure:false, needDefaultYAxisFigure:false,  // tag waktu (X) kita render sendiri & selalu; price (Y) tak perlu utk garis vertikal
  createPointFigures:({coordinates,bounding})=>{ const cx=coordinates[0].x; return [
    // grab-zone transparan ±6px (hit-test garis bawaan cuma ±2px → nyaris tak bisa diklik/dihapus)
    {type:'rect', attrs:{x:cx-6,y:0,width:12,height:bounding.height}, styles:{style:'fill',color:'rgba(0,0,0,0)',borderColor:'rgba(0,0,0,0)'}},
    {type:'line', attrs:{coordinates:[{x:cx,y:0},{x:cx,y:bounding.height}]}} ]; },
  createXAxisFigures:({overlay,coordinates})=>{
    const c=coordinates[0], p=overlay.points[0], ts=tsOf(p); if(!c||!p||ts==null) return [];
    return [xDateFig(c.x, ts, overlay)];   // pill tanggal seragam ala hover crosshair
  }
});

// custom overlay: Fibonacci 0 · 0.5 · 1 (lebar = selebar tarikan, arah ikut tarik)
// level Fibonacci yang bisa diatur (tambah/hapus/ubah nilai) — global, tersimpan di localStorage
const FIB_DEFAULT=[0,0.5,1];
// warna per-level ala TradingView (level umum di-map; lainnya pakai palet berputar) — dipakai sbg warna default
const FIB_COLORS={0:'#787b86',0.236:'#f23645',0.382:'#ff9800',0.5:'#4caf50',0.618:'#089981',0.786:'#00bcd4',1:'#787b86',1.272:'#f23645',1.414:'#ff9800',1.618:'#4caf50',2:'#787b86',2.618:'#089981'};
const FIB_PALETTE=['#787b86','#f23645','#ff9800','#4caf50','#089981','#00bcd4','#2962ff','#9c27b0'];
function fibColor(Lv,i){ return FIB_COLORS[Lv]!=null?FIB_COLORS[Lv]:FIB_PALETTE[i%FIB_PALETTE.length]; }
// tiap level: {value, color}. color bisa diatur user; default ikut fibColor()
function defaultFibLevels(){ return FIB_DEFAULT.map((v,i)=>({value:v,color:fibColor(v,i)})); }
let fibLevels;
try{
  const raw=JSON.parse(localStorage.getItem('br_fibLevels'));
  if(!Array.isArray(raw)||!raw.length) fibLevels=defaultFibLevels();
  // migrasi skema lama (array angka) → array objek {value,color}
  else fibLevels=raw.map((it,i)=> (typeof it==='number') ? {value:it,color:fibColor(it,i)} : {value:+it.value,color:it.color||fibColor(+it.value,i)});
}catch(e){ fibLevels=defaultFibLevels(); }
function redrawFibs(){ drawIds.forEach(id=>{ try{ const o=chart.getOverlayById(id); if(o&&o.name==='fib3') chart.overrideOverlay({id,points:o.points}); }catch(e){} }); }
function saveFibLevels(){ try{localStorage.setItem('br_fibLevels',JSON.stringify(fibLevels));}catch(e){} redrawFibs(); }
// background isian antar level: default MATI; bisa diaktifkan + atur transparansi (opacity %) via editor
let fibBg;
try{ const raw=JSON.parse(localStorage.getItem('br_fibBg')); fibBg=(raw&&typeof raw==='object')?{on:!!raw.on,opacity:Math.max(0,Math.min(100,(+raw.opacity||12)))}:{on:false,opacity:12}; }
catch(e){ fibBg={on:false,opacity:12}; }
function saveFibBg(){ try{localStorage.setItem('br_fibBg',JSON.stringify(fibBg));}catch(e){} redrawFibs(); }
function alphaHex(pct){ const a=Math.max(0,Math.min(255,Math.round(pct/100*255))); return a.toString(16).padStart(2,'0'); }

// hitung posisi y, harga & warna tiap level fib (urut atas→bawah) + batas x
function fibRowsOf(overlay,coordinates){
  const C=subBarCoords(overlay,coordinates);
  const xs=C.map(c=>c.x), ys=C.map(c=>c.y);
  const xL=Math.min(...xs), xR=Math.max(...xs), yTop=Math.min(...ys), yBot=Math.max(...ys);
  const vals=overlay.points.map(p=>p.value).filter(v=>v!=null);
  if(vals.length<2) return null;
  const vTop=Math.max(...vals), vBot=Math.min(...vals);
  // arah: dari extendData bila sudah final (box 8-titik); saat preview (2 titik, extendData belum ada)
  // turunkan langsung dari tarikan → 0% di titik akhir, sama spt hasil final (anti-flip saat klik).
  let zeroTop;
  if(overlay.extendData && overlay.extendData.zeroTop!=null){ zeroTop = overlay.extendData.zeroTop!==false; }
  else { const p0=overlay.points[0], p1=overlay.points[1];
    zeroTop = (p0&&p1&&p0.value!=null&&p1.value!=null) ? (p1.value>=p0.value) : true; }
  const rows=fibLevels.map((lv,i)=>{
    const Lv=lv.value;
    const f = zeroTop ? Lv : (1-Lv);                 // 0 di atas / di bawah sesuai arah tarik
    return { Lv, y: yTop+(yBot-yTop)*f, price: vTop+(vBot-vTop)*f, color: lv.color||fibColor(Lv,i) };
  }).sort((a,b)=>a.y-b.y);
  return {rows,xL,xR};
}
klinecharts.registerOverlay({
  name:'fib3', totalStep:3, needDefaultPointFigure:true,
  needDefaultYAxisFigure:false,   // penanda harga (Y) kita render sendiri, hanya saat aktif
  performEventPressedMove:boxPressedMove,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const R=fibRowsOf(overlay,coordinates); if(!R) return [];
    const {rows,xL,xR}=R;
    const st=dstyle(overlay);
    const figs=[];
    // background terisi antar level (warna = level batas atasnya) — default mati, opacity diatur di editor
    if(fibBg.on){ const ah=alphaHex(fibBg.opacity);
      for(let i=0;i<rows.length-1;i++){
        figs.push({type:'rect',attrs:{x:xL,y:rows[i].y,width:xR-xL,height:rows[i+1].y-rows[i].y},styles:{style:'fill',color:rows[i].color+ah,borderColor:'transparent'}});
      }
    }
    // garis + label persentase (harga dihilangkan dari garis → muncul di sumbu Y saat aktif)
    // persentase ditaruh di pinggir kiri & sejajar tengah garis (bukan di atas garis)
    rows.forEach(r=>{
      figs.push({type:'line',attrs:{coordinates:[{x:xL,y:r.y},{x:xR,y:r.y}]},styles:Object.assign({color:r.color,size:st.size},lsLine(st))});
      // angka persen: SEMUA rata-kanan di sisi kiri garis (di luar/kiri titik jangkar xL) →
      // seragam untuk semua level & tak pernah tumpang-tindih dgn buletan handle.
      figs.push({type:'text',attrs:{x:xL-5,y:r.y,text:(r.Lv*100).toFixed(2)+'%',align:'right',baseline:'middle'},styles:{color:r.color,size:10,backgroundColor:'transparent',borderColor:'transparent',paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0}});
    });
    return figs;
  },
  // penanda harga di sumbu Y untuk tiap level — hanya saat fib aktif (terpilih/hover)
  createYAxisFigures:({overlay,coordinates,bounding,yAxis})=>{
    if(coordinates.length<2) return [];
    if(overlay.id!==selectedId && overlay.id!==hoverId) return [];
    const R=fibRowsOf(overlay,coordinates); if(!R) return [];
    const fromZero = yAxis&&yAxis.isFromZero&&yAxis.isFromZero();
    return R.rows.map(r=>({type:'text', ignoreEvent:true,
      attrs:{x:fromZero?0:bounding.width, y:r.y, text:fmtPx(r.price), align:fromZero?'left':'right', baseline:'middle'},
      styles:{color:'#fff', backgroundColor:r.color, borderColor:'rgba(0,0,0,0)'}}));
  }
});

// custom overlay: Long / Short position (ala TV) — 3 titik independen: Entry, TP, SL.
// TP & SL bisa di-drag sendiri-sendiri; RR dihitung live dari jaraknya.
// Warna ala TradingView untuk position tool
const POS_GREEN='#089981', POS_RED='#f23645', POS_GBG='rgba(8,153,129,0.12)', POS_RBG='rgba(242,54,69,0.12)';
function posFigures(dir){
  return ({overlay,coordinates,bounding})=>{
    const pts=overlay.points;
    if(!coordinates.length||pts[0].value==null) return [];
    const dec=priceDecimals();
    const pip=parseFloat(document.getElementById('pipSize').value)||0.0001;
    // mintick utk hitung jumlah tick: emas (XAU) pakai 0.01 spt TV (TV emas 2 desimal,
    // Luna 3) → tick tak 10× lebih banyak; instrumen lain pakai 10^-desimal.
    const tkSize = inst.includes('XAU') ? 0.01 : Math.pow(10,-dec);
    const tickN=d=>Math.round(d/tkSize);
    const C=subBarCoords(overlay,coordinates);
    const xs=C.map(c=>c.x).filter(x=>x!=null&&isFinite(x));
    if(!xs.length) return [];   // semua koordinat-X invalid (transient klinecharts) → skip frame, jangan gambar sampah
    let xL=Math.min(...xs), xR=Math.max(...xs);
    // Koordinat-X kolaps ke 1 titik (fase 1-titik / transient anchor rusak) → lebar default KECIL.
    // Dulu memakai bounding.width → box/garis "kelempar" membentang sampai tepi kanan chart (bug intermittent draw long).
    if(xR<=xL) xR=xL+160;
    // warna & transparansi zona per objek (default = konstanta global lama)
    const st=dstyle(overlay);
    const tgtColor=st.tgtColor||POS_GREEN, stopColor=st.stopColor||POS_RED;
    const tgtFill=tgtColor+alphaHex(st.tgtAlpha!=null?st.tgtAlpha:12);
    const stopFill=stopColor+alphaHex(st.stopAlpha!=null?st.stopAlpha:12);
    const F=[];
    const line=(y,c)=>F.push({type:'line',attrs:{coordinates:[{x:xL,y},{x:xR,y}]},styles:{color:c,size:1}});
    const box =(y1,y2,c)=>F.push({type:'rect',attrs:{x:xL,y:Math.min(y1,y2),width:xR-xL,height:Math.abs(y2-y1)},styles:{style:'fill',color:c}});
    // Teks pill & handle hanya tampil saat posisi DIPILIH (klik) atau di-HOVER; selain itu hilang
    // (cuma body + garis Entry yang tersisa). posRerender() di hook select/hover memaksa toggle.
    const showH = (overlay.id===selectedId || overlay.id===hoverId);
    // pill ala TV: teks putih + background berwarna + sudut membulat
    const pill=(x,y,text,bg,align,baseline)=>{ if(showH) F.push({type:'text',attrs:{x,y,text,align:align||'left',baseline:baseline||'middle'},
      styles:{color:'#ffffff',size:10,family:AXIS_FONT,paddingLeft:6,paddingRight:6,paddingTop:3,paddingBottom:3,borderRadius:3,backgroundColor:bg,borderColor:'transparent'}}); };
    const handle=(x,y)=>{ if(showH) F.push({type:'rect',attrs:{x:x-5,y:y-5,width:10,height:10},styles:{style:'stroke_fill',color:'#ffffff',borderColor:'rgba(0,0,0,0.35)',borderSize:1.5,borderRadius:3}}); };

    const entry=pts[0].value, yE=C[0].y;
    const haveTP = pts.length>1 && pts[1] && pts[1].value!=null && coordinates.length>1;
    const haveSL = pts.length>2 && pts[2] && pts[2].value!=null && coordinates.length>2;
    if(!haveTP){ line(yE,'#9aa4b2'); pill(xL,yE,'Entry '+entry.toFixed(dec),'rgba(20,28,40,0.92)'); handle(C[0].x,yE); return F; }

    const tp=pts[1].value, yT=C[1].y;
    const tpPips=Math.round(Math.abs(tp-entry)/pip), tpPct=(Math.abs(tp-entry)/entry*100);
    box(yE,yT,tgtFill); line(yE,'#9aa4b2');   // body target + garis Entry (garis TP atas dihapus)
    const tBase=yT<=yE?'bottom':'top', tY=yT<=yE?yT-2:yT+2;
    pill(xL, tY, 'Target  '+tp.toFixed(dec)+'   '+tpPips+'p · '+tickN(Math.abs(tp-entry))+'t ('+tpPct.toFixed(3)+'%)', tgtColor, 'left', tBase);

    if(haveSL){
      const sl=pts[2].value, yS=C[2].y;
      const slPips=Math.round(Math.abs(entry-sl)/pip), slPct=(Math.abs(entry-sl)/entry*100);
      const rr=Math.abs(entry-sl)?(Math.abs(tp-entry)/Math.abs(entry-sl)):0;
      box(yE,yS,stopFill);   // body stop (garis SL bawah dihapus)
      const sBase=yS<=yE?'bottom':'top', sY=yS<=yE?yS-2:yS+2;
      pill(xL, sY, 'Stop  '+sl.toFixed(dec)+'   '+slPips+'p · '+tickN(Math.abs(entry-sl))+'t ('+slPct.toFixed(3)+'%)', stopColor, 'left', sBase);
      pill((xL+xR)/2, yE, dir.toUpperCase()+'   ·   RR 1:'+rr.toFixed(2), 'rgba(20,28,40,0.92)', 'center', 'middle');
    } else {
      pill(xL, yE, 'Entry '+entry.toFixed(dec)+'  ['+dir.toUpperCase()+']', 'rgba(20,28,40,0.92)', 'left', 'middle');
    }
    C.forEach(c=>handle(c.x,c.y));   // handle di tiap titik draggable
    return F;
  };
}
// totalStep:2 → cukup 1 klik untuk menaruh entry; TP & SL ditambah otomatis (lihat expandPosition)
// posPressedMove DIBUNGKUS, jangan diserahkan sebagai nilai: deklarasinya ~2.400 baris di bawah
// sini, jadi hari ini hanya tertahan hoisting satu blok inline. Begitu wilayah drawing pindah ke
// <script src> sendiri, nilainya jadi `undefined` saat registrasi & drag posisi mati TANPA error.
// Pembungkus ini memindahkan resolusi ke saat DIPANGGIL (user men-drag), ketika semua script
// sudah termuat — lihat docs/superpowers/plans/2026-07-28-split-index-js-chunks-800.md.
// Dijaga tests/drawing/32-position-handles.spec.js (tanpa handler terpasang: 6/6 merah).
klinecharts.registerOverlay({name:'longPosition', totalStep:2, needDefaultPointFigure:true, performEventPressedMove:(...a)=>posPressedMove(...a), createPointFigures:posFigures('long')});
klinecharts.registerOverlay({name:'shortPosition',totalStep:2, needDefaultPointFigure:true, performEventPressedMove:(...a)=>posPressedMove(...a), createPointFigures:posFigures('short')});

// custom overlay: Text bebas — 1 klik taruh titik, lalu modal Style/Text tab Text (lihat applyTextInput)
let drawTextColor='#e8edf2';   // diperbarui oleh applyTheme agar kontras di light/dark
let drawTextMuted='#89898b';   // warna placeholder (callout kosong) — ikut tema (= --muted)
let editingTextId=null;        // id overlay teks yg sedang diedit → jangan dirender (cegah dobel dgn editor)
klinecharts.registerOverlay({
  name:'text', totalStep:2, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates})=>{
    if(!coordinates.length) return [];
    if(overlay.id===editingTextId) return [];   // sedang diedit → teks dirender oleh editor, jangan dobel
    const t=overlay.extendData;
    if(t==null||t==='') return [];
    const C=subBarCoords(overlay,coordinates), x=C[0].x, y0=C[0].y, lh=16;
    const st=dstyle(overlay);
    const lines=String(t).split('\n');
    const ha=st.textAlign||'left', va=st.textValign||'top';
    const yTop = va==='top' ? y0 : va==='bottom' ? y0-(lines.length-1)*lh : y0-(lines.length-1)*lh/2;
    return lines.map((ln,i)=>({ type:'text',
      attrs:{x, y:yTop+i*lh, text:ln, align:ha, baseline:va},
      styles:{color:(st.color||drawTextColor), size:(st.size||13), family:AXIS_FONT, backgroundColor:'transparent', borderColor:'transparent',
              paddingLeft:0, paddingRight:0, paddingTop:0, paddingBottom:0} }));
  }
});

// custom overlay: Date Range — 2 klik, kotak vertikal + label jumlah bar & durasi (ala TV)
function fmtDur(ms){
  const m=Math.round(ms/6e4);
  if(m<60) return m+'m';
  const h=Math.floor(m/60), mm=m%60;
  if(h<24) return mm? h+'j '+mm+'m' : h+'j';
  const d=Math.floor(h/24), hh=h%24;
  return hh? d+'h '+hh+'j' : d+'h';
}
// jumlah bar antara 2 timestamp = selisih indeks candle di data (akurat thd gap weekend)
function barsBetween(t0,t1){
  const arr=tfData[currentTF];
  if(!arr||!arr.length) return Math.round(barStepsFrom(currentTF, Math.min(t0,t1), Math.max(t0,t1)));
  const bs=(t)=>{let a=0,b=arr.length;while(a<b){const m=(a+b)>>1; if(arr[m].timestamp<t) a=m+1; else b=m;} return a;};
  return Math.abs(bs(Math.max(t0,t1))-bs(Math.min(t0,t1)));
}
klinecharts.registerOverlay({
  name:'dateRange', totalStep:3, needDefaultPointFigure:true,
  // tanggal di sumbu X kita render sendiri (createXAxisFigures) dgn pill seragam ala hover crosshair,
  // bukan default figure klinecharts yg polos → needDefaultXAxisFigure tetap false.
  createXAxisFigures:({overlay,coordinates})=>{
    if(overlay.id!==selectedId && overlay.id!==hoverId) return [];   // tampil saat terpilih/hover (spt sebelumnya)
    const figs=[];
    coordinates.forEach((c,i)=>{ const ts=tsOf(overlay.points[i]); if(c&&ts!=null) figs.push(xDateFig(c.x, ts, overlay)); });
    return figs;
  },
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates);
    const a=C[0], b=C[1];
    // garis utama + panah di ujung b
    const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L;
    const s=10, c=Math.cos(.42), sn=Math.sin(.42);
    const w1x=b.x-s*(ux*c-uy*sn), w1y=b.y-s*(ux*sn+uy*c);
    const w2x=b.x-s*(ux*c+uy*sn), w2y=b.y-s*(-ux*sn+uy*c);
    const st=dstyle(overlay);
    const figs=[
      {type:'line',attrs:{coordinates:[a,b]},styles:Object.assign({color:st.color,size:st.size},lsLine(st))},
      {type:'line',attrs:{coordinates:[b,{x:w1x,y:w1y}]},styles:{color:st.color,size:st.size}},
      {type:'line',attrs:{coordinates:[b,{x:w2x,y:w2y}]},styles:{color:st.color,size:st.size}},
    ];
    const t0=tsOf(overlay.points[0]), t1=tsOf(overlay.points[1]);
    if(t0!=null&&t1!=null){
      const bars=barsBetween(t0,t1);
      // Durasi = rentang NYATA antar kedua titik, bukan bars × DUR: untuk MN yang panjang barnya
      // 28–31 hari, mengalikan rata-rata 30,44 hari memberi angka yang tak pernah benar.
      const label=bars+' bar · '+fmtDur(Math.abs(t1-t0));
      const cx=(a.x+b.x)/2, cy=Math.max(a.y,b.y)+16, w=label.length*6.4+14;
      figs.push({type:'rect',attrs:{x:cx-w/2,y:cy-9,width:w,height:18},styles:{style:'fill',color:'#4a71ff'}});
      figs.push({type:'text',attrs:{x:cx,y:cy,text:label,align:'center',baseline:'middle'},styles:{color:'#fff',size:11}});
    }
    return figs;
  }
});

// custom overlay: garis level trade (Entry/SL/TP) + label price & $/% (ala TradeLocker)
klinecharts.registerOverlay({
  name:'tradeLevel', totalStep:2, needDefaultPointFigure:true,
  createPointFigures:({overlay,coordinates,bounding})=>{
    if(!coordinates.length) return [];
    const y=coordinates[0].y, d=overlay.extendData||{}, c=d.color||'#888', lc=d.lineColor||c;
    const xR=(bounding&&bounding.width)?bounding.width:600;
    const figs=[{type:'line',attrs:{coordinates:[{x:0,y},{x:xR,y}]},styles:{color:lc,size:1,style:'dashed'}}];
    // posisi paper: pill/label/tombol dirender sbg node DOM (#posLayer) → di sini cukup garis + sinkron posisi Y
    if(d.posId!=null){ if(d.kind) syncPosNodeY(d.posId,d.kind,y,bounding&&bounding.height); return figs; }
    // garis draft tiket order (SL/TP sebelum posisi): label = chip DOM (#posLayer), desain sama dgn posisi
    if(d.draftKind){ syncDraftNodeY(d.draftKind,y,bounding&&bounding.height); return figs; }
    // garis draft tiket order (entry/SL/TP): teks tetap digambar di canvas spt semula
    if(d.pill){   // pill terisi (kotak kecil ujung kiri)
      figs.push({type:'text',attrs:{x:4,y,text:d.label||'',align:'left',baseline:'middle'},
        styles:{color:'#0e0f14',backgroundColor:c,size:10,weight:'bold',borderRadius:4,
                paddingLeft:7,paddingRight:7,paddingTop:3,paddingBottom:3}});
    } else {
      figs.push({type:'text',attrs:{x:6,y:y-3,text:d.label||'',align:'left',baseline:'bottom'},styles:{color:c,size:10}});
    }
    return figs;
  },
});

