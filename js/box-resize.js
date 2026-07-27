// ===================== resize 8-titik (box) untuk rect & fib =====================
// 8 titik: 0 TL · 1 TC · 2 TR · 3 MR · 4 BR · 5 BC · 6 BL · 7 ML
// Lxa/Rxa = anchor x (objek {timestamp}|{dataIndex}) sisi kiri/kanan → kotak bisa melebar ke future.
function writeBox(pts,Lxa,Rxa,T,B){
  const mV=(T+B)/2, mxa=midAnchor(Lxa,Rxa);
  const xa=[Lxa,mxa,Rxa,Rxa,Rxa,mxa,Lxa,Lxa], vy=[T,T,T,mV,B,B,B,mV];
  for(let i=0;i<8;i++) pts[i]=Object.assign({value:vy[i]}, xa[i]);
}
// Tool berbentuk kotak: 2 titik saat digambar → mekar jadi 8 handle, dan setiap drag handle harus
// menulis ulang SISI (bukan satu titik lepas) supaya kotaknya tetap kotak. Dipakai expandBox dan
// lapis drag presisi di delHooks() — satu daftar, bukan dua yang bisa melenceng.
const BOX_TOOLS={rect:1, fib3:1};
// dipanggil saat salah satu handle di-drag → recompute jadi kotak rapi (tetap axis-aligned)
function boxPressedMove(t){
  const pts=t.points, k=t.performPointIndex, pp=t.performPoint;
  if(!pts||pts.length<8||pp==null) return;
  let Lxa=keyOf(pts[0]), Rxa=keyOf(pts[2]), T=pts[0].value, B=pts[6].value;
  if(k===0||k===6||k===7) Lxa=keyOf(pp);      // sisi kiri
  if(k===2||k===3||k===4) Rxa=keyOf(pp);      // sisi kanan
  if(k===0||k===1||k===2) T=pp.value;         // sisi atas
  if(k===4||k===5||k===6) B=pp.value;         // sisi bawah
  if(fidxOf(Lxa)>fidxOf(Rxa)){ const tmp=Lxa; Lxa=Rxa; Rxa=tmp; }   // jaga kiri<kanan saat lewat sisi seberang
  writeBox(pts,Lxa,Rxa,T,B);
  scheduleSaveDraws();
}
// setelah 2 klik (2 titik) → mekarkan jadi 8 titik handle
function expandBox(o){
  if(!o || !BOX_TOOLS[o.name]) return;
  if(!o.points || o.points.length>=8) return;
  const p0=o.points[0], p1=o.points[1];
  if(!p0||!p1||p0.value==null||p1.value==null) return;
  const a0=keyOf(p0), a1=keyOf(p1), left=fidxOf(p0)<=fidxOf(p1);
  let Lxa=left?a0:a1, Rxa=left?a1:a0;
  // 2 titik di candle yg sama (drag lurus ke atas) → lebar ~0 → box jadi garis vertikal
  // & handle bertumpuk (tak bisa di-resize). Beri lebar minimum 1 bar ke kanan.
  if(Math.abs(fidxOf(Rxa)-fidxOf(Lxa)) < 0.5){ Rxa={dataIndex: fidxOf(Lxa)+1}; }
  const T=Math.max(p0.value,p1.value), B=Math.min(p0.value,p1.value);
  const ext = o.name==='fib3' ? {zeroTop:p1.value>=p0.value} : o.extendData;  // fib: 100% di titik start, 0% di titik akhir (arah tarik) → tarik ke atas 0% di atas, ke bawah 0% di bawah
  const pts=new Array(8); writeBox(pts,Lxa,Rxa,T,B);
  try{ chart.overrideOverlay({id:o.id, points:pts, extendData:ext}); }catch(e){}
}

// Undangan "+ Add text" (ala TradingView) hanya muncul saat objek SUDAH JADI & sedang
// di-hover atau terpilih — bukan saat digambar. Dipakai rect & trendline saat teks kosong.
function showAddTextHint(overlay){ return overlay && overlay.id!==inProgressId && overlay.id!==editingTextId && (overlay.id===hoverId || overlay.id===selectedId); }
// Undangan hanya muat di kotak yg cukup besar: label "+ Add text" ~66px lebar pada
// 12px/AXIS_FONT, plus ~12px napas per sisi. Di bawah ambang ini kotak dibiarkan BERSIH,
// dan label + hit-area mati BERSAMAAN: kalau cuma labelnya yg disembunyikan, tersisa area
// hantu — klik di tengah kotak kecil tetap membuka editor tanpa sebab yg terlihat.
// Rancangan: docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md
const ADDTEXT_MIN_W=90, ADDTEXT_MIN_H=28;
const ADDTEXT_PAD=8;    // jarak aman hit-area label dari tepi/handle kotak
// apakah kursor terakhir berada di atas area undangan "+ Add text" objek (utk membedakan klik
// "tambah teks" dari klik "pilih objek"). Toleransi kira-kira selebar label — utk rect juga
// dibatasi ukuran kotaknya (ADDTEXT_MIN_*), sejalan dgn gerbang visual di createPointFigures.
function overPlaceholder(o){ try{ const a=overlayTextAnchor(o); if(!a) return false;
  let hw=55, hh=16;
  if(o.name==='rect'){ const b=rectBoxPx(o); if(!b) return false;
    if(b.w<ADDTEXT_MIN_W || b.h<ADDTEXT_MIN_H) return false;   // kotak kecil: tak ada undangan → tak ada hit-area
    // potong ke DALAM kotak: kotak lebar-tapi-tipis (mis. 300×30) memuat labelnya, tapi
    // toleransi ±16 melampaui tingginya → klik persis di handle tepi atas/bawah salah
    // terbaca "tambah teks". Gerbang ukuran di atas menjamin sisanya positif.
    hw=Math.min(hw, b.w/2-ADDTEXT_PAD); hh=Math.min(hh, b.h/2-ADDTEXT_PAD); }
  return Math.abs(lastPtr.x-a.x)<=hw && Math.abs(lastPtr.y-a.y)<=hh;
}catch(e){ return false; } }
