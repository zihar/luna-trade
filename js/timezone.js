
// Dropdown zona waktu — pengaruhi chart X-axis + semua label waktu (nyTime).
function applyTimezone(v){
  chartTZ = resolveTZ(v);
  localStorage.setItem('br_tz', v);
  try{ chart.setTimezone(chartTZ); }catch(e){}
  try{ if(T!=null){ lastLen=-1; render(true); } }catch(e){}   // segarkan label overlay (garis vertikal dll)
  try{ if(newsState && !$('#newspanel').classList.contains('hidden')) renderNews(newsState); }catch(e){}   // jam/tanggal news ikut tz baru
  try{ if(typeof closeNewsPop==='function') closeNewsPop(); }catch(e){}   // popup marker terbuka pakai jam lama → tutup
  try{ updatePriceTimer(); }catch(e){}
  try{ updateTzClock(); }catch(e){}
}
// ---- jam + pemilih timezone di pojok kanan-bawah chart (ala TradingView) ----
const TZ_LIST=[
  {tz:'America/New_York',name:'New York'},{tz:'America/Chicago',name:'Chicago'},
  {tz:'America/Sao_Paulo',name:'Sao Paulo'},{tz:'UTC',name:'UTC'},
  {tz:'Europe/London',name:'London'},{tz:'Europe/Berlin',name:'Frankfurt'},
  {tz:'Europe/Moscow',name:'Moscow'},{tz:'Asia/Dubai',name:'Dubai'},
  {tz:'Asia/Kolkata',name:'Mumbai'},{tz:'Asia/Singapore',name:'Singapore'},
  {tz:'Asia/Hong_Kong',name:'Hong Kong'},{tz:'Asia/Tokyo',name:'Tokyo'},
  {tz:'Asia/Jakarta',name:'Jakarta'},{tz:'Australia/Sydney',name:'Sydney'},
];
function tzOffsetLabel(tz){
  try{ const p=new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'shortOffset'})
    .formatToParts(new Date()).find(x=>x.type==='timeZoneName'); return (p?p.value:'UTC').replace('GMT','UTC'); }
  catch(e){ return 'UTC'; }
}
function tzClockText(tz){
  try{ return new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()); }
  catch(e){ return '--:--:--'; }
}
const tzClock=document.createElement('div'); tzClock.className='tz-clock'; tzClock.id='tzClock';
const tzMenu=document.createElement('div');  tzMenu.className='tz-menu';  tzMenu.id='tzMenu';
$('#chart').appendChild(tzClock); $('#chart').appendChild(tzMenu);
function updateTzClock(){ tzClock.textContent = tzClockText(chartTZ)+' '+tzOffsetLabel(chartTZ); }
function buildTzMenu(){
  const localTz=Intl.DateTimeFormat().resolvedOptions().timeZone||NY_TZ;
  const items=TZ_LIST.concat([{tz:localTz,name:'Local',raw:'__local'}]);
  tzMenu.innerHTML=items.map(it=>`<div class="tz-item" data-tz="${it.raw||it.tz}">
      <span class="ck">${chartTZ===it.tz?'✓':''}</span><span class="off">(${tzOffsetLabel(it.tz)})</span><span>${it.name}</span></div>`).join('');
  tzMenu.querySelectorAll('.tz-item').forEach(el=>el.onclick=()=>{ applyTimezone(el.dataset.tz); tzMenu.classList.remove('open'); });
}
tzClock.onclick=(e)=>{ e.stopPropagation(); const open=!tzMenu.classList.contains('open'); if(open) buildTzMenu(); tzMenu.classList.toggle('open',open); };
tzMenu.addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>tzMenu.classList.remove('open'));
updateTzClock(); setInterval(updateTzClock,1000);
