// [sync] Gambar hidup di SERVER per (pengguna, instrumen); localStorage turun pangkat jadi cermin
// yang hanya DIBACA saat request gagal. Rancangan & keputusannya:
// docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

// Versi server per instrumen. null = GET belum pernah sukses → DILARANG mendorong: tanpa
// baseVersion yang benar, dorongan akan menimpa pekerjaan perangkat lain — kegagalan yang persis
// ingin dicegah seluruh rancangan ini.
const drawVer={};

// Isi localStorage utk satu instrumen (jalur penyelamat, bukan sumber kebenaran).
function readLocalDraws(instrument){
  try{ const a=JSON.parse(localStorage.getItem('br_draws_'+instrument)); return Array.isArray(a)?a:[]; }
  catch(_){ return []; }
}

// Muat gambar utk `instrument`. Mengembalikan array siap dioper ke buildDrawsFromArray().
async function loadDrawsFor(instrument){
  let d=null;
  try{
    const r=await fetch('/api/drawings?instrument='+encodeURIComponent(instrument));
    if(!r.ok) throw new Error('HTTP '+r.status);
    d=await r.json();
    // 200 tapi bodinya bukan objek (mis. null) → JANGAN dikira "server kosong utk simbol ini":
    // itu yg memicu adopsi (unggah localStorage sbg versi pertama). Respons tak terbaca berarti
    // kita betul2 tak tahu keadaan server, jadi diperlakukan sama dgn kegagalan jaringan di bawah.
    if(!d||typeof d!=='object') throw new Error('bentuk respons tak terduga');
  }catch(_){
    drawVer[instrument]=null;              // versi tak diketahui → pushDraws menolak mendorong
    return readLocalDraws(instrument);
  }
  drawVer[instrument]=d.version|0;
  const arr=Array.isArray(d.payload)?d.payload:[];
  // Adopsi sekali (migrasi era localStorage): server belum punya apa pun utk simbol ini tapi
  // perangkat ini punya. Unggah yang lokal sbg versi pertama, lalu pakai itu.
  if(!arr.length && drawVer[instrument]===0){
    const local=readLocalDraws(instrument);
    if(local.length){ pushDrawsNow(instrument, local); return local; }
  }
  return arr;
}

// Instrumen yang sedang menunggu keputusan pengguna: instrument → {srv, mine}. Status ini per
// INSTRUMEN & bisa berisi lebih dari satu entri sekaligus (dua simbol bisa bentrok bersamaan).
// `mine` = muatan yang GAGAL terdorong; disimpan karena "Keep mine" harus bisa mengirim ulang
// muatan itu walau pengguna sudah berpindah simbol.
//
// Elemen DOM #syncConflict TUNGGAL (satu banner utk seluruh app) sementara `drawConflict` bisa
// punya banyak entri → banner HARUS jadi VIEW atas entri milik `inst` SAAT INI, bukan diikat ke
// instrumen mana pun yang kebetulan bentrok terakhir. Round 1 review: versi lama merebind
// innerHTML+onclick ke instrumen baru setiap showDrawConflict() dipanggil, jadi (a) instrumen
// PERTAMA yang masih bentrok kehilangan satu-satunya jalur ke hideDrawConflict() → dorongannya
// mati diam2 selamanya (gate di pushDrawsNow), dan (b) banner tetap nongol saat pengguna sudah
// pindah ke simbol lain yg tak ada hubungannya, dgn tombol yg diam2 memutuskan instrumen BEDA
// dari yg sedang dilihat. renderDrawConflict() adalah satu-satunya tempat yg menyentuh DOM;
// dipanggil ulang tiap `drawConflict` berubah ATAU tiap pengguna pindah instrumen (loadInit,
// dekat cancelPendingPushFor) sehingga banner selalu sinkron dgn `inst`.
const drawConflict={};

// Notice MENETAP — sengaja BUKAN toast(): toast hilang sendiri dalam 3,8 dtk dan tak punya slot
// tombol (js/toast.js:13), padahal ini keputusan yang tak boleh terlewat. Mengikuti peringatan
// TradingView "Your chart layout was changed": beri tahu, jangan blokir, biarkan pengguna memilih.
function showDrawConflict(instrument, srv, mine){
  drawConflict[instrument]={srv, mine};
  renderDrawConflict();   // no-op kalau `instrument` bukan `inst` saat ini — entrinya tetap tersimpan, menunggu giliran
}

// Sinkronkan banner tunggal dgn entri drawConflict milik `inst` SAAT INI. Pindah simbol HANYA
// menyembunyikan banner (tak menghapus drawConflict entri manapun) — konfliknya tetap hidup &
// kembali tampil begitu pengguna balik ke instrumen itu.
function renderDrawConflict(){
  const c=drawConflict[inst];
  let el=$('#syncConflict');
  if(!c){ if(el) el.classList.remove('show'); return; }
  if(!el){ el=document.createElement('div'); el.id='syncConflict'; el.className='sync-conflict'; document.body.appendChild(el); }
  el.innerHTML='<span class="sc-msg"></span>'
    +'<button class="sc-act" type="button" data-act="reload">Reload</button>'
    +'<button class="sc-act sc-primary" type="button" data-act="keep">Keep mine</button>';
  el.querySelector('.sc-msg').textContent='Your '+inst+' drawings were changed on another device';
  el.classList.add('show');
  const instrument=inst;   // ditangkap di sini: banner ini SELALU milik `inst` di saat render (lihat guard `if(!c)` di atas)
  el.querySelector('[data-act="reload"]').onclick=()=>{
    const cc=drawConflict[instrument]; hideDrawConflict(instrument);
    if(!cc || instrument!==inst) return;      // sudah pindah simbol lagi sebelum klik → tak ada yang perlu diganti di layar
    const prev=suppressDrawSave; suppressDrawSave=true;
    clearDrawings(); buildDrawsFromArray(cc.srv.payload||[]);
    suppressDrawSave=prev;
    try{ resetDrawHistory(); }catch(_){}     // isi kanvas diganti wholesale → history lama tak lagi bermakna
  };
  el.querySelector('[data-act="keep"]').onclick=()=>{
    const cc=drawConflict[instrument]; hideDrawConflict(instrument);
    if(cc) pushDrawsNow(instrument, cc.mine);  // drawVer sudah = versi server → dorongan ini menimpa
  };
}
function hideDrawConflict(instrument){
  delete drawConflict[instrument];
  renderDrawConflict();   // instrumen yg baru diputuskan boleh jadi BUKAN `inst` skrg → sinkronkan ulang ke `inst`
}

// Dorongan satu tembakan. `opts.keepalive` dipakai saat halaman ditutup.
function pushDrawsNow(instrument, payload, opts){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  if(drawConflict[instrument]) return;      // menunggu keputusan pengguna → jangan menembak 409 lagi
  const init={method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument, payload, baseVersion:base})};
  if(opts&&opts.keepalive) init.keepalive=true;
  return fetch('/api/drawings', init)
    .then(async r=>{
      if(r.status===409){                       // perangkat lain menyimpan duluan
        const d=await r.json().catch(()=>null);
        if(d){ drawVer[instrument]=d.version|0; showDrawConflict(instrument, d, payload); }
        return;
      }
      if(!r.ok) return;                         // gagal sementara → versi tak berubah, dorongan berikutnya mencoba lagi
      const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0;
    })
    .catch(()=>{});
}

const DRAW_PUSH_MS=1500;        // debounce JARINGAN, di atas debounce lokal 350ms (draw-persist)
let drawPushTimer=null;
// Muatan yang menunggu dikirim: {instrument, payload}. Instrumen & isinya DITANGKAP BERSAMAAN saat
// dijadwalkan — bukan dibaca ulang saat kirim. Debounce 1,5 dtk memberi jendela di mana `inst`
// sudah berganti sementara muatan yang antre milik simbol lama; membaca ulang di sana akan
// menyimpan gambar EUR ke baris XAU, kerusakan senyap yang baru ketahuan berhari-hari kemudian.
let drawPushPending=null;

function scheduleSyncDraws(instrument, payload){
  // Simbol beda dari yg lagi antre → selesaikan dulu simbol lama. Dipanggil saat page akan
  // ditutup (lihat beforeunload) sama gawatnya spt saat lanjut dipakai, jadi ikut keepalive:true
  // supaya tak dibatalkan browser di tengah unload (ronde review 1, temuan 2).
  if(drawPushPending && drawPushPending.instrument!==instrument) flushSyncDraws({keepalive:true});
  drawPushPending={instrument, payload};
  clearTimeout(drawPushTimer);
  drawPushTimer=setTimeout(()=>flushSyncDraws(), DRAW_PUSH_MS);
}

// Kirim sekarang apa pun yang tertunda. `opts.keepalive` dipakai saat halaman ditutup.
function flushSyncDraws(opts){
  clearTimeout(drawPushTimer); drawPushTimer=null;
  const p=drawPushPending; drawPushPending=null;
  if(p) pushDrawsNow(p.instrument, p.payload, opts);
}

// Reload INSTRUMEN YANG SAMA (Load tombol tanggal lain, boot ulang, dst) harus membuang dorongan
// yg masih antre milik instrumen itu: restoreDraws() sudah menimpa kanvas dgn state SERVER segar
// & menyegarkan drawVer ke versi sungguhan server — kalau dorongan lama tetap terkirim sesudahnya,
// baseVersion yg baru saja disegarkan itu justru COCOK (server menerimanya begitu saja) dan diam2
// menimpa hasil restore yg benar dgn payload yg sudah basi (ronde review 1, temuan 1: version
// protection tak menangkap ini krn base-nya memang benar, yg basi justru payload-nya).
function cancelPendingPushFor(instrument){
  if(drawPushPending && drawPushPending.instrument===instrument){
    clearTimeout(drawPushTimer); drawPushTimer=null; drawPushPending=null;
  }
}

// Halaman disembunyikan / ditutup → kirim tanpa menunggu debounce. `fetch(keepalive:true)`, BUKAN
// navigator.sendBeacon: semantiknya sama tapi ia lewat jalur yang bisa dicegat page.route, jadi
// jaring pengaman ini ikut TERUJI, bukan sekadar diklaim.
addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSyncDraws({keepalive:true}); });
addEventListener('beforeunload',()=>{ try{ saveDraws(); }catch(_){} flushSyncDraws({keepalive:true}); });
