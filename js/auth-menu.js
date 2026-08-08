// ===================== auth (Fase 2a) =====================
// Avatar akun di pojok kanan toolbar; klik → dropdown (info + saldo + Logout).
function userInitials(name, email){
  const src=(name||email||'?').trim();
  const parts=src.split(/\s+/).filter(Boolean);
  if(parts.length>=2) return (parts[0][0]+parts[1][0]);
  return (src[0]||'?');
}
// isi avatar: foto Google bila ada (fallback inisial bila kosong / gagal muat)
function setAvatar(elm, pic, ini){
  elm.textContent='';
  if(pic){
    const img=document.createElement('img'); img.src=pic; img.alt=''; img.referrerPolicy='no-referrer';
    img.onerror=()=>{ elm.textContent=ini; };
    elm.appendChild(img);
  } else { elm.textContent=ini; }
}
// Identitas pengguna sesi ini, dipakai untuk MENSKOPKAN data lokal per akun (mis. drawsKey() di
// js/draw-persist.js). Diisi sekali saat authGate memastikan sesi valid, sebelum bootApp() jalan.
// Fallback ke email: bila suatu saat /api/auth/me tak menyertakan id, lebih baik terskop lemah
// daripada semua akun berbagi satu kunci di browser yang sama.
let authUid = '';
function onAuthed(u){
  const email = (u && u.email) ? u.email : '';
  authUid = (u && u.id != null) ? String(u.id) : email;
  const name  = (u && u.name)  ? u.name  : email;
  const pic   = (u && u.picture) ? u.picture : '';
  let el = document.getElementById('userMenu');
  if(!el){
    const bar = document.querySelector('.toolbar');
    el = document.createElement('div'); el.id='userMenu'; el.className='user-menu';
    el.innerHTML =
      '<button class="user-avatar" id="userAvatar" title="Account"></button>'+
      '<div class="user-pop" id="userPop">'+
      '  <div class="user-pop-head"><div class="user-av-lg" id="userAvLg"></div>'+
      '    <div class="user-pop-id"><div class="user-pop-name" id="userPopName"></div><div class="user-pop-email" id="userPopEmail"></div>'+
      '      <span class="user-pop-badge">● Demo · Paper</span></div></div>'+
      '  <div class="user-pop-row"><span>Balance</span><b id="userPopBal">—</b></div>'+
      '  <div class="user-pop-row"><span>Theme</span>'+
      '    <span class="theme-seg" id="themeSeg"><button data-theme="dark">Dark</button><button data-theme="light">Light</button></span></div>'+
      '  <button class="user-pop-logout" id="analyticsBtn" style="display:none;margin-bottom:8px">📊 Analytics</button>'+
      '  <button class="user-pop-logout" id="logoutBtn">Logout</button>'+
      '</div>';
    bar.appendChild(el);   // setelah .grow → tertarik ke pojok kanan
    const pop=el.querySelector('#userPop'), av=el.querySelector('#userAvatar');
    av.onclick=(e)=>{ e.stopPropagation();
      const open=!pop.classList.contains('open');
      if(open){ const b=SP.account&&SP.account.balance;
        document.getElementById('userPopBal').textContent = (b!=null)?('$'+(+b).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})):'—'; }
      pop.classList.toggle('open',open);
    };
    pop.addEventListener('click',e=>e.stopPropagation());
    document.addEventListener('click',()=>pop.classList.remove('open'));
    el.querySelector('#logoutBtn').onclick = doLogout;
    el.querySelector('#analyticsBtn').onclick = ()=>{ pop.classList.remove('open'); openAnalyticsDashboard(30); };
    el.querySelectorAll('#themeSeg button').forEach(btn=>{ btn.onclick=()=>applyTheme(btn.dataset.theme); });
    syncThemeUI(document.body.classList.contains('light'));
  }
  const ini=userInitials(name,email);
  setAvatar(el.querySelector('#userAvatar'), pic, ini);
  setAvatar(el.querySelector('#userAvLg'), pic, ini);
  el.querySelector('#userPopName').textContent=name||'—';
  el.querySelector('#userPopEmail').textContent=email;
  el.querySelector('#analyticsBtn').style.display = (u&&u.is_admin)?'block':'none';   // tombol Analytics khusus admin
}
async function doLogout(){
  stopAlertPoll();
  try{ await fetch('/api/auth/logout',{method:'POST'}); }catch(e){}
  location.reload();
}
