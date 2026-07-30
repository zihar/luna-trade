// ===== garis draft SL/TP (preview sebelum order; bisa di-drag) =====
// Desain DISAMAKAN dgn garis SL/TP posisi on-chart: garis tradeLevel (warna POS_RED/POS_GREEN) +
// label chip DOM (.pos-tag) di #posLayer — bukan teks canvas. Drag garis → update pips tiket.
let draft={sl:null,tp:null};
let draftDom={sl:null,tp:null};   // kind -> elemen chip DOM (.pos-node .draft)
let draftDragKind=null;           // kind yg sedang digeser → chip tampil $/% (spt preview drag posisi)
function ensureDraftNode(kind){
  if(draftDom[kind] && draftDom[kind].parentNode) return draftDom[kind];
  const el=document.createElement('div'); el.className='pos-node '+kind+' draft'; el.style.display='none';
  el.innerHTML='<span class="pos-tag"></span>';
  posLayer().appendChild(el); return draftDom[kind]=el;
}
function removeDraftNode(kind){ const el=draftDom[kind]; if(el&&el.parentNode) el.parentNode.removeChild(el); draftDom[kind]=null; }
// dipanggil createPointFigures tiap repaint → tempatkan chip di y garis; sembunyi bila di luar pane
function syncDraftNodeY(kind,y,h){ const el=draftDom[kind]; if(!el) return;
  const on = y!=null && y>=-6 && (h==null||y<=h+6); el.style.display=on?'':'none'; if(on) el.style.top=y+'px'; }
function clearDraftLines(){ ['sl','tp'].forEach(k=>{ if(draft[k]){ try{chart.removeOverlay(draft[k]);}catch(e){} draft[k]=null; } removeDraftNode(k); }); }
function draftChipText(kind,price,entry,units){
  const bal=+$('#balance').value||0, pnl=Math.abs(pnlUsd(orderDir,entry,price,units)), pct=bal?pnl/bal*100:0, s=kind==='sl'?'-':'+';
  return `${kind.toUpperCase()} ${s}${usdGrp(pnl)} / ${s}${pct.toFixed(2)}%`;
}
function draftLevel(kind,price){
  const lc=(kind==='sl')?POS_RED:POS_GREEN;
  return chart.createOverlay({ name:'tradeLevel', points:[{value:price}], extendData:{draftKind:kind,color:lc,lineColor:lc},
    onPressedMoving:(e)=>{ const v=e.overlay.points[0]&&e.overlay.points[0].value; if(v==null) return false;
      const ba=curBidAsk(), cur=currentCandle(), entry= ba?(orderDir==='short'?ba.bid:ba.ask):(cur?cur.close:null);
      if(entry==null) return false;
      const pip=+$('#pipSize').value||instSpec().pip, ticks=Math.max(1, Math.round(Math.abs(v-entry)/pip));
      draftDragKind=kind; $(kind==='sl'?'#slPips':'#tpPips').value=ticks; renderOrderPanel(); try{renderSizing();}catch(_){}
      return false; },
    onPressedMoveEnd:()=>{ draftDragKind=null; try{drawDraftLines();}catch(_){} return false; },   // lepas → chip balik ke label ringkas
  });
}
function drawDraftLines(){
  // preview SL/TP saat panel order terbuka & menyiapkan order — termasuk saat sudah ada posisi
  // terbuka (tambah posisi baru), sama seperti Live. Sembunyikan hanya saat panel tertutup atau
  // data belum ada.
  const op=$('#orderpanel');
  if(T==null || (op && op.style.display==='none')){ clearDraftLines(); return; }
  const cur=currentCandle(), ba=curBidAsk(); if(!cur){ clearDraftLines(); return; }
  const isSell=orderDir==='short', entry= ba?(isSell?ba.bid:ba.ask):cur.close;
  const pip=+$('#pipSize').value||instSpec().pip, slp=+$('#slPips').value||0, rr=rrVal(), dist=slp*pip, units=currentLots()*unitsPer();
  const slPrice=($('#slOn').checked && slp>0) ? (isSell?entry+dist:entry-dist) : null;
  const tpPrice=($('#tpOn').checked && slp>0) ? (isSell?entry-dist*rr:entry+dist*rr) : null;
  const lc=k=>(k==='sl')?POS_RED:POS_GREEN;
  const upd=(kind,price)=>{
    if(price==null){ if(draft[kind]){ try{chart.removeOverlay(draft[kind]);}catch(e){} draft[kind]=null; } removeDraftNode(kind); return; }
    const el=ensureDraftNode(kind), tag=el.querySelector('.pos-tag');
    if(tag){   // label ringkas "SL"/"TP" (spt posisi view); saat digeser → $/% + glow (spt preview drag posisi)
      if(draftDragKind===kind){ tag.textContent=draftChipText(kind,price,entry,units); tag.classList.add('drag'); }
      else { tag.textContent=kind.toUpperCase(); tag.classList.remove('drag'); }
    }
    let alive=false; try{ alive=draft[kind]&&!!chart.getOverlayById(draft[kind]); }catch(e){ alive=!!draft[kind]; }
    if(!alive) draft[kind]=draftLevel(kind,price);
    else { try{ chart.overrideOverlay({id:draft[kind], points:[{value:price}], extendData:{draftKind:kind,color:lc(kind),lineColor:lc(kind)}}); }catch(e){} }
  };
  upd('sl',slPrice); upd('tp',tpPrice);
}
function hline(value,color,onMove){
  return chart.createOverlay({
    name:'horizontalStraightLine', points:[{value}],
    styles:{ line:{ color, style:'dashed', size:1 } },
    onPressedMoving:(e)=>{ const v=e.overlay.points[0].value; if(v!=null) onMove(+v); return false; },
  });
}
// Trade replay kini digambar oleh sistem on-chart terpadu (drawPaperLines/posLevel),
// sama seperti posisi Live. Fungsi lama tradeLineInfo/tradeLevel/drawTradeLines dihapus.

