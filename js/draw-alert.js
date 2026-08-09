// [alert-garis] Alert yang terikat objek gambar: levelnya mengikuti garisnya, bukan satu harga
// tetap. Rancangan & keputusannya: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

// v1 HANYA garis HORIZONTAL. Ini penyempitan sadar dari enam anggota keluarga garis, bukan
// kelalaian: anchor alert adalah waktu WALL-CLOCK dan monitor mengekstrapolasi level secara linear
// dalam waktu KALENDER, sementara chart menggambar sumbu-x linear dalam INDEKS BAR. Keduanya cuma
// sepakat pada instrumen tanpa jeda sesi. Forex libur ~48 dari 168 jam tiap pekan, saham ~17,5 dari
// 24 jam tiap hari — jadi garis MIRING yang diekstrapolasi berlari jauh mendahului garis yang
// digambar pengguna (untuk forex bisa hitungan hari sesudah akhir pekan, dan monitor tetap hidup
// melewati akhir pekan itu). Garis horizontal levelnya KONSTAN, jadi basis waktunya tak berpengaruh
// sama sekali dan kode hari ini sudah benar untuknya. Garis miring menyusul di spec kedua, bersama
// zona (channel & rectangle), setelah basis waktunya dirancang benar.
//
// Sengaja TIDAK ada jalur "terima tool miring kalau kebetulan datar (p1===p2)": pengguna lalu bisa
// membuat alert pada trendline datar lalu menyeret salah satu ujungnya — dan diam-diam mendapat
// persis kasus miring yang baru saja ditunda.
const ALERTABLE_LINE=new Set(['horizontalStraightLine','horizontalRayLine','priceLine']);

// Dua anchor objek sebagai {t1,p1,t2,p2} waktu wall-clock — bentuk yang dipahami server.
//
// HARGA diambil dari points[0] untuk KEDUA anchor, bukan dibaca dari titik kedua: `p1===p2` jadi
// benar SECARA KONSTRUKSI, bukan kebetulan. `horizontalRayLine` punya dua titik dan nilai titik
// keduanya tak selalu ikut tersinkron ke titik pertama (muatan lama terutama) — "garis horizontal"
// yang anchornya berselisih adalah alert MIRING berkostum horizontal, persis yang ditunda di atas.
//
// WAKTU: `horizontalStraightLine` & `priceLine` cuma punya 1 TITIK (TOOL_SPEC: clicks:1), jadi t2
// dibuat t1+1. Interval itu sendiri tak bermakna — p1===p2 membuat level(t) konstan untuk interval
// APA PUN; yang penting hanya t1!==t2 karena server menolak "garis vertikal". +1ms dipilih karena
// itu pembeda PALING KECIL yang mungkin. Titik kedua yang waktunya hilang/kembar jatuh ke fallback
// yang sama, bukan ditolak: menolaknya cuma akan membuat ray horizontal yang sah gagal jadi alert
// padahal levelnya jelas dan konstan.
function lineAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||!o.points.length) return null;
  const a=o.points[0];
  const t1=tsOf(a); if(t1==null||a.value==null) return null;
  let t2=t1+1;
  if(o.points.length>1){ const tb=tsOf(o.points[1]); if(tb!=null && tb!==t1) t2=tb; }
  return {t1, p1:a.value, t2, p2:a.value};
}

// Label kondisi alert — SATU tempat. Sebelumnya ditulis ulang tiga kali di dua berkas (di sini,
// alertTitle & alertPoll di js/forming-candle.js) dan sudah sempat berbeda isinya.
const COND_LABEL={cross:'Crossing', up:'Crossing up', down:'Crossing down'};

// Label asal alert untuk daftar alert. Diambil dari objek yang HIDUP di chart lewat `did`, bukan
// dari field yang dititipkan saat alert dibuat: alertPoll() menulis ulang `alerts` tiap ~2 detik
// dari respons server, dan server TAK menyimpan tipe objeknya — apa pun yang cuma dititipkan lokal
// akan lenyap dalam 2 detik dan selalu hilang sesudah reload. OBJ_TITLE (js/draw-style-modal.js)
// dipakai ulang supaya judul di daftar alert & di header modal objek tak bisa berselisih.
// Alert yang objeknya tak ada di chart ini (mis. milik instrumen lain) jatuh ke 'Drawing'.
function drawAlertLabel(did){
  if(!did) return 'Drawing';
  const oid=drawIds.find(id=>objDid[id]===did);
  if(oid==null) return 'Drawing';
  try{ const o=chart.getOverlayById(oid); if(o&&OBJ_TITLE[o.name]) return OBJ_TITLE[o.name]; }catch(_){}
  return 'Drawing';
}

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
//
// Gerbang di baris pertama: `panel` adalah SATU node modal yang dipakai ulang untuk objek apa pun,
// sedangkan `o` ditangkap saat klik Create — dan jalur create bisa makan beberapa detik (flush
// gambar + POST). Tutup modal, buka setelan garis LAIN di jendela itu, lalu refresh yang tertunda
// mendarat: pane objek BARU ditimpa keadaan objek LAMA, dan tombol Delete-nya terikat ke objek lama
// — "hapus alert garis ini" menghapus alert garis lain. Jadi: batalkan kalau modal sudah tak
// menampilkan objek yang refresh ini dibuat untuknya.
function refreshAlertPane(panel, o){
  if(!drawModal.classList.contains('show') || !dmTarget || !o || dmTarget.id!==o.id) return;
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
      cond:a.cond, drawId:a.drawId, t1:a.t1, p1:a.p1, t2:a.t2, p2:a.p2});
    track('alert',{inst, cond, from:'drawing'});
    renderAlertList(); return a;
  // Kegagalan jaringan (fetch menolak) dulu balik diam-diam padahal cabang !r.ok bertoast:
  // tombol utama tampak tak melakukan apa-apa. Satu pesan yang sama untuk kedua kegagalan.
  }catch(e){ toast('Could not create alert','error'); return null; }
}

// Anchor alert diperbarui dari objeknya. Menumpang irama simpan gambar, BUKAN hook per-gestur:
// dengan begitu drag, kunci sudut Shift, dan magnet ikut benar tanpa masing-masing perlu diingat.
// Undo/redo TIDAK lewat saveDraws() (applyDrawsSnapshot memanggil lapisan sync langsung), jadi ia
// memanggil fungsi ini sendiri — lihat js/draw-undo.js. Tanpa itu, undo mengembalikan garisnya tapi
// alertnya tetap mengawasi posisi yang barusan di-undo.
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
// `finally` TEPAT SEBELUM sweep ini dipanggil, jadi baris itu tak pernah bisa true di sini. Baris itu
// dibiarkan sbg defense-in-depth kalau kelak ada pemanggil lain — jangan andalkan ia utk proteksi.
//
// Proteksi sungguhan ada DUA:
//  (1) URUTAN — sweep baru dipanggil SESUDAH restoreDraws() selesai (drawIds sudah terisi ulang),
//      ditambah onRemoved yang menolak menghapus alert selama churn programatik (js/draw-tools.js);
//  (2) `drawVer[target]==null` → keadaan server TAK DIKETAHUI, jangan menyapu. "Pemuatan selesai"
//      tidak sama dengan "pemuatan OTORITATIF": kalau GET /api/drawings gagal, loadDrawsFor() jatuh
//      ke cermin localStorage — yang KOSONG di browser baru, jendela private, atau sesudah data situs
//      dibersihkan. drawIds lalu kosong, sweep menyimpulkan SEMUA alert kehilangan objeknya, dan
//      menghapusnya di server tanpa bisa dikembalikan. Predikat null ini persis yang sudah dipakai
//      jalur dorong untuk MENOLAK mendorong (js/draw-sync.js) — jadi ini konsisten dgn kontrak sync,
//      bukan konsep baru: kalau kita tak boleh MENULIS gambar saat versi tak diketahui, kita jelas
//      tak boleh MENGHAPUS alert atas dasar keadaan gambar yang sama-sama tak diketahui itu.
async function sweepAlertsForMissingDrawings(){
  if(suppressDrawSave) return;
  const target=inst;   // instrumen & daftar did di bawah HARUS sepasang: loop ini `await`, dan inst
                        // bisa berganti SINKRON di tengah jalan (user ganti instrumen via loadInit).
                        // Snapshot `ada` yang terpisah dari instrumen yang dibandingkannya adalah
                        // race: alert instrumen BARU bisa lolos filter sym (krn dibandingkan ke inst
                        // yg sudah berganti) tapi diperiksa thd daftar did instrumen LAMA lalu
                        // terhapus — alert yg sedang dilihat pengguna lenyap. Ikat keduanya ke `target`
                        // supaya salah-pasang itu MUSTAHIL secara struktural, bukan sekadar dipersempit.
  if(drawVer[target]==null) return;   // keadaan server tak diketahui → lihat (2) di komentar atas
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
