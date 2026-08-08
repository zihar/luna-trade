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

// Dorongan satu tembakan. Task 4 menambahkan penjadwalan & flush di atasnya.
function pushDrawsNow(instrument, payload){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  return fetch('/api/drawings',{method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument, payload, baseVersion:base})})
    .then(async r=>{ if(!r.ok) return; const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0; })
    .catch(()=>{});
}
