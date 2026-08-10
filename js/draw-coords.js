// ===================== tab Coordinates: harga + nomor bar per titik =====================
// Acuan TradingView, terverifikasi dari dokumentasinya (jangan riset ulang): "Allows for the
// precise placement of the trendline's first point (Price 1) using a BAR NUMBER and price"
// (tradingview.com/support/solutions/43000518095-trend-line/). Jadi sumbu X di tab ini adalah
// nomor bar, bukan tanggal — horizontal line hanya punya harga (.../43000518124-horizontal-line/).
//
// Nomor bar = `dataIndex` apa adanya (0 = bar tertua yang dimuat), PECAHAN 2 desimal. Pecahan
// sengaja dipertahankan: membulatkan ke integer saat modal dibuka akan menggeser objek sub-bar
// hingga setengah lebar bar — persis regresi yang diperbaiki di PR #24.
//
// Rancangan: docs/superpowers/specs/2026-08-10-coordinates-tab-design.md

// Bentuk baris per tool. Satu tabel, bukan rantai if — tool baru = satu entri di sini
// (+ satu kolom `coords` di tests/helpers/spec.js).
const COORD_SPEC={
  trendline:'points', rayLine:'points', straightLine:'points', arrow:'points',
  circle:'points', ellipse:'points', fibonacciLine:'points', dateRange:'points',
  parallelStraightLine:'points', priceChannelLine:'points',
  text:'points', callout:'points', arrowMarkUp:'points', arrowMarkDown:'points',
  horizontalStraightLine:'price', priceLine:'price',   // sumbu X tak bermakna
  verticalStraightLine:'bar',                          // sumbu Y tak bermakna
  horizontalRayLine:'hray',                            // satu harga (dua titik) + dua nomor bar
  rect:'box', fib3:'box',                              // 2 sudut, turunan dari 8 titik (writeBox)
};
// longPosition/shortPosition sengaja TIDAK di sini: setelannya dialihkan ke showPosPopup,
// bukan modal ini.

const coordPriceText=(v)=>(v==null||!isFinite(v))?'':(+v).toFixed(priceDecimals());
const coordBarText=(v)=>(v==null||!isFinite(v))?'':String(+(+v).toFixed(2));
// Field-nya `type=text`, BUKAN `type=number`: Chrome menampilkan & mem-parse number-input menurut
// locale browser, jadi di locale koma-desimal (id-ID, de-DE, …) nilai kita tampil "1,08900" dan
// mengetik "1.09" ditolak diam-diam. Parser sendiri menerima keduanya — pemisah ribuan tidak,
// karena "1,090" ambigu (seribu sembilan puluh vs 1,09).
function parseCoordNum(s){
  const t=String(s==null?'':s).trim().replace(/\s+/g,'');
  const u=(t.indexOf(',')>=0 && t.indexOf('.')<0) ? t.replace(',','.') : t;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(u) ? parseFloat(u) : NaN;
}

/**
 * Baris tab Coordinates untuk sebuah objek → [{label, fields:[{cf,kind,text,aria}]}].
 * `cf` = kunci field: 'p<i>' harga, 'b<i>' nomor bar. Untuk 'box' indeksnya SUDUT (0=kiri-atas,
 * 1=kanan-bawah), bukan indeks titik mentah.
 */
function coordRows(o){
  const shape=o&&COORD_SPEC[o.name]; if(!shape) return [];
  let pts=null; try{ const ov=chart.getOverlayById(o.id); pts=ov&&ov.points; }catch(e){}
  if(!pts||!pts.length) return [];
  const price=(cf,label,v)=>({cf, kind:'price', text:coordPriceText(v), aria:label});
  const bar=(cf,label,p)=>({cf, kind:'bar', text:coordBarText(p!=null?fidxOf(p):null), aria:label});
  if(shape==='price') return [{label:'Price', fields:[price('p0','Price',pts[0].value)]}];
  if(shape==='bar')   return [{label:'Bar',   fields:[bar('b0','Bar',pts[0])]}];
  if(shape==='hray')  return [
    {label:'Price',  fields:[price('p0','Price',pts[0].value)]},
    {label:'Bar 1',  fields:[bar('b0','Bar 1',pts[0])]},
    {label:'Bar 2',  fields:[bar('b1','Bar 2',pts[1]||pts[0])]}];
  if(shape==='box'&&pts.length>=8) return [
    // urutan 8 titik = writeBox(): 0 kiri-atas, 2 kanan-atas, 6 kiri-bawah
    {label:'Price 1', fields:[price('p0','Price 1',pts[0].value), bar('b0','Bar 1',pts[0])]},
    {label:'Price 2', fields:[price('p1','Price 2',pts[6].value), bar('b1','Bar 2',pts[2])]}];
  // 'points' (dan 'box' yang belum sempat mekar jadi 8 titik): satu baris per titik
  return pts.map((p,i)=>({
    label: pts.length>1?('Price '+(i+1)):'Price',
    fields:[price('p'+i, pts.length>1?('Price '+(i+1)):'Price', p&&p.value),
            bar('b'+i, pts.length>1?('Bar '+(i+1)):'Bar', p)],
  }));
}

function coordsPaneHTML(o){
  const rows=coordRows(o); if(!rows.length) return '';
  const body=rows.map(r=>`<div class="pp-lbl">${dmEsc(r.label)}</div><div class="dm-co-row">`
    +r.fields.map(f=>(f.kind==='bar'&&r.fields.length>1?`<span class="dm-co-x">Bar</span>`:'')
      +`<input class="dm-co" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-cf="${f.cf}"`
      +` value="${f.text}" data-base="${f.text}" aria-label="${dmEsc(f.aria)}">`).join('')
    +`</div>`).join('');
  return `<div class="dm-pane" data-pane="coords">${body}</div>`;
}

// Nomor bar → anchor titik. Aturannya SAMA dengan buildDrawsFromArray (js/draw-persist.js) supaya
// hanya ada satu tempat yang memutuskan timestamp vs dataIndex.
function coordBarAnchor(name, fidx){
  if(subBar(name)) return {dataIndex:fidx};
  // BAR_ANCHOR (verticalStraightLine): penanda waktu harus = waktu SEBUAH candle, jadi dibulatkan
  // ke bar terdekat seperti snapTimeToBar di jalur gambar. Di area future tak ada candle-nya.
  const a=revealed(currentTF), li=a.length-1, r=Math.round(fidx);
  return (li>=0 && r>=0 && r<=li) ? {timestamp:a[r].timestamp} : {dataIndex:fidx};
}

/** Tulis SATU field ke objek. true bila berhasil. */
function applyCoord(o, cf, v){
  const shape=o&&COORD_SPEC[o.name]; if(!shape||!cf) return false;
  let ov=null; try{ ov=chart.getOverlayById(o.id); }catch(e){}
  if(!ov||!ov.points||!ov.points.length) return false;
  const pts=ov.points.map(p=>Object.assign({},p));
  const kind=cf[0], i=+cf.slice(1);
  if(shape==='box'&&pts.length>=8){
    let Lxa=keyOf(pts[0]), Rxa=keyOf(pts[2]), T=pts[0].value, B=pts[6].value;
    if(cf==='p0') T=v; else if(cf==='p1') B=v;
    else if(cf==='b0') Lxa=coordBarAnchor(o.name,v); else if(cf==='b1') Rxa=coordBarAnchor(o.name,v);
    else return false;
    if(fidxOf(Lxa)>fidxOf(Rxa)){ const t=Lxa; Lxa=Rxa; Rxa=t; }   // sisi kiri<kanan, spt boxPressedMove
    writeBox(pts, Lxa, Rxa, Math.max(T,B), Math.min(T,B));
  }else if(shape==='hray'&&kind==='p'){
    // Ray horizontal: klik ke-2 hanya menentukan panjang, Y-nya diabaikan → satu harga menggerakkan
    // KEDUA titik, kalau tidak garisnya berhenti horizontal.
    pts.forEach(p=>{ if(p) p.value=v; });
  }else{
    if(!pts[i]) return false;
    if(kind==='p') pts[i]=Object.assign({}, keyOf(pts[i]), {value:v});
    else if(kind==='b') pts[i]=Object.assign({value:pts[i].value}, coordBarAnchor(o.name,v));
    else return false;
  }
  try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(e){ return false; }
  return true;
}

// Nilai dihitung ULANG dari titik objek yang sebenarnya — bukan dari apa yang diketik. Dengan
// begitu normalisasi (writeBox menukar sisi, BAR_ANCHOR membulatkan ke bar) terlihat apa adanya.
function refreshCoordsPane(panel, o){
  const pane=panel&&panel.querySelector('.dm-pane[data-pane="coords"]'); if(!pane) return;
  const text={}; coordRows(o).forEach(r=>r.fields.forEach(f=>{ text[f.cf]=f.text; }));
  pane.querySelectorAll('input.dm-co').forEach(inp=>{ const t=text[inp.dataset.cf];
    if(t==null||t==='') return; inp.value=t; inp.dataset.base=t; });
}

function markCoordBad(inp){ inp.classList.add('bad'); }

function commitCoord(panel, o, inp){
  // `panel` adalah SATU node modal yang dipakai ulang untuk objek apa pun (alasan yang sama
  // dengan penjaga di refreshAlertPane): blur bisa datang setelah modal berpindah ke objek lain,
  // dan menulis di situ akan memindahkan objek yang salah.
  if(!drawModal.classList.contains('show')||!dmTarget||!o||dmTarget.id!==o.id) return;
  if(inp.disabled) return;
  if(inp.value===inp.dataset.base) return;      // tak diedit → tak ditulis (lihat catatan di spec)
  const v=parseCoordNum(inp.value);
  if(!isFinite(v)||!applyCoord(o, inp.dataset.cf, v)){ markCoordBad(inp); refreshCoordsPane(panel,o); return; }
  inp.classList.remove('bad');
  refreshCoordsPane(panel, o);
  scheduleSaveDraws();   // ikut jalur simpan: riwayat undo, sync server, & anchor alert sekaligus
}

function wireCoordsPane(panel, o){
  const pane=panel&&panel.querySelector('.dm-pane[data-pane="coords"]'); if(!pane) return;
  const locked=(()=>{ try{ return isLocked(o.id); }catch(e){ return false; } })();
  pane.querySelectorAll('input.dm-co').forEach(inp=>{
    inp.disabled=locked;   // terkunci = tak bisa digeser, termasuk lewat angka
    inp.oninput=()=>inp.classList.remove('bad');
    inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); commitCoord(panel,o,inp); } };
    inp.onblur=()=>commitCoord(panel,o,inp);
  });
}
