// ===================== dashboard analytics (admin) =====================
let anData=null, anView='features';
function openAnalyticsDashboard(days){
  days=days||30;
  let m=document.getElementById('anModal');
  if(!m){
    m=document.createElement('div'); m.id='anModal'; m.className='dmodal-scrim an-modal';
    m.innerHTML='<div class="dmodal an-box" role="dialog" aria-modal="true" aria-label="Analytics">'
      +'<div class="dm-head"><span class="dm-title">Analytics — feature usage</span>'
      +'<span class="an-days"><button data-d="7">7d</button><button data-d="30">30d</button><button data-d="90">90d</button></span>'
      +'<button class="dm-x" id="anClose" title="Close" aria-label="Close">✕</button></div>'
      +'<div class="dm-body"><div class="an-active" id="anActive"></div>'
      +'<div class="an-tabs"><button data-v="features" class="on">By feature</button><button data-v="users">By user</button></div>'
      +'<div class="an-body" id="anBody"></div></div></div>';
    document.body.appendChild(m);
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&m.classList.contains('show')) m.classList.remove('show'); });
    m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('show'); });
    m.querySelector('#anClose').onclick=()=>m.classList.remove('show');
    m.querySelectorAll('.an-days button').forEach(b=>b.onclick=()=>loadAnalytics(+b.dataset.d));
    m.querySelectorAll('.an-tabs button').forEach(b=>b.onclick=()=>{ anView=b.dataset.v; renderAnalytics(); });
  }
  m.classList.add('show');
  loadAnalytics(days);
}
async function loadAnalytics(days){
  const m=document.getElementById('anModal'); if(!m) return;
  m.querySelectorAll('.an-days button').forEach(b=>b.classList.toggle('on',+b.dataset.d===days));
  m.querySelector('#anBody').innerHTML='<div class="an-empty">Loading…</div>';
  m.querySelector('#anActive').textContent='';
  try{
    const r=await fetch('/api/analytics?days='+days);
    if(!r.ok){ anData=null; m.querySelector('#anBody').innerHTML='<div class="an-empty">Failed to load ('+r.status+'). Make sure you are signed in as admin (ANALYTICS_ADMIN).</div>'; return; }
    anData=await r.json(); renderAnalytics();
  }catch(e){ anData=null; m.querySelector('#anBody').innerHTML='<div class="an-empty">Error: '+(e.message||e)+'</div>'; }
}
function fmtSeen(ts){ if(!ts) return '—'; try{ return new Date(ts).toLocaleString(); }catch(e){ return ts; } }
function renderAnalytics(){
  const m=document.getElementById('anModal'); if(!m||!anData) return;
  m.querySelectorAll('.an-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===anView));
  const au=anData.active_users||{};
  m.querySelector('#anActive').innerHTML='Active users — <b>'+(au.d1||0)+'</b> today · <b>'+(au.d7||0)+'</b> /7 days · <b>'+(au.d30||0)+'</b> /30 days';
  const body=m.querySelector('#anBody');
  if(anView==='users'){
    const users=anData.users||[];
    if(!users.length){ body.innerHTML='<div class="an-empty">No user activity in this range.</div>'; return; }
    body.innerHTML=users.map(u=>'<div class="an-user"><div class="an-user-head"><b>'+u.email+'</b>'
      +'<span>'+u.events+' events · '+fmtSeen(u.last_seen)+'</span></div>'
      +'<div class="an-chips">'+(u.features||[]).map(f=>'<span class="an-chip">'+f.name+' <b>'+f.count+'</b></span>').join('')+'</div></div>').join('');
  } else {
    const feats=anData.features||[];
    if(!feats.length){ body.innerHTML='<div class="an-empty">No events in this range.</div>'; return; }
    const max=Math.max(...feats.map(f=>f.count))||1;
    body.innerHTML='<table class="an-tbl"><thead><tr><th>Feature</th><th>Events</th><th>Users</th><th></th></tr></thead><tbody>'
      +feats.map(f=>'<tr><td>'+f.name+'</td><td>'+f.count+'</td><td>'+f.users+'</td>'
        +'<td class="an-bar-cell"><span class="an-bar" style="width:'+Math.round(f.count/max*100)+'%"></span></td></tr>').join('')
      +'</tbody></table>';
  }
}
