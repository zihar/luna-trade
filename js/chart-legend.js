// ===================== legend chart (OHLC + info instrumen, ala TradingView) =====================
// Satu baris di kiri-atas chart (ala TradingView):
//  • Info instrumen (overlay HTML #chartLegend, kiri): ikon pair + nama lengkap + TF; klik → picker.
//  • OHLC + change abs/% (legend candle NATIVE klinecharts, custom): SEJAJAR di kanan nama via offsetLeft
//    dinamis (= lebar blok nama). Native → ikut crosshair otomatis & legend indikator menumpuk di bawahnya.
// candleTooltipCustom dipakai di darkStyles/lightStyles, DIBUNGKUS di sana jadi pemanggilan
// tertunda: deklarasinya ada di bawah pemakainya, jadi menyerahkannya sebagai nilai hanya aman
// selama satu blok inline. Lihat komentar di titik pemakaiannya.
function chartLegendColors(){
  return document.body.classList.contains('light')
    ? {up:'#1a9d6e', down:'#d8504e', mut:'#697280'}
    : {up:'#54c88c', down:'#ff6f6f', mut:'#89898b'};
}
function candleTooltipCustom(d){
  const c=d&&d.current; if(!c) return [];
  const col=chartLegendColors(), dec=priceDecimals(), f=v=>(+v).toFixed(dec);
  const vc = c.close>=c.open ? col.up : col.down;                 // O/H/L/C diwarnai arah bar
  const prevClose = d.prev ? d.prev.close : c.open;
  const chg=c.close-prevClose, pct=prevClose?chg/prevClose*100:0;
  const cc = chg>=0 ? col.up : col.down, sg = chg>=0 ? '+' : '';
  const t=(k)=>({text:k, color:col.mut});
  return [
    {title:t('O'), value:{text:f(c.open),  color:vc}},
    {title:t('H'), value:{text:f(c.high),  color:vc}},
    {title:t('L'), value:{text:f(c.low),   color:vc}},
    {title:t('C'), value:{text:f(c.close), color:vc}},
    {title:t(''),  value:{text:`${sg}${f(chg)} (${sg}${pct.toFixed(2)}%)`, color:cc}},
  ];
}
// Info instrumen (overlay HTML) hanya berubah saat ganti instrumen/TF; OHLC ditangani native (sejajar
// di kanan-nya). Lebar blok nama variabel → geser offsetLeft OHLC native = ujung-kanan nama + jarak,
// supaya keduanya SATU baris (ala TradingView) apa pun panjang namanya.
function updateChartLegend(){
  const btn=$('#clInst'), pairEl=$('#clPair'), nameEl=$('#clName'), tfEl=$('#clTf');
  if(!nameEl) return;
  try{ if(pairEl) pairEl.innerHTML = ipkPair(inst); }catch(e){}
  nameEl.textContent = (ipkMeta(inst).name)||inst.replace('_','/');
  if(tfEl) tfEl.textContent = TF_LABEL[currentTF]||currentTF;
  try{
    const legLeft=parseInt(getComputedStyle($('#chartLegend')).left)||12;   // 12px
    const marL=parseInt(getComputedStyle(btn).marginLeft)||0;               // -5px
    const w=btn.offsetWidth;
    if(w) chart.setStyles({ candle:{ tooltip:{ offsetLeft: legLeft+marL+w+6 } } });
  }catch(e){}
}
(function initChartLegend(){
  const btn=$('#clInst');
  // stopPropagation: cegah listener outside-click global (#ipick) langsung menutup picker yg baru dibuka
  if(btn){ btn.onclick=e=>{ e.stopPropagation(); openIpick(); };
    btn.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); e.stopPropagation(); openIpick(); } }; }
  // populate awal ditunda: IPK_META (const) dideklarasi setelah blok ini → hindari TDZ saat parse
  setTimeout(()=>{ try{ updateChartLegend(); }catch(e){} }, 0);
})();

