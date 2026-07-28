// toast feedback ringan (alert berbunyi / pending tereksekusi) — terlihat tanpa mengandalkan setStatus
let toastTimer=null;
const TOAST_MS=3800;   // durasi tampil + panjang animasi drain bar
// ikon per varian (stroke=currentColor → ikut warna .toast-ic per tipe)
const TOAST_IC={
  success:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.4" x2="12" y2="16.4"/></svg>',
  warn:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12" y2="17"/></svg>',
  info:'<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.6"/></svg>'
};
// toast(msg, type) — type: success | error | warning/warn | info (default). Backward-compatible.
const TOAST_CLOSE_IC='<button class="toast-close" type="button" aria-label="Dismiss"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>';
function toast(msg, type){
  type = type||'info'; if(type==='warning') type='warn';
  let el=$('#toast'); if(!el){ el=document.createElement('div'); el.id='toast'; document.body.appendChild(el); }
  el.className='toast t-'+type;
  el.innerHTML=(TOAST_IC[type]||TOAST_IC.info)+'<span class="toast-msg"></span>'+TOAST_CLOSE_IC+'<div class="toast-bar"></div>';
  el.querySelector('.toast-msg').textContent=msg;
  const hide=()=>{ clearTimeout(toastTimer); toastTimer=null; el.classList.remove('show'); };
  el.querySelector('.toast-close').onclick=hide;   // close paksa
  const bar=el.querySelector('.toast-bar');
  void el.offsetWidth;                        // reflow → transisi re-trigger utk toast berturut
  el.classList.add('show');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){   // drain bar penuh → habis selama TOAST_MS
    bar.style.transition='none'; bar.style.transform='scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition='transform '+TOAST_MS+'ms linear'; bar.style.transform='scaleX(0)';
  }
  clearTimeout(toastTimer); toastTimer=setTimeout(hide,TOAST_MS);
}
