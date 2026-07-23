# Live-stream auto-recover — Design

**Tanggal:** 2026-07-23
**Status:** Disetujui untuk implementasi

## Masalah

Saat web dibuka di server lalu didiamkan lama, chart sering **freeze** — berhenti
bergerak walau seharusnya ada harga masuk. Chart memuat harga realtime lewat **SSE**
(`EventSource /api/prices`), bukan WebSocket.

Yang sudah ada dan berfungsi:
- Server kirim keepalive komentar `:ka\n\n` tiap 15s (`api.go:239-243`) → koneksi
  hangat, nginx `proxy_read_timeout 86400` aman.
- Client reconnect berbackoff saat `onerror` (`index.html:4259-4264`).

Tiga celah yang menyebabkan freeze setelah idle lama:

1. **rAF beku di tab non-aktif.** Render di-flush lewat `requestAnimationFrame`
   (`queuePriceRender`, `index.html:4238-4247`). Di tab yang lama tak aktif browser
   membekukan rAF → flag `priceRenderQueued` nyangkut `true`, render berhenti meski
   tick masuk.
2. **SSE "mati diam".** TCP half-open saat laptop sleep / ganti jaringan / proxy putus
   tanpa FIN. Browser tidak selalu memicu `onerror` → reconnect tak jalan, chart beku
   tanpa error. JS **tidak bisa melihat keepalive** `:ka` karena `EventSource`
   mengabaikan baris komentar (diawali `:`) → saat market tutup + koneksi putus senyap,
   client benar-benar buta terhadap liveness koneksi.
3. **Tidak ada `visibilitychange` / watchdog** untuk memulihkan saat tab kembali aktif
   atau mesin bangun dari sleep.

Popup inactivity (usulan awal) hanya menutup gejala, tidak menyelesaikan akar masalah,
dan bisa mengganggu saat pengguna hanya *menonton* chart tanpa gerakan input. Ditolak.

## Solusi: auto-recover mulus

Dua bagian kecil, satu fitur (resiliensi live-stream), satu PR.

### Bagian 1 — Server (`api.go`): keepalive terlihat oleh client

Ubah keepalive dari komentar tak terlihat menjadi **event bernama**:

```
// Sebelum (api.go:240):
io.WriteString(w, ":ka\n\n")
// Sesudah:
io.WriteString(w, "event: ping\ndata: 1\n\n")
```

Tetap tiap 15s, tetap menghangatkan koneksi. Bedanya sekarang client bisa
mendengarnya lewat `addEventListener('ping', …)` sebagai **bukti koneksi hidup yang
independen dari ada/tidaknya tick harga** — sehingga liveness terdeteksi juga saat
market tutup / lintas akhir pekan.

Karena event bernama, ping **tidak** masuk ke `onmessage` (yang hanya menangani event
default/tanpa nama) → tak akan salah di-parse sebagai tick harga.

### Bagian 2 — Client (`index.html`): watchdog + visibility

**State baru:**
- `lastStreamActivity` — timestamp (`Date.now()`) aktivitas SSE terakhir. Di-update di
  `onopen`, `onmessage`, dan handler event `ping`.

**Handler `ping`** (dipasang di `connectPriceStream`, bersebelahan dengan `onopen`/
`onmessage`/`onerror`):
```
priceES.addEventListener('ping', ()=>{ lastStreamActivity=Date.now(); });
```

**`recoverLive()`** — pemulihan tanpa reload halaman:
1. `priceRenderQueued=false` — lepas flag rAF yang mungkin nyangkut.
2. `connectPriceStream()` — reconnect (tutup ES lama, buka baru).
3. `if(live) liveRefresh().catch(()=>{})` — tarik candle terbaru (OHLC otoritatif).
4. `queuePriceRender()` — paksa flush render.

**Watchdog** — `setInterval(streamWatchdog, 10000)` dipasang saat init (dekat timer
lain, mis. `index.html:4399`). Logika:
1. Hitung drift = jeda nyata antar-fire dikurangi interval. Catat waktu fire ini.
2. Kalau `document.visibilityState !== 'visible'` → berhenti (pulihkan hanya saat user
   bisa melihat; di background timer di-throttle & percuma reconnect).
3. `slept = drift > 60000` → mesin habis sleep.
4. `stale = Date.now() - lastStreamActivity > 40000` → keepalive/ tick terlewat
   ≈ 2–3× (koneksi kemungkinan mati diam). Berlaku juga saat market tutup karena ping
   tetap datang selama koneksi hidup.
5. Kalau `slept || stale || !priceConnected` → `recoverLive()`.

**`visibilitychange` → visible** (`document.addEventListener`):
1. Selalu `priceRenderQueued=false; queuePriceRender();` — lepas flag rAF nyangkut +
   flush render (menangani glance cepat tanpa churn reconnect).
2. Kalau `!priceConnected || Date.now()-lastStreamActivity > 40000` → `recoverLive()`.

### Ambang (konstanta)

| Nama | Nilai | Alasan |
|------|-------|--------|
| Keepalive ping | 15s | tak berubah dari server saat ini |
| Watchdog interval | 10s | cukup sering, ringan |
| Stale threshold | 40s | ≈ 2–3 keepalive terlewat sebelum dinyatakan mati |
| Sleep drift | 60s | jeda watchdog jauh di atas 10s = mesin habis sleep |

## Alur data

```
Server: ch tick  ──"data: {...}"──▶  onmessage ─▶ lastStreamActivity=now, queuePriceRender()
Server: keepalive ──"event: ping"──▶  ping listener ─▶ lastStreamActivity=now
                                    (koneksi mati ⇒ tak ada data/ping ⇒ lastStreamActivity menua)

Watchdog(10s) ─┬─ visible? tidak ─▶ diam
               └─ visible? ya ─┬─ slept | stale | !connected ─▶ recoverLive()
                               └─ selain itu ─▶ diam

visibilitychange→visible ─▶ flush render; jika stale ─▶ recoverLive()

recoverLive() ─▶ reset rAF ▶ connectPriceStream() ▶ liveRefresh() ▶ queuePriceRender()
```

## Penanganan error / edge case

- **Glance cepat antar-tab:** `visibilitychange` hanya flush render; reconnect hanya
  jika benar-benar stale → tak ada churn koneksi.
- **Market tutup (akhir pekan):** ping tetap menjaga `lastStreamActivity` segar → tak
  ada reconnect palsu. Bila koneksi mati diam saat tutup, `stale` tetap mendeteksinya
  begitu tab visible (tidak lagi bergantung pada tick harga).
- **`liveRefresh()` gagal:** di-`catch` diam; reconnect stream tetap jalan, tick
  berikutnya akan menyegarkan chart.
- **Reconnect berlebih (false positive):** `connectPriceStream()` menutup ES lama lalu
  buka baru — biaya kecil dan aman dipanggil ulang.
- **`onerror` yang sudah ada** tetap menangani putus koneksi yang terdeteksi normal
  (backoff). Watchdog menangani kasus yang **tidak** memicu `onerror` (mati diam, sleep,
  rAF beku).

## Yang sengaja TIDAK dilakukan (YAGNI)

- Tidak ada popup inactivity.
- Tidak ada reload halaman penuh.
- Tidak ada pelacakan gerak mouse/keyboard (menonton diam ≠ idle).
- Tidak ada perubahan protokol lain (tetap SSE, bukan WebSocket).

## Verifikasi

Frontend tanpa unit test → verifikasi manual via browser (lihat CLAUDE.md):
- Tidak ada error JS saat load; watchdog & listener terpasang.
- Simulasi tab background lalu kembali → chart lanjut bergerak (butuh login OANDA +
  market buka untuk melihat tick nyata).
- Simulasi stream mati: `DevTools → Network → offline` sejenak lalu online → dalam
  ≤ ~40s (atau langsung saat kembali fokus) stream reconnect & chart pulih.
- Server: pastikan output SSE keepalive kini `event: ping\ndata: 1\n\n` (mis. `curl -N`).

## File yang disentuh

- `api.go` — 1 baris keepalive (`:ka` → `event: ping`).
- `index.html` — `connectPriceStream` (listener ping + update `lastStreamActivity`),
  fungsi baru `recoverLive` & `streamWatchdog`, handler `visibilitychange`, pemasangan
  `setInterval` watchdog di init.
