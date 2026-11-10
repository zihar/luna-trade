// ===================== konstanta =====================
const TF_LIST = ['M1','M2','M3','M4','M5','M10','M15','M30','H1','H2','H3','H4','H6','H8','H12','D','W','MN'];
const DUR = {M1:6e4,M2:12e4,M3:18e4,M4:24e4,M5:3e5,M10:6e5,M15:9e5,M30:18e5,H1:36e5,H2:72e5,H3:108e5,H4:1.44e7,H6:2.16e7,H8:2.88e7,H12:4.32e7,D:8.64e7,W:6.048e8,MN:2.63e9}; // ms (MN≈30.44 hari)
const GRAN = {MN:'M'};   // label TF → granularity OANDA (MN = Monthly = 'M')
// Detik per 1 bar TF (untuk pemilihan level QT). Diturunkan dari DUR agar cover semua TF & tak drift.
function tfSeconds(tf){ return (DUR[tf]||0)/1000; }
const FWD_CHUNK = 500;
const NY_TZ = 'America/New_York';
// Zona waktu tampilan (chart X-axis + semua label waktu). Bisa diganti via dropdown #tzSel.
function resolveTZ(v){ return v==='__local' ? (Intl.DateTimeFormat().resolvedOptions().timeZone||NY_TZ) : (v||NY_TZ); }
let chartTZ = resolveTZ(localStorage.getItem('br_tz'));
const $ = s => document.querySelector(s);
// analytics DIY: kirim event pemakaian fitur ke server (fire-and-forget; aman bila gagal/blm login)
function track(name, props){ try{ fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,props:props||{}}),keepalive:true}).catch(()=>{}); }catch(e){} }

