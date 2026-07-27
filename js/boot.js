// bootApp = semua inisialisasi yang menyentuh data server (candle, SSE, quotes).
// Dipisah jadi fungsi supaya HANYA dijalankan setelah sesi tervalidasi.
function bootApp(){
  renderAlertList(); renderWatch();   // alert awal dimuat oleh startAlertPoll()→alertPoll() (hindari GET /api/alerts ganda + race clobber oid)
  loadJournal(); renderStats(); renderJournal(); renderAcct();
  loadInit();  // auto-load tanggal hari ini saat dibuka
  refreshQuotes(); setInterval(refreshQuotes, 60000);   // watchlist quotes (fallback candle harian)
  setLiveDot(); connectPriceStream();                   // harga realtime via SSE
  startAlertPoll();                                     // poll ~2s: surface alert triggered server → toast/Notification
  initPriceTimer();                                     // countdown candle berikutnya
  initMultiChart();                                     // panel chart sekunder (multi-chart)
  applyPaperMode();                                     // boot = realtime → akun live server
  track('app_open',{inst});                             // analytics: sesi dibuka
}

