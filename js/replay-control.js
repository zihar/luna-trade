// ===================== replay control =====================
async function step(d){
  if(T==null) return;
  if(!replayMode){ stopLive(); setReplayUI(true); }   // stepping = masuk mode Bar Replay
  const arr=tfData[currentTF];
  // Batas tutup lewat barEndAt (bukan +DUR): untuk MN, DUR salah 13j–58j tergantung bulan, dan di
  // sini itu berarti satu langkah replay mendarat di tengah bar, bukan di tutupnya.
  let lo=0,h=arr.length;
  while(lo<h){ const m=(lo+h)>>1; if(barEndAt(currentTF,m,arr)<=T) lo=m+1; else h=m; }
  const idx=lo-1;
  if(d>0){
    if(idx+1>=arr.length){ autoExtend(currentTF); pauseIfNoData(); return; }
    const ni=idx+1; T=barEndAt(currentTF,ni,arr);
    await evalFills(T);   // fill SL/TP/pending & alert intra-bar (sub-bar halus s/d T)
    if(arr.length-ni<30) autoExtend(currentTF);
  }else{
    if(idx<=0) return;
    T=barEndAt(currentTF,idx-1,arr);   // tutup bar sebelumnya — cermin cabang maju; `+DUR` meleset di MN
    fillT=T;   // mundur → turunkan frontier ke cursor baru: order/alert yg dibuat/diedit di sini ikut dievaluasi saat maju lagi (bukan ter-skip)
  }
  replayPartial=null;   // Step = 1 bar penuh → T re-align ke boundary, forming bar tak berlaku
  render();
}
function pauseIfNoData(){ if(playing){ pause(); setStatus('Pulling data forward… press Play again.'); } }
$('#nextBtn').onclick=()=>step(1);
$('#prevBtn').onclick=()=>step(-1);
$('#playBtn').onclick=togglePlay;
$('#replayToggle').onclick=()=>{ const b=$('#replaybar'); const c=b.classList.toggle('collapsed'); $('#replayToggle').textContent=c?'⏶':'⏷'; };
$('#bottomToggle').onclick=()=>{ const b=$('#bottompanel'); const c=b.classList.toggle('collapsed'); $('#bottomToggle').textContent=c?'⏶':'⏷'; localStorage.setItem('br_bottomHidden',c?'1':''); chart.resize(); if(!c) drawEquity(); };
window.addEventListener('resize',()=>{ try{drawEquity();}catch(e){} });
// pulihkan kondisi hide/unhide terakhir — default hidden (collapse kecuali user pernah set tampil '0')
if(localStorage.getItem('br_bottomHidden')!=='0'){ $('#bottompanel').classList.add('collapsed'); $('#bottomToggle').textContent='⏶'; }
$('#speed').onchange=()=>{};   // playFrame membaca speed tiap frame → tak perlu restart (restart = race re-entrancy)
function togglePlay(){ playing?pause():play(); }
function play(){
  if(T==null) return;
  if(playing) return;   // sudah Play → jangan mulai loop frame kedua (anti re-entrancy)
  if(!replayMode){ stopLive(); setReplayUI(true); }
  playing=true; $('#playBtn').textContent='⏸'; try{syncReplayPill();}catch(e){}
  playFrame();
}
// Loop frame halus: majukan T proporsional speed (bar/detik), render forming bar tiap frame.
async function playFrame(){
  if(!playing) return;
  const arr=tfData[currentTF]; if(!arr||!arr.length){ pause(); return; }
  const rev=revealed(currentTF);
  if(rev.length>=arr.length){ autoExtend(currentTF); pauseIfNoData(); return; }   // ujung data → pause (tekan Play lagi setelah extend)
  const dur=DUR[currentTF], speed=+$('#speed').value||1;
  T += Math.max(1, dur*speed*REPLAY_FRAME_MS/1000);   // maju proporsional speed (frame ~fixed)
  const after=revealed(currentTF);
  // Lompati gap mati (weekend/libur): jika bar berikutnya baru buka setelah T, jangan merangkak lewat
  // waktu kosong — langsung ke pembukaannya. Tanpa ini, Jumat→Senin bisa puluhan detik chart diam.
  const nb=tfData[currentTF][after.length]; if(nb && nb.timestamp>T) T=nb.timestamp;
  await evalFills(T);   // fill SL/TP/pending & alert intra-bar via sub-bar halus (pakai T final setelah gap-skip)
  if(after.length-1 > arr.length-30) autoExtend(currentTF);
  replayPartial=null;
  try{ const c=await buildReplayPartial(currentTF); if(c) replayPartial={tf:currentTF,candle:c}; }catch(e){}
  render();
  if(playing) playTimer=setTimeout(playFrame, REPLAY_FRAME_MS);
}
function pause(){ playing=false; $('#playBtn').textContent='▶'; try{syncReplayPill();}catch(e){} clearTimeout(playTimer); clearInterval(playTimer); }

// ===================== auto-extend forward =====================
async function autoExtend(tf){
  if(extending[tf]) return;
  const arr=tfData[tf]; if(!arr||!arr.length) return;
  extending[tf]=true;
  try{
    const from=new Date(arr[arr.length-1].timestamp+1000).toISOString();
    const more=await fetchCandles(tf,{count:FWD_CHUNK,from});
    const last=arr[arr.length-1].timestamp;
    const fresh=more.filter(c=>c.timestamp>last);
    if(fresh.length){ arr.push(...fresh); render(); }
    else setStatus('Already at the latest OANDA data for '+tf+'.');
  }catch(e){ setStatus('Auto-extend failed: '+e.message,true); }
  finally{ extending[tf]=false; }
}

