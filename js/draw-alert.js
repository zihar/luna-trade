// [alert-garis] Alert yang terikat objek gambar: levelnya mengikuti garisnya, bukan satu harga
// tetap. Rancangan & keputusannya: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

// Enam objek keluarga garis. Channel & rectangle sengaja TIDAK di sini — semantik zona
// (Entering/Exiting) butuh state per-alert di monitor, dan itu spec kedua.
const ALERTABLE_LINE=new Set(['trendline','rayLine','straightLine',
  'horizontalStraightLine','horizontalRayLine','priceLine']);

// Dua anchor objek sebagai {t1,p1,t2,p2} waktu wall-clock — bentuk yang dipahami server.
// Garis horizontal punya dua titik dgn harga sama, jadi ia lewat jalur yang sama persis.
//
// `horizontalStraightLine` & `priceLine` cuma py 1 TITIK (TOOL_SPEC: clicks:1, pointsAfter:1) —
// dua dari enam anggota ALERTABLE_LINE. Levelnya konstan sepanjang waktu, jadi t1/t2 boleh anchor
// APA SAJA asal beda (server menolak t1===t2 sbg "garis vertikal"); intervalnya sendiri tak
// bermakna karena p1===p2 membuat level(t) konstan utk interval mana pun. +1ms dipilih krn itu
// pembeda PALING KECIL yg mungkin — menegaskan "cuma perlu beda", bukan durasi yang "benar".
function lineAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||!o.points.length) return null;
  const a=o.points[0];
  const t1=tsOf(a); if(t1==null||a.value==null) return null;
  if(o.points.length<2) return {t1, p1:a.value, t2:t1+1, p2:a.value};
  const b=o.points[1];
  const t2=tsOf(b);
  if(t2==null||t1===t2) return null;   // vertikal / tanpa anchor waktu → tak bisa jadi alert
  if(b.value==null) return null;
  return {t1, p1:a.value, t2, p2:b.value};
}

const COND_LABEL={cross:'Crossing', up:'Crossing up', down:'Crossing down'};

// Alert milik objek ini (dari daftar alert yang sudah disinkron alertPoll).
function alertForDid(did){ return did ? alerts.find(a=>a.drawId===did) : null; }

// Isi tab Alert. Teks UI bahasa Inggris.
function alertPaneHTML(o){
  const did=objDid[o.id], ex=alertForDid(did);
  if(ex) return `<div class="dm-pane" data-pane="alert"><div class="da-has">Alert active — ${COND_LABEL[ex.cond]||'Crossing'}</div>`
    +`<button class="da-del" type="button">Delete alert</button></div>`;
  return `<div class="dm-pane" data-pane="alert">`
    +`<label class="da-row"><span>Condition</span><select class="da-cond">`
    +`<option value="cross">Crossing</option><option value="up">Crossing up</option><option value="down">Crossing down</option>`
    +`</select></label>`
    +`<button class="da-create" type="button">Create alert</button></div>`;
}

// Re-render pane DI TEMPAT (bukan reopen modal): tanpa ini, pane yg masih terbuka sesudah Create
// terus menampilkan form Create — klik kedua mengirim POST /api/alerts KEDUA utk drawId yg sama.
// outerHTML diganti dgn markup terbaru (alertPaneHTML membaca ulang `alerts`), lalu di-wire ulang
// karena tombolnya adalah node DOM baru.
function refreshAlertPane(panel, o){
  const cur=panel.querySelector('.dm-pane[data-pane="alert"]'); if(!cur) return;
  const hidden=cur.hidden, minH=cur.style.minHeight;
  cur.outerHTML=alertPaneHTML(o);
  const next=panel.querySelector('.dm-pane[data-pane="alert"]');
  if(next){ next.hidden=hidden; next.style.minHeight=minH; }
  wireAlertPane(panel, o);
}

function wireAlertPane(panel, o){
  const pane=panel.querySelector('.dm-pane[data-pane="alert"]'); if(!pane) return;
  const btn=pane.querySelector('.da-create');
  if(btn) btn.onclick=async ()=>{ const c=pane.querySelector('.da-cond');
    const a=await createLineAlert(o.id, (c&&c.value)||'cross'); if(a) refreshAlertPane(panel, o); };
  const del=pane.querySelector('.da-del');
  if(del) del.onclick=async ()=>{ await deleteAlertsForDid(objDid[o.id]); refreshAlertPane(panel, o); };
}

// Batas tunggu flush gambar (fix round 2): fetch() di codebase ini TAK PERNAH punya timeout, jadi
// koneksi yang STALL (server diam, beda dari GAGAL cepat — itu sudah ditangani catch di bawah)
// akan menggantung `await` selamanya kalau tak dibatasi — tombol Create diam tanpa toast, tanpa
// alert, tanpa pemulihan selain reload. 2 dtk cukup longgar utk koneksi sehat (jauh di atas RTT
// wajar) tapi cukup pendek supaya stall tak menyandera pengguna.
const ALERT_FLUSH_TIMEOUT_MS=2000;
function timeoutAfter(ms){ return new Promise(res=>setTimeout(res, ms)); }

// Membuat alert SELALU menyimpan gambar dulu & MENUNGGU dorongannya sampai server, TAPI PALING
// LAMA `ALERT_FLUSH_TIMEOUT_MS`: did-nya idealnya sudah ada di server sebelum ada baris alert yang
// menunjuknya. saveDraws() sendiri cuma MENJADWALKAN dorongan (debounce jaringan 1,5dtk,
// js/draw-sync.js) — tanpa menunggu, POST alert di bawah bisa tiba duluan, dan kalau tab tertutup
// di jendela itu alert-nya menunjuk gambar yang tak pernah tersimpan. flushPendingPushFor mem-flush
// ANTREAN ITU JUGA (bukan sekadar menjadwalkannya lagi) & mengembalikan promise fetch-nya, yang
// di-race melawan timer di sini — bukan ditunggu telanjang, sebab fetch tanpa timeout + koneksi
// yang stall (bukan menolak) akan menggantung selamanya kalau tak dibatasi. Kegagalan jaringan
// ATAU timer yang menang keduanya tetap lanjut membuat alert (drawId sudah pasti diminta lewat
// didOf) drpd memblokir pengguna — jaring pengamannya (unload/visibilitychange) sudah ada di
// draw-sync.js.
async function createLineAlert(overlayId, cond){
  const an=lineAnchorsOf(overlayId); if(!an){ toast('This line cannot be used for an alert','warn'); return null; }
  const did=didOf(overlayId);
  try{ saveDraws(); await Promise.race([flushPendingPushFor(inst), timeoutAfter(ALERT_FLUSH_TIMEOUT_MS)]); }catch(_){}
  try{
    const r=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({instrument:inst, cond, drawId:did}, an))});
    if(!r.ok){ toast('Could not create alert','error'); return null; }
    const a=await r.json();
    alerts.push({id:a.id, sym:a.instrument, price:a.price, triggeredAt:null, oid:null,
      cond:a.cond, drawId:a.drawId, name:(chart.getOverlayById(overlayId)||{}).name||''});
    track('alert',{inst, cond, from:'drawing'});
    renderAlertList(); return a;
  }catch(e){ return null; }
}

// Anchor alert diperbarui dari objeknya. Menumpang irama simpan gambar, BUKAN hook per-gestur:
// dengan begitu drag, undo/redo, kunci sudut Shift, dan magnet semuanya ikut benar tanpa masing-
// masing perlu diingat.
async function syncAlertAnchors(){
  const byDid={}; drawIds.forEach(id=>{ const d=objDid[id]; if(d) byDid[d]=id; });
  for(const a of alerts.slice()){
    if(!a.drawId || a.sym!==inst) continue;
    const oid=byDid[a.drawId]; if(!oid) continue;          // objeknya tak ada di layar → urusan penyapuan
    const an=lineAnchorsOf(oid); if(!an) continue;
    if(a.t1===an.t1 && a.p1===an.p1 && a.t2===an.t2 && a.p2===an.p2) continue;   // tak berubah → jangan kirim
    Object.assign(a, an);
    try{ await fetch('/api/alerts/anchors',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({id:a.id}, an))}); }catch(_){}
  }
}

// Objek gambarnya sudah tak ada → alertnya ikut dibuang. Jaring untuk penghapusan yang terjadi di
// tempat lain (perangkat lain, atau saat tab ini tertutup); penghapusan di sesi ini ditangani
// seketika oleh onRemoved.
//
// Proteksi thd chart yang kosong sesaat saat memuat BUKAN datang dari cek suppressDrawSave di bawah:
// di satu-satunya pemanggilnya (loadInit, js/load-chart.js), flag itu sudah direset ke false di
// `finally` TEPAT SEBELUM sweep ini dipanggil, jadi baris itu tak pernah bisa true di sini. Proteksi
// sungguhan datang dari URUTANnya: sweep baru dipanggil SESUDAH restoreDraws() selesai (drawIds sudah
// terisi ulang), ditambah onRemoved yang menolak menghapus alert selama churn programatik
// (suppressDrawSave true di situ, js/draw-tools.js). Baris di bawah dibiarkan sbg defense-in-depth
// kalau kelak ada pemanggil lain yg tak menjaga urutan itu — jangan andalkan ia utk proteksi di atas.
async function sweepAlertsForMissingDrawings(){
  if(suppressDrawSave) return;
  const target=inst;   // instrumen & daftar did di bawah HARUS sepasang: loop ini `await`, dan inst
                        // bisa berganti SINKRON di tengah jalan (user ganti instrumen via loadInit).
                        // Snapshot `ada` yang terpisah dari instrumen yang dibandingkannya adalah
                        // race: alert instrumen BARU bisa lolos filter sym (krn dibandingkan ke inst
                        // yg sudah berganti) tapi diperiksa thd daftar did instrumen LAMA lalu
                        // terhapus — alert yg sedang dilihat pengguna lenyap. Ikat keduanya ke `target`
                        // supaya salah-pasang itu MUSTAHIL secara struktural, bukan sekadar dipersempit.
  const ada=new Set(drawIds.map(id=>objDid[id]).filter(Boolean));
  for(const a of alerts.slice()){
    if(inst!==target) return;   // instrumen sudah berganti sejak sweep ini mulai → hentikan di sini,
                                 // jangan periksa alert instrumen baru thd data instrumen lama
    if(!a.drawId || a.sym!==target) continue;
    if(!ada.has(a.drawId)) await deleteAlertsForDid(a.drawId);
  }
}

async function deleteAlertsForDid(did){
  if(!did) return;
  try{ await fetch('/api/alerts/by-drawing/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument:inst, drawId:did})}); }catch(_){}
  alerts=alerts.filter(a=>a.drawId!==did);
  renderAlertList();
}
