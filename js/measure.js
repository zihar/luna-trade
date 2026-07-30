// ===================== Measure tool (ruler) — ephemeral =====================
// Alat ukur sekali pakai: memberi angka lalu hilang, tanpa meninggalkan objek. Beda dari semua
// tool gambar lain, ia TIDAK masuk PERSIST_DRAW & tidak mencemari history undo.
// Rancangan: docs/superpowers/specs/2026-07-31-measure-tool-design.md

// Statistik murni dari dua titik overlay. null bila salah satu titik belum punya harga atau waktu
// (mis. titik di area future tanpa data) → pemanggil menggambar kotak TANPA pill, bukan NaN.
function measureStats(p0, p1){
  if(!p0 || !p1 || p0.value==null || p1.value==null) return null;
  const t0=tsOf(p0), t1=tsOf(p1);
  if(t0==null || t1==null) return null;
  const dPrice=p1.value-p0.value;
  const dPct = p0.value ? dPrice/p0.value*100 : 0;
  // pip HANYA untuk instrumen yang speknya kita punya. Untuk saham (STOCK:…) instSpec() jatuh ke
  // input #pipSize dan akan mencetak "pip" yang tak punya arti di sana.
  const spec = INSTRUMENT[inst];
  const dPips = spec ? Math.abs(dPrice)/spec.pip : null;
  // bar dihitung di ruang INDEKS, jadi gap akhir pekan otomatis tak terhitung.
  const bars = Math.round(Math.abs(fidxOf(p1)-fidxOf(p0)));
  // durasi = rentang wall-clock NYATA, bukan bars × DUR (alasan sama dgn dateRange di
  // js/overlays-custom.js: bar MN panjangnya 28–31 hari, rata-rata tak pernah benar).
  return {dPrice, dPct, dPips, bars, ms:Math.abs(t1-t0)};
}
// [line1, line2] siap dirender. Teks Inggris (aturan CLAUDE.md).
function fmtMeasure(st){
  if(!st) return null;
  const p=fmtFor(inst, st.dPrice);
  const priceTxt = st.dPrice>=0 ? '+'+p : p;                       // fmtFor sudah membawa '-'
  const pctTxt = (st.dPct>=0?'+':'')+st.dPct.toFixed(2)+'%';
  const pipTxt = st.dPips!=null ? ' · '+st.dPips.toFixed(1)+' pips' : '';
  const barTxt = st.bars===1 ? '1 bar' : st.bars+' bars';
  return [priceTxt+' ('+pctTxt+')'+pipTxt, barTxt+' · '+fmtDur(st.ms)];
}

// ---- state ephemeral: hanya SATU hasil ukur hidup pada satu waktu ----
// measureId diisi HANYA di onDrawEnd (js/draw-tools.js). Konsekuensinya, saat measure masih
// digambar ia masih null → Esc jatuh ke cancelInProgressDraw() seperti tool lain, bukan termakan
// clearMeasure().
let measureId=null;
function clearMeasure(){
  if(measureId==null) return;
  try{ chart.removeOverlay(measureId); }catch(_){}
  measureId=null;
}

// Warna = ARAH (naik/turun), bukan preferensi per-objek → measure sengaja TAK masuk DRAW_DEFAULT,
// jadi ia tak punya modal Style/Text. Palet sama dgn long/shortPosition.
const MEAS_UP=POS_GREEN, MEAS_DN=POS_RED;
// needDefaultPointFigure:false → tanpa handle titik & tanpa hit-test. Ini SENGAJA, dan bukan
// pengulangan Temuan 3 (simpleAnnotation/simpleTag ditarik karena tak terjangkau, lihat
// docs/e2e-drawing-findings.md): objek itu PERSIST sehingga tak-terjangkau = nyangkut selamanya,
// sedangkan measure tak pernah tersimpan dan punya empat jalur keluar otomatis (Esc, klik lain,
// arm tool lain, ganti TF/instrumen).
klinecharts.registerOverlay({
  name:'measure', totalStep:3, needDefaultPointFigure:false,
  createPointFigures:({overlay,coordinates})=>{
    if(coordinates.length<2) return [];
    const C=subBarCoords(overlay,coordinates), a=C[0], b=C[1];
    if(!a||!b||a.x==null||b.x==null||!isFinite(a.x)||!isFinite(b.x)) return [];
    const v0=overlay.points[0]&&overlay.points[0].value, v1=overlay.points[1]&&overlay.points[1].value;
    const up = (v1!=null&&v0!=null) ? v1>=v0 : b.y<=a.y;
    const col = up?MEAS_UP:MEAS_DN;
    const xL=Math.min(a.x,b.x), xR=Math.max(a.x,b.x), yT=Math.min(a.y,b.y), yB=Math.max(a.y,b.y);
    const figs=[{type:'rect', attrs:{x:xL, y:yT, width:Math.max(1,xR-xL), height:Math.max(1,yB-yT)},
      styles:{style:'stroke_fill', color:col+alphaHex(12), borderColor:col, borderSize:1}}];
    // panah vertikal di tengah kotak → arah gerak terbaca sebelum angkanya dibaca
    const xc=(a.x+b.x)/2, dir=(b.y>=a.y)?1:-1, hs=6;
    figs.push({type:'line', attrs:{coordinates:[{x:xc,y:a.y},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    figs.push({type:'line', attrs:{coordinates:[{x:xc-hs,y:b.y-dir*hs},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    figs.push({type:'line', attrs:{coordinates:[{x:xc+hs,y:b.y-dir*hs},{x:xc,y:b.y}]}, styles:{color:col,size:2}});
    const lines=fmtMeasure(measureStats(overlay.points[0], overlay.points[1]));
    if(lines){
      // pill di sisi LUAR kotak (atas bila naik, bawah bila turun) → tak menutup candle yg diukur
      const w=Math.max(lines[0].length, lines[1].length)*6.4+16, h=34;
      const py = up ? yT-h-6 : yB+6;
      figs.push({type:'rect', attrs:{x:xc-w/2, y:py, width:w, height:h}, styles:{style:'fill', color:col}});
      figs.push({type:'text', attrs:{x:xc, y:py+11, text:lines[0], align:'center', baseline:'middle'},
        styles:{color:'#fff', size:11}});
      figs.push({type:'text', attrs:{x:xc, y:py+24, text:lines[1], align:'center', baseline:'middle'},
        styles:{color:'#fff', size:11}});
    }
    return figs;
  }
});

// Hasil ukur yang SUDAH jadi dibuang oleh mousedown berikutnya di chart. Listener ini sengaja TIDAK
// stopPropagation: klik itu harus tetap sampai ke chart & tool lain. Saat klik ke-2 jalur rail,
// measureId masih null (baru diisi di onDrawEnd) → klik penyelesai tak membuang dirinya sendiri.
$('#chart').addEventListener('mousedown',(e)=>{ if(!e.shiftKey) clearMeasure(); });


// ---- Shift + tekan-geser-lepas: ukur kilat tanpa menyentuh rail ----
// mousedown dipasang di fase CAPTURE lalu stopPropagation → handler klinecharts (terpasang di
// canvas, fase bubble) tak pernah melihatnya, jadi chart TIDAK nge-pan. Trik & alasan yang sama
// dipakai Shift+wheel untuk skala harga (js/price-scale.js).
// mousemove/mouseup dipasang di WINDOW, bukan #chart: kalau tombol dilepas di luar chart, mouseup
// pada #chart tak pernah datang dan overlay akan nyangkut.
(function attachMeasureDrag(){
  const el=$('#chart'); if(!el) return;
  let dragging=false;
  function ptFromEvent(e){
    const r=el.getBoundingClientRect();
    const px=e.clientX-r.left, py=e.clientY-r.top;
    const xa=fracAnchorFromPx(px);
    let v=pxToValue(py);
    if(!xa || v==null) return null;
    // magnet dihormati di jalur ini juga — kalau tidak, dua pintu masuk bisa memberi angka
    // berbeda untuk gestur yang sama.
    if(magnetOn){ const t=tsOf(xa);
      if(t!=null){ const s=magnetSnap(t, v, px, py); if(s) v=s.value; } }
    return Object.assign({value:v}, xa);
  }
  el.addEventListener('mousedown',(e)=>{
    if(!e.shiftKey || e.button!==0) return;
    if(inProgressId || eraserOn) return;                 // sedang menggambar / mode hapus → jangan rebut
    const tgt=e.target; if(!tgt || tgt.tagName!=='CANVAS') return;
    const p=ptFromEvent(e); if(!p) return;
    e.preventDefault(); e.stopPropagation();
    clearMeasure();
    // lock:true → objek tak bisa dipilih/digeser; ia hanya hidup selama gestur ini
    try{ measureId=chart.createOverlay({name:'measure', points:[p,p], lock:true}); }catch(_){ measureId=null; }
    dragging=(measureId!=null);
  },{capture:true});
  window.addEventListener('mousemove',(e)=>{
    if(!dragging || measureId==null) return;
    const p=ptFromEvent(e); if(!p) return;
    try{ const o=chart.getOverlayById(measureId);
      if(o&&o.points&&o.points.length) chart.overrideOverlay({id:measureId, points:[o.points[0], p]});
    }catch(_){}
  },{capture:true});
  const stop=()=>{ if(!dragging) return; dragging=false; clearMeasure(); };
  window.addEventListener('mouseup', stop, {capture:true});
  window.addEventListener('blur', stop);
})();
