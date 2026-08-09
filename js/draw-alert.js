// [alert-garis] Alert yang terikat objek gambar: levelnya mengikuti garisnya, bukan satu harga
// tetap. Rancangan & keputusannya: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

// Enam objek keluarga garis. Channel & rectangle sengaja TIDAK di sini — semantik zona
// (Entering/Exiting) butuh state per-alert di monitor, dan itu spec kedua.
const ALERTABLE_LINE=new Set(['trendline','rayLine','straightLine',
  'horizontalStraightLine','horizontalRayLine','priceLine']);

// Dua anchor objek sebagai {t1,p1,t2,p2} waktu wall-clock — bentuk yang dipahami server.
// Garis horizontal punya dua titik dgn harga sama, jadi ia lewat jalur yang sama persis.
function lineAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||o.points.length<2) return null;
  const a=o.points[0], b=o.points[1];
  const t1=tsOf(a), t2=tsOf(b);
  if(t1==null||t2==null||t1===t2) return null;   // vertikal / tanpa anchor waktu → tak bisa jadi alert
  if(a.value==null||b.value==null) return null;
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

function wireAlertPane(panel, o){
  const pane=panel.querySelector('.dm-pane[data-pane="alert"]'); if(!pane) return;
  const btn=pane.querySelector('.da-create');
  if(btn) btn.onclick=async ()=>{ const c=pane.querySelector('.da-cond');
    await createLineAlert(o.id, (c&&c.value)||'cross'); };
  const del=pane.querySelector('.da-del');
  if(del) del.onclick=async ()=>{ await deleteAlertsForDid(objDid[o.id]); };
}

// Membuat alert SELALU menyimpan gambar dulu: did-nya harus sudah ada di server sebelum ada baris
// alert yang menunjuknya, kalau tidak alert bisa menunjuk objek yang tak ada di mana pun.
async function createLineAlert(overlayId, cond){
  const an=lineAnchorsOf(overlayId); if(!an){ toast('This line cannot be used for an alert','warn'); return null; }
  const did=didOf(overlayId);
  try{ saveDraws(); }catch(_){}
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

async function deleteAlertsForDid(did){
  if(!did) return;
  try{ await fetch('/api/alerts/by-drawing/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument:inst, drawId:did})}); }catch(_){}
  alerts=alerts.filter(a=>a.drawId!==did);
  renderAlertList();
}
