// ===================== dashboard analytics (admin) =====================
let anData=null, anView='features';
function openAnalyticsDashboard(days){
  days=days||30;
  let m=document.getElementById('anModal');
  if(!m){
    m=document.createElement('div'); m.id='anModal'; m.className='an-modal';
    m.innerHTML='<div class="an-card"><div class="an-head"><span>📊 Analytics — pemakaian fitur</span>'
      +'<span class="an-days"><button data-d="7">7h</button><button data-d="30">30h</button><button data-d="90">90h</button></span>'
      +'<button class="an-x" id="anClose">✕</button></div>'
      +'<div class="an-active" id="anActive"></div>'
      +'<div class="an-tabs"><button data-v="features" class="on">Per fitur</button><button data-v="users">Per user</button></div>'
      +'<div class="an-body" id="anBody"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
    m.querySelector('#anClose').onclick=()=>m.classList.remove('open');
    m.querySelectorAll('.an-days button').forEach(b=>b.onclick=()=>loadAnalytics(+b.dataset.d));
    m.querySelectorAll('.an-tabs button').forEach(b=>b.onclick=()=>{ anView=b.dataset.v; renderAnalytics(); });
  }
  m.classList.add('open');
  loadAnalytics(days);
}
async function loadAnalytics(days){
  const m=document.getElementById('anModal'); if(!m) return;
  m.querySelectorAll('.an-days button').forEach(b=>b.classList.toggle('on',+b.dataset.d===days));
  m.querySelector('#anBody').innerHTML='<div class="an-empty">Memuat…</div>';
  m.querySelector('#anActive').textContent='';
  try{
    const r=await fetch('/api/analytics?days='+days);
    if(!r.ok){ anData=null; m.querySelector('#anBody').innerHTML='<div class="an-empty">Gagal memuat ('+r.status+'). Pastikan kamu login sebagai admin (ANALYTICS_ADMIN).</div>'; return; }
    anData=await r.json(); renderAnalytics();
  }catch(e){ anData=null; m.querySelector('#anBody').innerHTML='<div class="an-empty">Error: '+(e.message||e)+'</div>'; }
}
function fmtSeen(ts){ if(!ts) return '—'; try{ return new Date(ts).toLocaleString(); }catch(e){ return ts; } }
function renderAnalytics(){
  const m=document.getElementById('anModal'); if(!m||!anData) return;
  m.querySelectorAll('.an-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===anView));
  const au=anData.active_users||{};
  m.querySelector('#anActive').innerHTML='Active users — <b>'+(au.d1||0)+'</b> hari ini · <b>'+(au.d7||0)+'</b> /7 hari · <b>'+(au.d30||0)+'</b> /30 hari';
  const body=m.querySelector('#anBody');
  if(anView==='users'){
    const users=anData.users||[];
    if(!users.length){ body.innerHTML='<div class="an-empty">Belum ada aktivitas user pada rentang ini.</div>'; return; }
    body.innerHTML=users.map(u=>'<div class="an-user"><div class="an-user-head"><b>'+u.email+'</b>'
      +'<span>'+u.events+' event · '+fmtSeen(u.last_seen)+'</span></div>'
      +'<div class="an-chips">'+(u.features||[]).map(f=>'<span class="an-chip">'+f.name+' <b>'+f.count+'</b></span>').join('')+'</div></div>').join('');
  } else {
    const feats=anData.features||[];
    if(!feats.length){ body.innerHTML='<div class="an-empty">Belum ada event pada rentang ini.</div>'; return; }
    const max=Math.max(...feats.map(f=>f.count))||1;
    body.innerHTML='<table class="an-tbl"><thead><tr><th>Fitur</th><th>Event</th><th>User</th><th></th></tr></thead><tbody>'
      +feats.map(f=>'<tr><td>'+f.name+'</td><td>'+f.count+'</td><td>'+f.users+'</td>'
        +'<td class="an-bar-cell"><span class="an-bar" style="width:'+Math.round(f.count/max*100)+'%"></span></td></tr>').join('')
      +'</tbody></table>';
  }
}
