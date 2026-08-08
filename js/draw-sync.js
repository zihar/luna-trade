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

// Dorongan satu tembakan. `opts.keepalive` dipakai saat halaman ditutup.
function pushDrawsNow(instrument, payload, opts){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  const init={method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument, payload, baseVersion:base})};
  if(opts&&opts.keepalive) init.keepalive=true;
  return fetch('/api/drawings', init)
    .then(async r=>{ if(!r.ok) return; const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0; })
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
  if(drawPushPending && drawPushPending.instrument!==instrument) flushSyncDraws();   // selesaikan simbol lama dulu
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

// Halaman disembunyikan / ditutup → kirim tanpa menunggu debounce. `fetch(keepalive:true)`, BUKAN
// navigator.sendBeacon: semantiknya sama tapi ia lewat jalur yang bisa dicegat page.route, jadi
// jaring pengaman ini ikut TERUJI, bukan sekadar diklaim.
addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSyncDraws({keepalive:true}); });
addEventListener('beforeunload',()=>{ try{ saveDraws(); }catch(_){} flushSyncDraws({keepalive:true}); });
