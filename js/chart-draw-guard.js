// ===================== penjaga gambar kanvas (anti chart beku permanen) =====================
//
// GEJALA: "chart beku total — Reset chart tak berfungsi, saat digeser hanya lingkaran news di
// bawah yang ikut bergerak." Marker news itu elemen DOM yang diposisikan ulang lewat
// onScroll + convertToPixel, jadi state scroll/zoom klinecharts tetap hidup; yang mati hanya
// GAMBAR-nya.
//
// AKAR (klinecharts 9.8.10, `Canvas.prototype._executeListener`):
//
//   if (this._requestAnimationId === DEFAULT_REQUEST_ID) {
//     this._requestAnimationId = requestAnimationFrame(() => {
//       ctx.clearRect(...); fn?.(); this._listener();      // ← menggambar widget
//       this._requestAnimationId = DEFAULT_REQUEST_ID;      // ← tak pernah jalan bila listener throw
//     });
//   }
//
// SATU exception saat menggambar (overlay/indikator/figur custom mana pun) membuat id itu
// nyangkut selamanya → setiap permintaan gambar berikutnya untuk kanvas itu diabaikan diam-diam,
// termasuk resize & `_resetPixelRatio`. Error-nya pun hanya muncul sekali di konsol (uncaught di
// callback rAF). Terbukti dengan menyuntik satu throw ke listener kanvas candle: kanvas berhenti
// digambar ulang untuk seterusnya, Reset chart tak menolong, sumbu & marker news tetap bergerak.
//
// PENAWAR: id selalu dilepas lewat `finally` → kegagalan satu frame tetap satu frame. Error
// dicatat (dibatasi) dengan tag `[luna] chart draw error` supaya sumber sebenarnya bisa dilacak
// dari konsol pengguna. Prototipe dipatch sekali → berlaku juga untuk panel multi-chart.

const CANVAS_IDLE_ID = -1;              // DEFAULT_REQUEST_ID internal klinecharts 9.8.10
const _drawErrSeen = new Map();         // pesan → waktu terakhir dicatat (redam spam per frame)

function reportChartDrawError(e){
  const msg = (e && (e.stack || e.message)) || String(e);
  const now = Date.now(), last = _drawErrSeen.get(msg);
  if(last != null && now - last < 10000) return;
  if(_drawErrSeen.size > 50) _drawErrSeen.clear();
  _drawErrSeen.set(msg, now);
  console.error('[luna] chart draw error', e);
}

function guardChartCanvasDraw(c){
  let cvs = null;
  try{ cvs = c.getAllDrawPanes()[0].getMainWidget()._mainCanvas; }catch(e){}
  const proto = cvs && Object.getPrototypeOf(cvs);
  if(!proto || typeof proto._executeListener !== 'function' || proto.__lunaDrawGuard) return false;
  // Bentuk internal berubah (upgrade klinecharts)? Jangan menebak — biarkan perilaku asli.
  if(typeof cvs._requestAnimationId !== 'number') return false;
  proto._executeListener = function(fn){
    if(this._requestAnimationId !== CANVAS_IDLE_ID) return;
    this._requestAnimationId = requestAnimationFrame(() => {
      try{
        this._ctx.clearRect(0, 0, this._width, this._height);
        if(fn) fn();
        this._listener();
      }catch(e){ reportChartDrawError(e); }
      finally{ this._requestAnimationId = CANVAS_IDLE_ID; }
    });
  };
  proto.__lunaDrawGuard = true;
  return true;
}
try{ guardChartCanvasDraw(chart); }catch(e){}
