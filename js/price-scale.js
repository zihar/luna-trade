// ===================== skala harga (sumbu Y) =====================
//
// Wheel di atas SUMBU harga = skala harga (meregang/memampatkan), persis hasil klik-drag di
// sumbu. Wheel di area plot tetap zoom-waktu bawaan KLineCharts. Shift+wheel di mana pun juga
// men-skala harga (jalan pintas untuk yang tak mau menggeser kursor ke sumbu).
//
// KLineCharts 9.8.10 tak punya API zoom-harga, jadi caranya menyuntik gesture drag sumbu
// (mousedown → mousemove → mouseup) di dalam sumbu — jalur skala miliknya sendiri, yang juga
// otomatis memilih pane yang benar (candle atau osilator) dari koordinat.
//
// DUA jebakan yang bikin versi lama terasa "loncat", keduanya ditawar di sini:
//   1. Skala drag sumbu dihitung dari rasio pageY ABSOLUT — `range × pageY_kini/pageY_awal`,
//      bukan dari delta. Jadi delta tetap (dulu 14px) berarti ~14% saat kursor di dekat atas
//      chart tapi hanya ~2% di dekat bawah. Penawarnya: hitung delta dari rasio yang
//      diinginkan (`pageY × (ratio-1)`), bukan sebaliknya.
//   2. Lebar sumbu dulu ditebak 70px, jadi wheel di dalam plot dekat tepi kanan diam-diam jadi
//      skala harga. Penawarnya: batas plot dibaca dari chart (`getSize(...,'main').width`).
//   3. KLineCharts membuang `pressedMouseMoveEvent` yang jaraknya < 5px (manhattan) dari
//      mousedown-nya. Karena tiap notch di sini adalah gesture SENDIRI, langkah halus (trackpad
//      macOS: deltaY ~2–15, bukan 100) menghasilkan gerak < 5px → skala tak jalan sama sekali,
//      DAN gesture yang gerakannya dibuang tetap terhitung click; dua click < 500ms di sumbu =
//      double-click = KLineCharts mengembalikan AUTO-SCALE, jadi zoom pengguna malah dibatalkan.
//      Penawarnya: notch yang belum cukup besar DITAHAN (`pending`), bukan dikirim lalu dibuang.

const AXIS_ZONE = 70;          // fallback lebar sumbu (px) bila getSize gagal
const SCALE_PER_NOTCH = 1.05;  // satu notch wheel mouse (deltaY≈100) = 5%
const MIN_MOVE = 6;            // px — di bawah ambang 5px KLineCharts, gesture jadi click (lihat #3)

// Wheel → jumlah "notch" ternormalkan (mengikuti normalisasi deltaMode KLineCharts sendiri).
// Trackpad mengirim banyak delta kecil → langkahnya halus; fling di-clamp supaya tak meloncat.
function wheelNotches(e){
  let n = e.deltaY/100;
  if(e.deltaMode===1) n *= 32;        // DOM_DELTA_LINE
  else if(e.deltaMode===2) n *= 120;  // DOM_DELTA_PAGE
  return Math.sign(n)*Math.min(1, Math.abs(n));
}

// Batas kanan area plot (px, relatif kontainer). Di kanannya = sumbu harga.
function plotRightEdge(c, rect){
  try{ const sz=c.getSize('candle_pane','main'); if(sz && sz.width>0) return sz.width; }catch(e){}
  return rect.width - AXIS_ZONE;
}

// Kirim gesture skala: titik x di dalam sumbu, geseran vertikal dy px (>0 = memampatkan).
// Batal (dan biarkan wheel default) bila titiknya tertutup node DOM — mis. pill P&L posisi atau
// tag SL/TP — supaya scroll tak pernah berubah jadi drag SL/TP.
function dispatchPriceScale(el, ax, e, dy){
  if(Math.abs(dy) < MIN_MOVE) return false;        // jaring pengaman: di bawah ini gesture jadi click
  const tgt = document.elementFromPoint(ax, e.clientY);
  if(!tgt || tgt.tagName!=='CANVAS' || !el.contains(tgt)) return false;
  const mk = (type,y,btn)=> new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:ax,clientY:y,buttons:btn,button:0});
  tgt.dispatchEvent(mk('mousedown', e.clientY, 1));
  tgt.dispatchEvent(mk('mousemove', e.clientY+dy, 1));
  tgt.dispatchEvent(mk('mouseup',   e.clientY+dy, 0));
  return true;
}

// Pasang skala-harga ke satu elemen chart (panel utama & panel multi-chart).
function attachPriceScale(el, c){
  // Notch yang belum sempat dikirim. Akumulasi di domain log (notch), jadi arah berlawanan
  // saling menghapus dengan sendirinya; tak ada timeout — residu selalu mewakili niat pengguna
  // yang belum terlayani, bukan sisa basi.
  let pending = 0;
  el.addEventListener('wheel',(e)=>{
    const rect = el.getBoundingClientRect();
    const edge = plotRightEdge(c, rect);
    const onAxis = (e.clientX-rect.left) >= edge;
    if(!onAxis && !e.shiftKey) return;              // area plot tanpa Shift → zoom-waktu default
    const notches = wheelNotches(e);
    if(!notches) return;
    if(e.pageY < 8) return;                         // rasio pageY jadi tak stabil di dekat tepi atas
    // Titik gesture: di sumbu → kolom yang sama dengan kursor; Shift di plot → tengah sumbu.
    const ax = onAxis ? e.clientX : rect.left + (edge + rect.width)/2;
    // scroll bawah (deltaY>0) → ratio>1 → rentang harga membesar = memampatkan; atas = meregang.
    pending += notches;
    const dy = e.pageY*(Math.pow(SCALE_PER_NOTCH, pending)-1);
    // Belum cukup jauh untuk dihormati KLineCharts → tahan, tapi tetap konsumsi wheel-nya supaya
    // halaman tak ikut scroll dan langkah kecil tak jatuh ke zoom-waktu.
    if(Math.abs(dy) < MIN_MOVE){ e.preventDefault(); e.stopPropagation(); return; }
    const sent = dispatchPriceScale(el, ax, e, dy);
    pending = 0;                                    // gagal pun dibuang: jangan menumpuk lalu meloncat
    if(sent){ e.preventDefault(); e.stopPropagation(); }
  },{passive:false,capture:true});
}
attachPriceScale($('#chart'), chart);
