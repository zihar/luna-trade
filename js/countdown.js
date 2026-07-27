// ===================== countdown candle berikutnya (mode Live) =====================
function fmtCountdown(ms){
  let s=Math.max(0,Math.floor(ms/1000));
  const d=Math.floor(s/86400); s-=d*86400;
  const h=Math.floor(s/3600);  s-=h*3600;
  const m=Math.floor(s/60);    s-=m*60;
  const p2=n=>String(n).padStart(2,'0');
  if(d>0) return d+'d '+p2(h)+':'+p2(m)+':'+p2(s);
  if(h>0) return p2(h)+':'+p2(m)+':'+p2(s);
  return p2(m)+':'+p2(s);
}
// tutup candle TF aktif = open candle terakhir + durasi; lompati boundary yg sudah lewat
// (mis. data live belum sempat fetch candle baru) agar hitung mundur tak nyangkut di 00:00.
function nextCandleEnd(){
  const c=currentCandle(); if(!c) return null;
  const dur=DUR[currentTF]; let end=c.timestamp+dur, now=Date.now();
  while(end<=now) end+=dur;
  return end;
}
// pasar dianggap tutup bila tick harga simbol aktif basi (OANDA bekukan waktu
// tick saat tutup, mis. akhir pekan) → countdown tak relevan.
function marketClosed(){
  const t=liveTicks[inst];
  if(t && t.time){ const age=Date.now()-Date.parse(t.time); if(age>300000) return true; } // >5 mnt
  return false;
}
function updatePriceTimer(){
  const el=priceTimerEl; if(!el) return;
  const c=currentCandle(), end=nextCandleEnd();
  // hanya saat mode Live (realtime) — sembunyikan di replay/tanpa data
  if(!live || c==null || end==null){ el.style.display='none'; return; }
  // ikuti harga candle berjalan (bergerak tiap tick) bila ada
  const bar=(formingBar && formingBar.timestamp>c.timestamp)?formingBar:c;
  let p=chart.convertToPixel({timestamp:bar.timestamp, value:bar.close},{paneId:'candle_pane',absolute:true});
  if(Array.isArray(p)) p=p[0];
  if(!p || p.y==null){ el.style.display='none'; return; }
  // pasar tutup / libur → sembunyikan (countdown tak relevan)
  if(marketClosed()){ el.style.display='none'; return; }
  // taruh DI BAWAH label harga klinecharts (jangan tumpang tindih); clamp di area chart
  const H=$('#chart').clientHeight||0, y=Math.max(0,Math.min(p.y+12, H-22));
  el.textContent='⏱ '+fmtCountdown(end-Date.now());
  el.style.top=y+'px';
  el.style.display='block';
}
// Label waktu di sumbu-X saat hover area future (candle belum terbentuk). klinecharts
// hanya menandai waktu di atas bar yang ADA; area kosong di kanan tak diberi label →
// hitung waktu proyeksi dari grid bar terakhir & tampilkan label sendiri.
function updateAxisTime(e){
  const el=axisTimeEl; if(!el) return;
  const rect=$('#chart').getBoundingClientRect();
  const x=e.clientX-rect.left, y=e.clientY-rect.top;
  if(x<0||x>rect.width||y<0||y>rect.height){ el.style.display='none'; return; }
  let cc=chart.convertFromPixel({x,y:0},{paneId:'candle_pane'}); if(Array.isArray(cc)) cc=cc[0];
  const di=cc&&cc.dataIndex!=null?cc.dataIndex:null;
  const dl=chart.getDataList(); if(di==null||!dl.length){ el.style.display='none'; return; }
  const lastIdx=dl.length-1;
  if(di<=lastIdx+0.5){ el.style.display='none'; return; }  // di atas bar nyata → klinecharts sudah menandai
  const off=Math.round(di-lastIdx);                         // berapa bar ke depan
  const ts=dl[lastIdx].timestamp + off*DUR[currentTF];
  el.textContent=crosshairDate(ts);
  el.style.left=x+'px';
  // top-align ke atas band sumbu-X — sama persis dgn pill crosshair klinecharts
  el.style.top=chartAxisTop()+'px';
  el.style.display='block';
}
// top band sumbu-X = tinggi pane candle (= canvas tertinggi di #chart)
function chartAxisTop(){ let h=0; document.querySelectorAll('#chart canvas').forEach(c=>{ if(c.offsetHeight>h) h=c.offsetHeight; }); return h; }

