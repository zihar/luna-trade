// [sync] Gambar hidup di SERVER per (pengguna, instrumen); localStorage turun pangkat jadi cermin
// yang hanya DIBACA saat request gagal. Rancangan & keputusannya:
// docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

// Versi server per instrumen. null = GET belum pernah sukses → DILARANG mendorong: tanpa
// baseVersion yang benar, dorongan akan menimpa pekerjaan perangkat lain — kegagalan yang persis
// ingin dicegah seluruh rancangan ini.
const drawVer={};

// Isi localStorage utk satu instrumen (jalur penyelamat, bukan sumber kebenaran). Format kuncinya
// hidup di SATU tempat — drawsKey() (js/draw-persist.js) — supaya skop per-pengguna tak bisa
// benar di satu pembaca dan salah di pembaca lain.
function readLocalDraws(instrument){
  try{ const a=JSON.parse(localStorage.getItem(drawsKey(instrument))); return Array.isArray(a)?a:[]; }
  catch(_){ return []; }
}
// Segarkan cermin. Dipanggil tiap kali kita TAHU keadaan server (GET sukses / Reload), bukan cuma
// saat ada editan lokal: cermin yang isinya basi atau kosong lebih buruk daripada tak ada cermin —
// pengguna yang GET-nya gagal di browser baru akan melihat chart KOSONG padahal server penuh, yaitu
// persis pengalaman "kerjaanku hilang" yang jadi alasan fitur ini ada.
function writeLocalDraws(instrument, arr){
  try{ localStorage.setItem(drawsKey(instrument), JSON.stringify(arr||[])); }catch(_){}
}

// Simbol yang muatannya DITOLAK PERMANEN server (413, di atas 256 KB). Dorongan berikutnya untuk
// simbol itu pasti ditolak juga, jadi berhenti sampai ada GET sukses berikutnya (mis. sesudah
// pengguna menghapus sebagian gambar lalu memuat ulang).
const drawTooBig={};

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
  delete drawTooBig[instrument];           // keadaan server diketahui lagi → boleh mencoba lagi
  const arr=Array.isArray(d.payload)?d.payload:[];
  // Adopsi sekali (migrasi era localStorage): server belum punya apa pun utk simbol ini tapi
  // perangkat ini punya. Unggah yang lokal sbg versi pertama, lalu pakai itu.
  if(!arr.length && drawVer[instrument]===0){
    const local=readLocalDraws(instrument);
    if(local.length){ pushDrawsNow(instrument, local); return local; }
  }
  writeLocalDraws(instrument, arr);        // cermin selalu = keadaan server terakhir yang kita tahu
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
// dekat flushPendingPushFor) sehingga banner selalu sinkron dgn `inst`.
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
    writeLocalDraws(instrument, cc.srv.payload||[]);   // isi server jadi kebenaran baru → cermin ikut, jangan tertinggal di versi lokal yg baru saja dibuang
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

// Chromium menolak fetch(keepalive) dgn badan di atas ~64 KB — dan penolakannya mendarat di
// .catch(()=>{}) alias hilang tanpa jejak. Batas server justru 256 KB, jadi tepat pengguna dgn
// gambar TERBANYAK yang jaring pengaman unload-nya diam2 tak pernah ada. Ambang 60000 memberi
// ruang utk header/overhead di bawah batas browser.
const KEEPALIVE_MAX_BYTES=60000;
function bodyBytes(s){ try{ return new TextEncoder().encode(s).length; }catch(_){ return s.length; } }

// Dorongan satu tembakan. `opts.keepalive` HANYA dari handler unload/hidden — bukan dari flush
// rekonsiliasi biasa, yang jalan saat halaman masih hidup & fetch polos tak punya batas ukuran.
function pushDrawsNow(instrument, payload, opts){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  if(drawTooBig[instrument]) return;        // ditolak permanen (413) → mengulang cuma membakar request
  // Menunggu keputusan pengguna → jangan menembak 409 lagi, TAPI muatannya jangan dibuang: pengguna
  // biasanya terus menggambar selama banner terpampang, dan "Keep mine" harus mengirim keadaan
  // SEKARANG. Versi lama membuang muatan ini, jadi Keep mine mendorong snapshot saat bentrok terjadi
  // dan menghapus semua yang digambar sesudahnya — padahal objeknya masih terlihat di layar.
  if(drawConflict[instrument]){ drawConflict[instrument].mine=payload; return; }
  const body=JSON.stringify({instrument, payload, baseVersion:base});
  const init={method:'POST', headers:{'Content-Type':'application/json'}, body};
  // Di atas ambang: turun ke fetch biasa. Kompromi yang dipilih sadar — fetch biasa bisa tak
  // selesai kalau tab benar2 ditutup paksa, tapi keepalive yang ditolak browser tak punya peluang
  // sama sekali.
  if(opts&&opts.keepalive&&bodyBytes(body)<=KEEPALIVE_MAX_BYTES) init.keepalive=true;
  return fetch('/api/drawings', init)
    .then(async r=>{
      if(r.status===409){                       // perangkat lain menyimpan duluan
        const d=await r.json().catch(()=>null);
        if(d){ drawVer[instrument]=d.version|0; showDrawConflict(instrument, d, payload); }
        return;
      }
      // 413 & 401 adalah kegagalan PERMANEN, bukan kedipan jaringan: mendiamkannya berarti tiap
      // editan berikutnya menembakkan ulang request yang sudah pasti gagal, tanpa satu pun tanda
      // ke pengguna bahwa gambarnya berhenti tersimpan.
      if(r.status===413){
        if(!drawTooBig[instrument]){ drawTooBig[instrument]=1; try{ toast('Too many drawings on this symbol to sync','warn'); }catch(_){} }
        return;
      }
      if(r.status===401){                       // sesi habis → jalur yang sudah ada di app (authGate, js/auth-overlay.js)
        drawVer[instrument]=null;               // tak tahu lagi keadaan server → berhenti mendorong
        try{ showAuthOverlay(); }catch(_){}
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
  // Simbol beda dari yg lagi antre → selesaikan dulu simbol lama. Flush ini BUKAN jalur unload
  // (halaman masih hidup: pengguna baru saja pindah simbol), jadi TANPA keepalive — fetch polos
  // tak punya batas ~64 KB dan di sini tak ada yang perlu bertahan melewati penutupan halaman.
  if(drawPushPending && drawPushPending.instrument!==instrument) flushSyncDraws();
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

// Reload INSTRUMEN YANG SAMA (Load tombol tanggal lain, boot ulang, dst) saat masih ada dorongan
// antre untuk instrumen itu: KIRIM DULU, lalu pemanggil MENUNGGU janji ini sebelum GET-nya.
// Urutan itulah penawarnya. Membuang dorongan (versi lama) memang menutup bahaya "payload basi
// menimpa state server segar" — sebab baseVersion yg baru disegarkan kebetulan cocok — tapi
// menutupnya dgn KEHILANGAN: garis yang baru digambar lenyap dari layar DAN dari server. Dgn
// dikirim lebih dulu, GET sesudahnya mengembalikan gambar itu, dan tak ada lagi dorongan tertunda
// yang bisa mendarat belakangan. Tanpa keepalive: ini halaman hidup, bukan unload.
function flushPendingPushFor(instrument){
  if(!(drawPushPending && drawPushPending.instrument===instrument)) return;
  const p=drawPushPending;
  clearTimeout(drawPushTimer); drawPushTimer=null; drawPushPending=null;
  return pushDrawsNow(p.instrument, p.payload);
}

// Halaman disembunyikan / ditutup → kirim tanpa menunggu debounce. `fetch(keepalive:true)`, BUKAN
// navigator.sendBeacon: semantiknya sama tapi ia lewat jalur yang bisa dicegat page.route, jadi
// jaring pengaman ini ikut TERUJI, bukan sekadar diklaim.
//
// Urutannya tiga langkah, dan tiap langkah menutup satu kehilangan yang sudah pernah terjadi:
//
// 1. Muatan simbol LAIN yang masih antre dikirim DULU, dgn keepalive. Jalur ini nyata: gambar di
//    EUR_USD → pindah ke XAU_USD dalam jendela 1,5 dtk (flush di jalur muat cuma menyentuh simbol
//    yang SEDANG dimuat, jadi entri EUR tetap menggantung) → tutup/background tab sebelum timernya
//    jalan. Tanpa langkah ini, saveDraws() di bawah memanggil scheduleSyncDraws() yang mengirim
//    entri EUR lewat cabang rekonsiliasinya sebagai fetch POLOS di tengah unload — dan browser
//    rutin membatalkan itu. Editannya lalu hilang dari server SEKALIGUS dari cermin, karena GET
//    sukses berikutnya menimpa cermin dgn keadaan server yang tak pernah menerimanya (temuan N1).
//    Simbol yang SAMA sengaja TIDAK ikut di sini: saveDraws() akan menyegarkan muatannya, dan
//    mengirim dua kali membuat dorongan kedua kena 409 — yang tersimpan justru versi lebih tua.
// 2. saveDraws() — debounce lokal 350 ms berarti gestur terakhir bisa belum masuk antrean sama
//    sekali, jadi "flush apa yang tertunda" saja tak menyelamatkan apa pun. Di mobile
//    visibilitychange justru sinyal terminasi yang ANDAL (beforeunload sering tak pernah jalan),
//    jadi di sanalah kehilangannya paling nyata.
// 3. flush terakhir: kirim apa yang baru saja dijadwalkan langkah 2.
//
// Batas ~60 KB di pushDrawsNow tetap berlaku untuk semua dorongan di sini — badan yang kebesaran
// turun ke fetch biasa alih-alih jadi keepalive yang ditolak browser tanpa jejak.
function flushSyncDrawsOnExit(){
  if(drawPushPending && drawPushPending.instrument!==inst) flushSyncDraws({keepalive:true});
  try{ saveDraws(); }catch(_){}
  flushSyncDraws({keepalive:true});
}
addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSyncDrawsOnExit(); });
addEventListener('beforeunload', flushSyncDrawsOnExit);
