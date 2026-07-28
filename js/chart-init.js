const chart = klinecharts.init('chart', {styles:darkStyles, timezone:chartTZ, customApi:{formatDate:chartFormatDate}});
new ResizeObserver(()=>{ chart.resize(); try{updatePriceTimer();}catch(e){} try{repositionNewsMarkers();}catch(e){} }).observe($('#chart'));
// Jaring pengaman: setelah web-font siap, satu re-measure bersih (sumbu klinecharts diukur ulang dgn Inter final)
try{ if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{ try{ chart.resize(); }catch(e){} }); }catch(e){}

