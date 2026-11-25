// ===================== Cheat-sheet shortcut keyboard (tekan `?`) =====================
// Dialog daftar semua hotkey & gestur modifier. Dibuka lewat `?` atau Ctrl/⌘+/ (js/keyboard.js)
// dan item "Keyboard shortcuts" di menu akun (js/auth-menu.js).
//
// Daftar tool drawing TIDAK ditulis ulang di sini: diturunkan dari `sc` di DRAW_GROUPS
// (js/draw-catalog.js) — satu sumber, jadi tool baru ber-shortcut otomatis ikut tampil.
// Sisanya tabel statis: kalau menambah hotkey baru di keyboard.js / modul gestur, tambahkan
// barisnya di SHORTCUT_SECTIONS juga.
//
// Konten dibangun saat dibuka (bukan top-level) → aman dari referensi eager lintas file.

const SHORTCUT_SECTIONS = [
  { title: 'Chart', rows: [
    ['Change interval', [['1–9']]],
    ['Symbol search', [['A–Z'], ['/']]],
    ['Zoom price scale', [['Shift', 'Wheel']]],
    ['Quick measure', [['Shift', 'Drag']]],
    ['Keyboard shortcuts', [['?'], ['Mod', '/']]],
  ]},
  { title: 'Bar Replay', rows: [
    ['Next bar', [['→']]],
    ['Previous bar', [['←']]],
    ['Play / Pause', [['Space']]],
  ]},
  { title: 'Drawings', rows: [
    ['Undo', [['Mod', 'Z']]],
    ['Redo', [['Mod', 'Shift', 'Z'], ['Mod', 'Y']]],
    ['Copy / Paste', [['Mod', 'C'], ['Mod', 'V']]],
    ['Delete selected', [['Delete'], ['Backspace']]],
    ['Cancel / Deselect', [['Esc']]],
    ['Add to selection', [['Mod', 'Click']]],
    ['Box select', [['Mod', 'Drag empty area']]],
    ['Clone', [['Mod', 'Drag drawing']]],
    ['Group / Ungroup', [['Mod', 'G'], ['Mod', 'Shift', 'G']]],
    ['Lock angle (45°)', [['Shift', 'Drag point']]],
    ['Invert magnet', [['Hold', 'Mod']]],
  ]},
];

const scEsc=(s)=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
// label tombol sesuai OS. IS_MAC dari js/draw-rail.js (dipanggil saat buka → sudah termuat).
function scKeyLabel(k){
  if(!IS_MAC) return k==='Mod' ? 'Ctrl' : k;
  return ({ Mod:'⌘', Shift:'⇧', Alt:'⌥' })[k] || k;
}
// aksi mouse (Drag/Click/Wheel) & "Hold" = teks biasa, bukan tombol
const SC_ACTION=/^(Hold|Click|Wheel|Drag\b)/;
function scComboHTML(combo){
  let h='';
  combo.forEach((k,i)=>{
    // "Hold" menempel ke tombol sesudahnya tanpa '+'
    if(i>0) h += combo[i-1]==='Hold' ? ' ' : '<i>+</i>';
    h += SC_ACTION.test(k) ? '<span class="kbs-act">'+scEsc(k)+'</span>' : '<kbd>'+scEsc(scKeyLabel(k))+'</kbd>';
  });
  return '<span class="kbs-combo">'+h+'</span>';
}
function scRowHTML(label, combos){
  return '<div class="kbs-row"><span class="kbs-lbl">'+scEsc(label)+'</span><span class="kbs-keys">'
    +combos.map(scComboHTML).join('<i class="kbs-or">or</i>')+'</span></div>';
}
function shortcutSections(){
  const tools=[];
  DRAW_GROUPS.forEach(g=>g.tools.forEach(t=>{ if(t.sc) tools.push([t.title, [['Alt', t.sc]]]); }));
  const out=SHORTCUT_SECTIONS.slice();
  out.splice(2, 0, { title: 'Drawing tools', rows: tools });
  return out;
}

let kbsEl=null;
function shortcutsOpen(){ return !!(kbsEl && kbsEl.classList.contains('show')); }
function closeShortcutsHelp(){ if(kbsEl) kbsEl.classList.remove('show'); }
function openShortcutsHelp(){
  if(!kbsEl){
    kbsEl=document.createElement('div'); kbsEl.className='kbs-scrim';
    kbsEl.addEventListener('mousedown',e=>{ if(e.target===kbsEl) closeShortcutsHelp(); });
    document.body.appendChild(kbsEl);
  }
  kbsEl.innerHTML='<div class="kbs-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">'
    +'<div class="kbs-head"><span class="kbs-title">Keyboard shortcuts</span>'
    +'<button class="dm-x kbs-x" title="Close" aria-label="Close">✕</button></div>'
    +'<div class="kbs-body">'+shortcutSections().map(s=>
      '<section class="kbs-sec"><h4>'+scEsc(s.title)+'</h4>'+s.rows.map(r=>scRowHTML(r[0], r[1])).join('')+'</section>'
    ).join('')+'</div></div>';
  kbsEl.querySelector('.kbs-x').onclick=closeShortcutsHelp;
  kbsEl.classList.add('show');
}
function toggleShortcutsHelp(){ shortcutsOpen() ? closeShortcutsHelp() : openShortcutsHelp(); }

// Saat dialog terbuka, keyboard milik dialog: Esc / ? / Ctrl/⌘+/ menutup, tombol lain ditelan
// supaya huruf tak membuka symbol search & panah tak melangkah replay di belakangnya.
window.addEventListener('keydown',e=>{
  if(!shortcutsOpen()) return;
  if(e.key==='Escape' || e.key==='?' || ((e.ctrlKey||e.metaKey) && e.key==='/')){ e.preventDefault(); closeShortcutsHelp(); }
  else if(!(e.ctrlKey||e.metaKey)) e.preventDefault();
  e.stopImmediatePropagation();
},true);
