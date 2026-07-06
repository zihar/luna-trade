# Plan: Cache Candle Proxy (`/api/candles`) untuk Kapasitas Multi-User

> Status: **RENCANA / belum dikerjakan** (dicatat 2026-07-06). Referensi saat siap.

## Latar belakang
Server produksi = EC2 **t4g.small** (2 vCPU arm64, **1.8 GB RAM**, disk ~4 GB sisa),
berbagi dengan `forex-alertd` + nginx (lihat DEPLOY-NOTES / memory `bar-replay-deploy`).

Saat analisis kapasitas ~100 user simultan, jalur harga realtime (SSE) sudah aman karena
**satu upstream OANDA di-fan-out** ke semua klien (`hub.go`). Titik yang paling mungkin
"retak" duluan **bukan** CPU/RAM, melainkan:

1. **`/api/candles` proxy ke OANDA tanpa cache** (`main.go:candlesHandler`), default
   `count=5000`. Tiap chart-load = 1 request 5000-candle langsung ke OANDA. Saat 100 user
   buka instrumen/timeframe yang sama berbarengan (mis. saat event) → sampai **100 fetch
   identik** ke OANDA sekaligus → risiko kena rate limit OANDA (~120 req/s per token) +
   spike bandwidth.
2. SQLite `SetMaxOpenConns(1)` — serialisasi DB (dibahas terpisah; bukan scope plan ini).

Plan ini menutup risiko #1 dengan **cache in-memory** untuk response candle.

## Kondisi sekarang (yang di-cache)
`candlesHandler` (`main.go`) saat ini:
- Baca query: `instrument`, `granularity`, `count` (default 5000), opsional `to`, `from`.
- Bangun URL OANDA (`price=M`, alignment NY utk D/W), lalu untuk DXY dialihkan ke
  `handleDXYCandles` (sintetis, `dxy.go`).
- Untuk instrumen biasa: `http.DefaultClient.Do` → **`io.Copy(w, resp.Body)`** (relay byte
  mentah apa adanya).

Karena handler cuma me-relay **byte JSON mentah**, cache cukup menyimpan `[]byte` response —
nol parsing, format ke frontend tak berubah.

## Pakai apa
**Stdlib Go saja** — tak perlu Redis/Memcached (1 proses, 1 server → in-memory paling cepat):
- `map[string]entry` + `sync.RWMutex` — simpan byte response + waktu expiry.
- `time` — TTL.
- **`golang.org/x/sync/singleflight`** — gabungkan request identik yang datang bersamaan jadi
  **satu** fetch ke OANDA (anti thundering-herd). Sudah ada di `go.sum` (indirect via
  x/crypto) → jadikan **direct require** + `go mod vendor`.

## Desain

### 1. File baru `candlecache.go`
```go
type cacheEntry struct {
    body    []byte
    status  int       // status code OANDA (relay apa adanya)
    expires time.Time
}

type candleCache struct {
    mu    sync.RWMutex
    m     map[string]cacheEntry
    order []string          // FIFO utk eviction (cap jumlah entry)
    sf    singleflight.Group
    max   int               // cap entry (mis. 80)
}
```
Method:
- `get(key) ([]byte, int, bool)` — RLock, cek ada & belum expired.
- `set(key, body, status, ttl)` — Lock, simpan + evict terlama bila > max.
- `fetch(key, ttl, loader func() ([]byte,int,error))` — bungkus `singleflight.Do`:
  cek `get` dulu; kalau miss, `sf.Do(key, loader)` → hanya 1 goroutine fetch, sisanya nunggu
  hasil yang sama, lalu `set`.

### 2. Cache key = sidik jari request
Gabungan parameter yang menentukan hasil:
```
key = instrument | granularity | count | to | from   (price selalu "M")
```
Contoh: `EUR_USD|H1|5000||` = "5000 candle H1 terbaru".

### 3. Kebijakan TTL — beda "terbaru" vs "historis"
Candle yang **sudah tutup itu immutable**; hanya candle terkini yang masih berubah.
- **Ada `to`** (jendela historis di masa lalu) → semua candle sudah tutup → TTL **lama**
  (mis. 1 jam). Umumnya hasil pagination/scroll ke belakang.
- **Tanpa `to`** (N candle terbaru, termasuk candle yang masih terbentuk) → TTL **pendek**
  (mis. 3–5 detik). Ini skenario herd paling berbahaya: TTL 5 detik saja sudah mengubah
  "100 fetch" jadi "1 fetch per 5 detik per key".

TTL adalah **CAP**, bukan menahan data lama — cukup pendek supaya candle terkini tetap fresh
untuk mata manusia, tapi cukup untuk menyerap lonjakan barengan.

### 4. Batasi memori (WAJIB di box 1.8 GB)
Satu response 5000 candle ≈ **~750 KB**. Tanpa batas bisa membengkak.
- **Cache HANYA request "terbaru" (tanpa `to`)** — di situ konsentrasi bebannya; scroll
  historis per-user lebih tersebar & jarang bentrok, jadi **skip** (langsung passthrough).
  Ini sekaligus membatasi jumlah key ke ~(instrumen × timeframe).
- Tambahan safety: **cap jumlah entry** (mis. 80) + evict FIFO/terlama.
- Estimasi: ~10 instrumen × ~7 TF = ~70 key × 750 KB ≈ **~50 MB** — aman.

### 5. Integrasi ke `candlesHandler` (`main.go`)
Perubahan tipis, tanpa mengubah alur DXY:
```go
// setelah bangun p (url.Values) & sebelum fetch, untuk instrumen biasa:
cacheable := q.Get("to") == ""                 // hanya "terbaru" yang di-cache
key := inst + "|" + gran + "|" + count + "|" + q.Get("to") + "|" + q.Get("from")
ttl := 5 * time.Second                          // terbaru
// (kalau kelak mau cache historis: ttl = 1*time.Hour saat to != "")

loader := func() ([]byte, int, error) {
    // kode fetch OANDA existing, tapi ganti io.Copy → io.ReadAll body
}
if cacheable {
    body, status, err := candles.fetch(key, ttl, loader)
    // tulis header + status + body
    return
}
// tidak cacheable → jalur lama (io.Copy langsung)
```
Catatan: hanya cache saat `resp.StatusCode == 200` (jangan cache error/ratelimit).

### 6. Instansiasi
Package-level `var candles = newCandleCache(80)` (mirip `cfg`/`conn`/`hub`), atau buat di
`main()` lalu di-passing. Konsisten dengan pola state server yang ada.

## Tahapan
1. `go.mod`: jadikan `golang.org/x/sync` direct require → `go mod tidy && go mod vendor`.
2. `candlecache.go`: struct + `get`/`set`/`fetch` (singleflight) + eviction.
3. `main.go`: wire cache ke `candlesHandler` (cacheable = tanpa `to`, TTL 5s, cache 200 saja).
4. (Opsional) cache historis (`to != ""`) TTL 1 jam bila memori masih longgar.
5. Tes beban: 100 request identik barengan → verifikasi hanya **1** hit ke OANDA
   (log/counter), sisanya dari cache. Cek `free -m` di server tak melonjak.

## Estimasi
Kecil (~½ sesi). Terisolasi: 1 file baru + bungkus tipis di 1 handler. **Tidak menyentuh
frontend** sama sekali.

## Risiko / catatan
- **Staleness**: TTL 5 detik pada "terbaru" berarti candle terkini bisa telat ≤5 dtk saat
  refetch — tak masalah untuk chart historis; harga live yang presisi tetap lewat SSE
  (`/api/prices`), bukan `/api/candles`.
- **DXY** tetap lewat `handleDXYCandles` (sintetis) — di luar scope; bisa di-cache terpisah
  nanti kalau perlu.
- Jangan cache response non-200 (error OANDA / rate limit) supaya tak "membekukan" kegagalan.
- Kalau kelak multi-instance (bukan single proses lagi), in-memory cache jadi per-instance —
  baru saat itu pertimbangkan cache bersama; untuk sekarang single-proses → cukup.
- Sinergi: pasangkan dengan **cache validasi sesi** (TTL 30–60 dtk) untuk melepas tekanan
  SQLite `SetMaxOpenConns(1)` — dibahas terpisah, dua-duanya memberi margin jauh di atas
  100 user.
