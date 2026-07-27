// Overlay login/register — muncul bila /api/auth/me balas 401.
function showAuthOverlay(){
  if(document.getElementById('authOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'authOverlay'; ov.className = 'auth-overlay';
  ov.innerHTML =
    '<form class="auth-card" id="authForm">'+
    '  <div class="auth-brand"><svg class="glyph" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><mask id="lunaCut2"><rect width="24" height="24" fill="#fff"/><circle cx="15.6" cy="9.4" r="8.4" fill="#000"/></mask><circle class="luna-disc" cx="11.6" cy="12" r="8.4" mask="url(#lunaCut2)"/></svg><span>Luna Trade</span><span class="auth-tagline">Practice the markets, one replay at a time.</span></div>'+
    '  <div class="auth-tabs">'+
    '    <button type="button" class="auth-tab active" data-mode="login">Masuk</button>'+
    '    <button type="button" class="auth-tab" data-mode="register">Daftar</button>'+
    '  </div>'+
    '  <label class="auth-field auth-name" style="display:none">Nama<input type="text" id="authName" autocomplete="name"></label>'+
    '  <label class="auth-field">Email<input type="email" id="authEmail" autocomplete="email" required></label>'+
    '  <label class="auth-field">Password<input type="password" id="authPass" autocomplete="current-password" required minlength="8"></label>'+
    '  <div class="auth-err" id="authErr"></div>'+
    '  <button type="submit" class="auth-submit" id="authSubmit">Masuk</button>'+
    '  <div id="googleWrap" style="display:none;flex-direction:column;gap:14px">'+
    '    <div class="auth-or"><span>atau</span></div>'+
    '    <button type="button" class="auth-google" id="googleBtn">'+
    '      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'+
    '      Lanjutkan dengan Google</button>'+
    '  </div>'+
    '</form>';
  document.body.appendChild(ov);
  let mode = 'login';
  const tabs = ov.querySelectorAll('.auth-tab');
  const nameField = ov.querySelector('.auth-name');
  const submit = ov.querySelector('#authSubmit');
  const err = ov.querySelector('#authErr');
  const pass = ov.querySelector('#authPass');
  tabs.forEach(t=>t.onclick=()=>{
    mode = t.dataset.mode;
    tabs.forEach(x=>x.classList.toggle('active', x===t));
    nameField.style.display = mode==='register' ? '' : 'none';
    submit.textContent = mode==='register' ? 'Daftar' : 'Masuk';
    pass.autocomplete = mode==='register' ? 'new-password' : 'current-password';
    err.textContent = '';
  });
  ov.querySelector('#authForm').onsubmit = async (e)=>{
    e.preventDefault(); err.textContent=''; submit.disabled=true;
    const body = { email: ov.querySelector('#authEmail').value.trim(), password: pass.value };
    if(mode==='register') body.name = ov.querySelector('#authName').value.trim();
    try{
      const r = await fetch('/api/auth/'+mode, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d = await r.json().catch(()=>({}));
      if(r.ok){ location.reload(); return; }   // sesi terset → reload → bootApp jalan
      err.textContent = d.error || 'Gagal — coba lagi';
    }catch(_){ err.textContent = 'Tidak bisa terhubung ke server'; }
    submit.disabled = false;
  };
  ov.querySelector('#authEmail').focus();
  // Tampilkan error dari callback Google (redirect ?auth_error=...), lalu bersihkan URL.
  const qErr = new URLSearchParams(location.search).get('auth_error');
  if(qErr){ err.textContent = qErr; history.replaceState(null,'',location.pathname); }
  // Tampilkan tombol Google hanya bila server mengaktifkannya.
  fetch('/api/auth/config').then(r=>r.json()).then(cfg=>{
    if(cfg && cfg.google){
      ov.querySelector('#googleWrap').style.display = 'flex';
      ov.querySelector('#googleBtn').onclick = ()=>{ location.href = '/api/auth/google'; };
    }
  }).catch(()=>{});
}
// Gerbang: cek sesi dulu. Authed → tampilkan user + bootApp. Tak authed → overlay.
(async function authGate(){
  try{
    const r = await fetch('/api/auth/me');
    if(r.ok){ onAuthed(await r.json()); bootApp(); }
    else { showAuthOverlay(); }
  }catch(e){ showAuthOverlay(); }
})();
