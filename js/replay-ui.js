// ===================== Bar Replay (mode chart, ala TradingView) =====================
// Live realtime = DEFAULT (tanpa tombol on/off). Bar Replay = mode terpisah: klik tombol →
// pilih titik mulai di chart → stepping historis (live mati). Klik lagi = keluar → realtime.
let pickMode=false, hoverTs=null, replayMode=false;
const replayBtn=$('#replayPick');
chart.subscribeAction('onCrosshairChange', d=>{ if(d&&d.kLineData&&d.kLineData.timestamp!=null){ hoverTs=d.kLineData.timestamp; if(pickMode) updatePickCut(hoverTs); } });
// ===== pick-mode "cut cursor" (garis pemisah + sisi kanan dipudarkan) =====
function setPickCut(on){
  const host=document.querySelector('.cpanel-pri');
  host.classList.toggle('picking', on);
  if(on) host.style.setProperty('--pcx', host.getBoundingClientRect().width+'px');   // mulai: garis di tepi kanan (veil kosong)
  // sembunyikan crosshair bawaan (garis putus2 + label) saat pick agar tak redundan dg garis potong.
  // top-level show tetap true → onCrosshairChange masih memicu updatePickCut.
  try{ chart.setStyles({ crosshair:{ horizontal:{ show:!on }, vertical:{ show:!on } } }); }catch(e){}
}
function pickCutX(ts){   // ts bar → x tepi-kanan bar (center + setengah lebar bar) relatif tepi kiri chart
  try{
    const p=chart.convertToPixel({timestamp:ts},{paneId:'candle_pane'});
    const x=Array.isArray(p)?(p[0]&&p[0].x):(p&&p.x);
    if(typeof x!=='number') return null;
    let half=4; try{ const bs=chart.getBarSpace(); half=(bs&&bs.halfBar)||(bs&&bs.bar&&bs.bar/2)||half; }catch(e){}
    return x+half;
  }catch(e){ return null; }
}
// label pick = crosshairDate → konsisten dgn sumbu/hover (ikut shift trading-day utk Daily + tanpa jam).
function fmtCutDate(ts){
  try{ return crosshairDate(ts); }
  catch(e){ return ''; }
}
function updatePickCut(ts){
  if(ts==null) return;
  const x=pickCutX(ts);
  if(x!=null) document.querySelector('.cpanel-pri').style.setProperty('--pcx', x+'px');
  const el=$('#pcDate'); if(el) el.textContent=fmtCutDate(ts);
}
function setReplayUI(on){
  replayMode=on;
  $('#replaybar').classList.toggle('replaying', on);
  $('#replayCtrls').classList.toggle('on', on);   // kontrol lama (tersembunyi; sumber nilai #speed)
  replayBtn.classList.toggle('on', on);
  replayBtn.textContent = on ? '⏹ Exit Replay' : '⏮ Bar Replay';
  replayBtn.title = on ? 'Exit replay → back to realtime' : 'Pick replay start point directly on the chart';
  // floating pill + watermark crescent (aware mode replay)
  document.querySelector('.cpanel-pri').classList.toggle('replay-on', on);
  $('#replayPill').classList.toggle('on', on);
  if(on){ syncReplayPill(); } else { $('#rpSelect').classList.remove('armed'); fillT=null; }   // keluar replay (Exit / Load / ganti instrumen) → frontier fill bersih (jangan basi lintas-sesi)
  applyPaperMode();   // replay → client-side; realtime → akun live server
}
function exitReplay(){
  pause();                 // hentikan loop playback bila sedang Play (jangan lanjut melawan live mode)
  pickMode=false;
  replayPartial=null; fillT=null;
  replayFiredAlerts.clear();   // reset dedup alert replay saat keluar
  setPickCut(false);
  setReplayUI(false);
  const arr=tfData[currentTF];
  if(arr&&arr.length) T=arr[arr.length-1].timestamp+DUR[currentTF];   // lompat ke bar terbaru
  lastLen=-1; render(true);
  startLive();                       // kembali realtime (default)
  setStatus('');
}
replayBtn.onclick=()=>{
  if(replayMode){ exitReplay(); return; }              // sedang replay → keluar ke realtime
  if(T==null){ setStatus('Load first.',true); return; }
  track('replay',{inst});
  pickMode=!pickMode; replayBtn.classList.toggle('on',pickMode);
  if(pickMode){
    chart.applyNewData(tfData[currentTF]); lastLen=tfData[currentTF].length;  // tampilkan semua bar
    setStatus('Bar Replay: point & CLICK a bar on the chart to pick the replay start.');
  }else{ render(true); setStatus('Point selection cancelled.'); }
  setPickCut(pickMode);   // garis potong + veil kanan hanya saat pick
};
const REPLAY_SCROLL_MS=700;   // durasi animasi geser ke bar yang dipilih
$('#chart').addEventListener('click',()=>{
  if(!pickMode||hoverTs==null) return;
  const ts=hoverTs;
  pickMode=false;
  setPickCut(false);                 // pick selesai → hilangkan garis potong + veil
  $('#rpSelect').classList.remove('armed');   // re-select selesai (bila dipicu dari pill)
  stopLive();                        // replay = realtime mati
  setReplayUI(true);                 // masuk mode replay → kontrol step tampil
  setStatus('Replay from '+nyTime(ts)+' (NY) …');
  // animasi: bar yang diklik meluncur ke tepi kanan (semua bar masih tampil),
  // lalu setelah animasi selesai data dipotong di titik itu → transisi mulus tanpa lompat.
  try{ chart.scrollToTimestamp(ts, REPLAY_SCROLL_MS); }catch(e){}
  // pick EXCLUSIVE: T = buka bar yg diklik = tutup bar sebelumnya → bar terakhir tampil = 1 bar SEBELUM ts.
  // Bar yg diklik belum muncul; step(1) berikutnya baru mengungkapnya (mulai backtest tepat di bar itu).
  setTimeout(()=>{ T=ts; fillT=T; replayPartial=null; lastLen=-1; replayFiredAlerts.clear(); render(true);
    setStatus('Replay from '+nyTime(ts)+' (NY). Next/Play to advance.'); }, REPLAY_SCROLL_MS+30);
});

// ===================== floating pill playback (ala TradingView) =====================
// Konsolidasi kontrol replay ke pill melayang di bawah chart. Delegasi ke fungsi lama
// (step/togglePlay/exitReplay) + fitur baru "Select bar" = re-pick tanpa keluar replay.
const RP_PLAY_SVG='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const RP_PAUSE_SVG='<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const RP_SPEEDS=[10,7,5,3,1,0.5,0.3,0.2,0.1];   // candles/detik; <1 = 1 candle per N detik
function syncReplayPill(){
  const sp=$('#speed'); if(sp) $('#rpSpeed').textContent=sp.value+'×';
  if(typeof currentTF!=='undefined' && currentTF) $('#rpTf').textContent=currentTF;
  $('#rpPlay').innerHTML = playing ? RP_PAUSE_SVG : RP_PLAY_SVG;
}
// Select bar lagi TANPA keluar replay: masuk pick-mode; handler klik #chart yg ada set titik baru.
function pickBarAgain(){
  if(!replayMode) return;
  if(pickMode){   // sudah armed → batalkan
    pickMode=false; $('#rpSelect').classList.remove('armed'); setPickCut(false);
    setStatus('Bar selection cancelled.'); return;
  }
  if(playing) pause();
  pickMode=true; $('#rpSelect').classList.add('armed'); setPickCut(true);
  // JANGAN reveal seluruh data — itu melompat ke "sekarang" + membocorkan candle masa depan.
  // Tetap di posisi replay saat ini; user memilih bar dari histori yang sudah tampil.
  setStatus('Select bar: click a bar in view to move the replay start (no jump to now).');
}
// Menu pilih speed (ala TradingView): klik pill speed → daftar 10×…0.1×. playFrame baca #speed tiap
// frame, jadi memilih cukup set #speed.value (tanpa restart loop). Speed <1 = 1 candle per N detik.
function speedDesc(s){ return s>=1 ? (s+' upd per 1 sec') : ('1 upd per '+Math.round(1/s)+' sec'); }
const rpSpeedMenu=document.createElement('div'); rpSpeedMenu.className='rp-speed-menu'; rpSpeedMenu.setAttribute('role','menu'); document.body.appendChild(rpSpeedMenu);
function buildSpeedMenu(){
  const cur=$('#speed')?+$('#speed').value:3;
  rpSpeedMenu.innerHTML='<div class="rpm-hd">Replay Speed</div>'+RP_SPEEDS.map(s=>
    `<div class="rpm-row${cur===s?' on':''}" role="menuitem" data-s="${s}"><span class="rpm-x">${s}×</span><span class="rpm-d">${speedDesc(s)}</span></div>`).join('');
  rpSpeedMenu.querySelectorAll('.rpm-row').forEach(r=>r.onclick=()=>{ setReplaySpeed(r.dataset.s); closeSpeedMenu(); });
}
function setReplaySpeed(s){ const sp=$('#speed'); if(sp) sp.value=s; try{localStorage.setItem('br_speed',s);}catch(e){} try{syncReplayPill();}catch(e){} }
function openSpeedMenu(){
  buildSpeedMenu(); rpSpeedMenu.classList.add('open');
  const b=$('#rpSpeed').getBoundingClientRect(), mw=rpSpeedMenu.offsetWidth, mh=rpSpeedMenu.offsetHeight;
  let left=b.left+b.width/2-mw/2; left=Math.max(8,Math.min(left,window.innerWidth-mw-8));
  rpSpeedMenu.style.left=left+'px'; rpSpeedMenu.style.top=Math.max(8,b.top-mh-8)+'px';   // di ATAS pill
}
function closeSpeedMenu(){ rpSpeedMenu.classList.remove('open'); }
$('#rpSelect').onclick=pickBarAgain;
$('#rpPrev').onclick=()=>step(-1);
$('#rpPlay').onclick=togglePlay;
$('#rpNext').onclick=()=>step(1);
$('#rpSpeed').onclick=(e)=>{ e.stopPropagation(); rpSpeedMenu.classList.contains('open')?closeSpeedMenu():openSpeedMenu(); };
document.addEventListener('mousedown',e=>{ if(rpSpeedMenu.classList.contains('open') && !rpSpeedMenu.contains(e.target) && !$('#rpSpeed').contains(e.target)) closeSpeedMenu(); }, true);
$('#rpExit').onclick=exitReplay;
// pulihkan speed tersimpan
try{ const sv=localStorage.getItem('br_speed'); if(sv && $('#speed') && RP_SPEEDS.includes(+sv)) $('#speed').value=sv; }catch(e){}

