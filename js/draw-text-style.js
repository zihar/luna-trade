// ===================== gaya teks bersama objek gambar (tab Text) =====================
// SATU sumber gaya teks utk semua objek bertekst (text/callout/rect/trendline, dan garis di PR berikut):
// render canvas (overlays-custom.js), editor inline (draw-text-editor.js) & tab Text modal
// (draw-style-modal.js) membaca textStyle() yang sama → WYSIWYG, tak ada "loncatan" gaya saat commit.
//
// Kunci di objStyle: objek 'text' memakai `size`/`color` (teks ADALAH objeknya; data tersimpan lama
// tetap terbaca tanpa migrasi). Objek lain memakai `fontSize`/`textColor` karena `size`/`color` di
// sana milik garis/border. textColor kosong = Auto (ikut tema, drawTextColor).
const TEXT_DEF_SIZE={text:13,rect:12,callout:12,trendline:10};
const TEXT_SIZES=[10,11,12,13,14,16,18,20,24,28,32,40];
function textKeys(name){ return name==='text' ? {size:'size',color:'color'} : {size:'fontSize',color:'textColor'}; }
function textStyle(o){
  const name=o&&o.name, st=dstyle(o), k=textKeys(name), def=TEXT_DEF_SIZE[name]||13;
  let size=+st[k.size];
  // objek 'text' lama: chip Thickness 1–4px dulu menulis `size` (= ukuran font) → teks mikroskopis.
  // Nilai < 8 dianggap sisa bug itu, bukan pilihan sadar.
  if(!(size>=8)) size=def;
  const bold=!!st.textBold, italic=!!st.textItalic;
  return { size, color:st[k.color]||drawTextColor, bold, italic, lh:Math.round(size*1.25),
    weight:(italic?'italic ':'')+(bold?'bold':'normal') };   // klinecharts merakit font = `${weight} ${size}px ${family}`
}
// lebar karakter rata-rata (dipakai callout utk lebar kotak; dulu 7px @12px)
function textCharW(ts){ return ts.size*0.58*(ts.bold?1.06:1); }
// styles figure 'text' klinecharts; color opsional (mis. placeholder muted)
function textFigStyles(ts, color){
  return { color:color||ts.color, size:ts.size, weight:ts.weight, family:AXIS_FONT, backgroundColor:'transparent', borderColor:'transparent',
    paddingLeft:0, paddingRight:0, paddingTop:0, paddingBottom:0 };
}
// isi tab Text di bawah textarea: Font (ukuran + B/I) & Text color (Auto + palet + custom)
function textStylePaneHTML(o){
  const ts=textStyle(o), raw=(dstyle(o)[textKeys(o.name).color]||'').toLowerCase();
  const sizes=TEXT_SIZES.includes(ts.size)?TEXT_SIZES:[...TEXT_SIZES,ts.size].sort((a,b)=>a-b);
  const opt=sizes.map(s=>`<option value="${s}"${s===ts.size?' selected':''}>${s}</option>`).join('');
  const inList=raw===''||PALETTE.includes(raw);
  const sw=PALETTE.map(c=>`<button class="sw ${raw===c?'on':''}" data-tcol="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  return `<div class="pp-lbl">Font</div><div class="dm-co-row dm-font-row">`
    +`<select class="dm-co dm-co-sel" data-tsize aria-label="Font size">${opt}</select>`
    +`<button class="pp-chip dm-tb ${ts.bold?'on':''}" data-tb title="Bold" aria-label="Bold" aria-pressed="${ts.bold}"><b>B</b></button>`
    +`<button class="pp-chip dm-ti ${ts.italic?'on':''}" data-ti title="Italic" aria-label="Italic" aria-pressed="${ts.italic}"><i>I</i></button></div>`
    +`<div class="pp-lbl">Text color</div><div class="pp-row">`
    +`<button class="sw sw-auto ${raw===''?'on':''}" data-tcol="" title="Auto (follows theme)" aria-label="Auto color"></button>${sw}`
    +`<label class="sw sw-custom ${inList?'':'on'}" title="Custom color"><input type="color" data-tcol-in value="${raw||'#e8edf2'}" aria-label="Custom text color"></label></div>`;
}
function wireTextStylePane(panel, o){
  const k=textKeys(o.name);
  const sel=panel.querySelector('[data-tsize]'); if(!sel) return;
  sel.onchange=()=>setObjStyle(o.id,{[k.size]:+sel.value});
  sel.onkeydown=e=>{ if(e.key!=='Escape') e.stopPropagation(); };
  const tog=(b,key)=>b.onclick=()=>{ const on=!b.classList.contains('on'); b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); setObjStyle(o.id,{[key]:on}); };
  tog(panel.querySelector('[data-tb]'),'textBold');
  tog(panel.querySelector('[data-ti]'),'textItalic');
  const offAll=()=>panel.querySelectorAll('[data-tcol], .sw-custom').forEach(x=>{ if(x.closest('[data-pane="text"]')) x.classList.remove('on'); });
  panel.querySelectorAll('[data-tcol]').forEach(b=>b.onclick=()=>{ setObjStyle(o.id,{[k.color]:b.dataset.tcol}); offAll(); b.classList.add('on'); });
  const ci=panel.querySelector('[data-tcol-in]');
  if(ci) ci.oninput=()=>{ setObjStyle(o.id,{[k.color]:ci.value}); offAll(); ci.closest('.sw').classList.add('on'); };
}
