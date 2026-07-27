// ===================== TF buttons =====================
const tfWrap = $('#tfbtns');
const TF_LABEL = {MN:'M'};   // label tampil per-TF (key internal tetap, mis. MN → "M")
const tfMoreBtn = $('#tfMore');
const tfMenu = $('#tfMenu');
const TF_FAV_DEFAULT = ['M15','D'];
// favorit TF yang tampil di bar (custom per-user, ala TradingView) — disimpan di localStorage.
function loadTFFav(){
  try{ const a=JSON.parse(localStorage.getItem('br_tfFav'));
    if(Array.isArray(a)){ const f=a.filter(t=>TF_LIST.includes(t)); if(f.length) return f; }
  }catch(e){}
  return TF_FAV_DEFAULT.slice();
}
let tfFav = loadTFFav();
function saveTFFav(){ try{ localStorage.setItem('br_tfFav', JSON.stringify(tfFav)); }catch(e){} }
function toggleTFFav(tf){
  const i=tfFav.indexOf(tf);
  if(i>=0){ if(tfFav.length<=1) return; tfFav.splice(i,1); }   // sisakan minimal 1 favorit
  else tfFav.push(tf);
  saveTFFav(); refreshAllTFBars();   // favorit dipakai bersama chart utama & panel sekunder
}
// refresh semua TF bar (utama + sekunder) + menu yg sedang terbuka — dipanggil saat favorit berubah
function refreshAllTFBars(){
  rebuildTFBar(); if(tfMenu.classList.contains('open')) buildTFMenu();
  secondaries.forEach(sc=>{ try{ sc.rebuildTFBar(); if(sc.menuEl.classList.contains('open')) sc.buildMenu(); }catch(e){} });
}
// tutup semua dropdown TF yg terbuka (utama + sekunder)
function closeAllTFMenus(){
  if(tfMenu.classList.contains('open')) closeTFMenu();
  secondaries.forEach(sc=>{ try{ sc.closeMenu(); }catch(e){} });
}
// tombol di bar = favorit (urut kanonik TF_LIST) + TF aktif bila bukan favorit (tampil sementara)
function rebuildTFBar(){
  const show = TF_LIST.filter(tf=> tfFav.includes(tf) || tf===currentTF);
  tfWrap.innerHTML='';
  show.forEach(tf=>{
    const b=document.createElement('button');
    b.className='tf'+(tf===currentTF?' on':''); b.textContent=TF_LABEL[tf]||tf; b.dataset.tf=tf;
    b.onclick=()=>switchTF(tf);
    tfWrap.appendChild(b);
  });
}
// dropdown: semua TF; klik label → pindah TF, klik ★ → toggle favorit (muncul/hilang di bar)
function buildTFMenu(){
  tfMenu.innerHTML='';
  TF_LIST.forEach(tf=>{
    const row=document.createElement('div');
    row.className='tf-row'+(tf===currentTF?' on':''); row.setAttribute('role','menuitem');
    const lbl=document.createElement('span'); lbl.className='tf-lbl'; lbl.textContent=TF_LABEL[tf]||tf;
    lbl.onclick=()=>{ closeTFMenu(); switchTF(tf); };
    const fav=tfFav.includes(tf);
    const star=document.createElement('span');
    star.className='tf-star'+(fav?' fav':''); star.textContent='★';
    star.title=fav?'Remove from favorites':'Add to favorites';
    star.onclick=(e)=>{ e.stopPropagation(); toggleTFFav(tf); };
    row.append(lbl,star);
    tfMenu.appendChild(row);
  });
}
function openTFMenu(){ closeAllTFMenus(); buildTFMenu(); tfMenu.classList.add('open'); tfMoreBtn.classList.add('on'); tfMoreBtn.setAttribute('aria-expanded','true'); }
function closeTFMenu(){ tfMenu.classList.remove('open'); tfMoreBtn.classList.remove('on'); tfMoreBtn.setAttribute('aria-expanded','false'); }
tfMoreBtn.onclick=(e)=>{ e.stopPropagation(); tfMenu.classList.contains('open')?closeTFMenu():openTFMenu(); };
// klik di luar → tutup dropdown mana pun (utama & sekunder) yg tak berada di wrap yg diklik
document.addEventListener('click',(e)=>{
  const inWrap=e.target.closest('.tfwrap,.cp-tfwrap');
  if(tfMenu.classList.contains('open') && inWrap!==tfMenu.parentElement) closeTFMenu();
  secondaries.forEach(sc=>{ try{ if(sc.menuEl.classList.contains('open') && inWrap!==sc.menuEl.parentElement) sc.closeMenu(); }catch(e){} });
});
// highlightTF dipanggil di banyak tempat saat currentTF berubah → rebuild bar (agar TF non-favorit aktif ikut tampil/hilang) & refresh menu bila terbuka.
function highlightTF(){ rebuildTFBar(); if(tfMenu.classList.contains('open')) buildTFMenu(); updateChartWM(); }
// dispSym: nama simbol untuk TAMPILAN — buang namespace 'STOCK:' & suffix bursa ('.JK'),
// serta pemisah '_' (format OANDA). Data & routing tetap pakai simbol lengkap.
function dispSym(s){ return String(s).replace(/^STOCK:/,'').replace(/\.[A-Z]+$/,'').replace('_',''); }
// watermark kanvas: crescent + "SIMBOL · TF" (ikut instrumen & timeframe aktif)
function updateChartWM(){ try{ updateChartLegend(); }catch(e){}   // legend kiri-atas ikut ganti instrumen/TF
  if(!chartWmEl) return; const t=chartWmEl.querySelector('.wm-t');
  if(t) t.textContent = dispSym(inst) + ' · ' + (TF_LABEL[currentTF]||currentTF); }
rebuildTFBar();

