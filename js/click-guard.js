// ===== klik cepat: cegah klik ke-2 ditelan lapisan synthetic-event klinecharts (Temuan 2 E2E) =====
// docs/e2e-drawing-findings.md. Di klinecharts 9.8.10 `_mouseUpHandler` memperlakukan SETIAP
// mouseup ke-2 dalam window 500ms (dibuka mousedown ke-1) sebagai kandidat double-click:
//
//   ++clickCount;
//   if (clickTimeoutId!==null && clickCount>1) { if (manhattan(now,firstDown)<5) dblclick; reset(); }
//   else                                        click;
//
// Kalau klik ke-2 berjarak >=5px dari klik ke-1, cabang dblclick gugur karena jarak — tapi cabang
// `else` juga tak kesampaian, jadi klik itu HILANG tanpa memancarkan event apa pun. Akibatnya
// menggambar cepat (jeda < ~400ms, kebiasaan wajar & mulus di TradingView) kehilangan klik ke-2:
// objek tak selesai, dan pendingClicks jadi desync sehingga titik jatuh ke snap-per-bar.
//
// Penawarnya: sebelum handler mereka jalan, tutup sendiri window click-nya via
// `_resetClickTimeout()` bila mousedown ini jelas BUKAN calon double-click (>=5px dari klik
// sebelumnya — ambang milik klinecharts, bukan angka karangan kita). Handler mereka lalu melihat
// window kosong → klik diproses lewat cabang `else` sebagai klik normal. Double-click asli (<5px,
// dipakai untuk menyelesaikan gambar & membuka modal Style/Text) tak tersentuh.
//
// Kenapa listener capture di container dan bukan menambal method: handler klinecharts di-`bind`
// saat `_init` (di constructor), jadi menambal prototype SETELAH init tak berpengaruh sama sekali
// (sudah diuji, tak bergerak). Listener capture di container selalu jalan lebih dulu daripada
// listener bubble mereka di canvas, jadi state instance sudah bersih saat handler mereka membaca.
// Semua akses bersifat defensif: kalau bentuk internal klinecharts berubah setelah upgrade,
// fungsi ini no-op dan perilaku kembali seperti sebelum patch (dijaga tests/drawing/10-click-timing).
// Kalau ambang ini diubah jadi 0 (atau kondisi jaraknya dihapus), window ditutup di SETIAP
// mousedown → klinecharts tak pernah memancarkan dblclick lagi. Yang menangkapnya: 20 test
// "double-click membuka modal" di tests/drawing/40-modal-text.spec.js (sudah dibuktikan: dengan
// ambang 0 test-test itu merah). Jangan bikin test dobel-klik saat MENGGAMBAR untuk menjaga ini —
// sudah dicoba dan hampa: pada tool 2-titik, klik ke-2 normal juga menyelesaikan objek, jadi
// testnya tetap hijau walau dblclick mati.
const DBLCLICK_SLOP_PX = 5;                                     // = ambang manhattan klinecharts
function fixClickSwallow(inst, containerEl){
  try{
    const se = inst && inst._chartEvent && inst._chartEvent._event;
    if(!se || !containerEl) return false;
    if(typeof se._resetClickTimeout!=='function' || typeof se._getCoordinate!=='function') return false;
    containerEl.addEventListener('mousedown', (e)=>{
      try{
        if(e.button!==0 || se._clickTimeoutId==null) return;      // tak ada window terbuka → tak ada yg bisa tertelan
        if(typeof se._firesTouchEvents==='function' && se._firesTouchEvents(e)) return;   // jalur tap punya bookkeeping sendiri
        const c=se._getCoordinate(e), p=se._clickCoordinate;
        if(!c || !p) return;
        if(Math.abs(c.x-p.x)+Math.abs(c.y-p.y) >= DBLCLICK_SLOP_PX) se._resetClickTimeout();
      }catch(_){}
    }, true);
    return true;
  }catch(_){ return false; }
}
fixClickSwallow(chart, $('#chart'));

