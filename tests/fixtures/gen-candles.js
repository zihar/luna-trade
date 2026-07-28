// Generator fixture candle deterministik untuk E2E.
//
// Dijalankan manual saat fixture perlu diregenerasi:
//   node tests/fixtures/gen-candles.js
//
// Output di-COMMIT (candles-eurusd-m15.json) supaya test tak bergantung generator ini
// saat runtime. PRNG ber-seed → hasil identik tiap kali, jadi regenerasi tak mengubah
// apa pun kecuali parameter di bawah diubah dengan sengaja.
//
// Bentuk respons meniru passthrough OANDA di candlesHandler (main.go): objek
// { candles: [{ time, mid:{o,h,l,c}, volume, complete }] }. fetchCandles (index.html pra-Fase-2:1766)
// memfilter c.complete → semua bar di sini complete:true.

const fs = require('fs');
const path = require('path');

const BARS = 500;
const TF_MS = 15 * 60 * 1000; // M15
// Anchor TETAP (bukan Date.now()) → dataset identik selamanya. Jumat 2026-07-17 20:45 UTC.
const ANCHOR = Date.parse('2026-07-17T20:45:00Z');
const SEED = 0x1ec5a1;
const BASE = 1.0865; // EUR_USD
const PIP = 0.0001;

// mulberry32 — PRNG kecil & deterministik.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pasar FX tutup Jumat 21:00 UTC → Minggu 21:00 UTC. Gap akhir pekan disertakan supaya
// jalur pemetaan timestamp↔dataIndex yang tak rata per-piksel (lihat komentar
// index.html pra-Fase-2:582-585) ikut terpakai, bukan cuma kasus bar kontigu.
function marketOpen(ts) {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 21) return false;
  if (day === 5 && hour >= 21) return false;
  return true;
}

const rand = rng(SEED);

// Kumpulkan timestamp ke belakang dari ANCHOR, lompati jam pasar tutup.
const stamps = [];
for (let ts = ANCHOR; stamps.length < BARS; ts -= TF_MS) {
  if (marketOpen(ts)) stamps.push(ts);
}
stamps.reverse();

// Random walk + sedikit tren & volatilitas bervariasi → OHLC yang khas dan tidak
// simetris, jadi test magnet (snap ke O/H/L/C terdekat) punya nilai yang jelas beda.
const candles = [];
let close = BASE;
for (let i = 0; i < stamps.length; i++) {
  const drift = Math.sin(i / 47) * 0.35 * PIP;
  const vol = (1.2 + Math.sin(i / 23) * 0.6) * PIP;
  const open = close;
  const body = (rand() - 0.5) * 2 * vol + drift;
  close = open + body;
  const hi = Math.max(open, close) + rand() * vol * 1.4;
  const lo = Math.min(open, close) - rand() * vol * 1.4;
  const dec = (v) => +v.toFixed(5);
  candles.push({
    time: new Date(stamps[i]).toISOString().replace('.000Z', '.000000000Z'),
    mid: { o: dec(open).toFixed(5), h: dec(hi).toFixed(5), l: dec(lo).toFixed(5), c: dec(close).toFixed(5) },
    volume: 200 + Math.floor(rand() * 1800),
    complete: true,
  });
}

const out = path.join(__dirname, 'candles-eurusd-m15.json');
fs.writeFileSync(out, JSON.stringify({ instrument: 'EUR_USD', granularity: 'M15', candles }, null, 0) + '\n');
console.log(`${candles.length} bar → ${out}`);
console.log(`rentang: ${candles[0].time} … ${candles[candles.length - 1].time}`);
