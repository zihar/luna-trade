# Server-Side Price Alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pindahkan price alerts dari localStorage ke server per-user, dimonitor server-side terhadap tick live (fire saat harga melintasi level, one-shot), dengan panel Alerts terlihat + dialog Create ala TradingView; replay tetap fire client-side non-destruktif.

**Architecture:** Meniru pola SL/TP paper. Tabel SQLite `price_alerts` per user → CRUD store → `alert_monitor.go` (subscribe Hub, per-tick crossing) → API `requireUser` → frontend fetch + poll ~2s untuk surface triggered.

**Tech Stack:** Go (`net/http` ServeMux, `modernc.org/sqlite`), vanilla JS `index.html`, SSE hub harga (read-only di sini).

## Global Constraints
- Teks UI ke pengguna **bahasa Inggris**; komentar/commit boleh Indonesian.
- Per-user via sesi cookie: `uid, _ := userIDFromCtx(r)` (`auth.go:189`); semua endpoint data dibungkus `requireUser` (`api.go`).
- Timestamp epoch **ms** (`time.Now().UnixMilli()`), selaras client.
- Jangan ubah: auth/sesi, Hub/SSE harga, `paper_monitor.go`, `checkTrade`/`checkPending`, logika replay lain.
- Gate monitor via env (pola `main.go:105-107`).
- **Backend**: `go build ./...` + `go test ./...` harus hijau tiap task backend.
- **Frontend**: tak ada framework test → gate = cek sintaks inline + verifikasi manual browser. Cek sintaks:
  ```bash
  node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,a='';while((m=re.exec(h)))a+='\n;{\n'+m[1]+'\n}\n';new (require('vm').Script)(a,{filename:'x'});console.log('SYNTAX OK');"
  ```

## File Structure
- **Modify** `store.go` — const `alertsSchema` + Exec di `migrate()`; tipe `Alert`/`AlertRow`; 5 metode CRUD.
- **Create** `alert_monitor.go` — `crossed()` + `startAlertMonitor()`.
- **Modify** `main.go` — panggil `startAlertMonitor` (gate env).
- **Modify** `api.go` — register 3 route + 3 handler.
- **Create** `alert_monitor_test.go`, dan tambah test store (`store_test.go` bila ada; kalau tidak, buat).
- **Modify** `index.html` — data layer (fetch), poll, `checkAlerts` replay-only, panel Alerts + dialog Create + CSS.

---

### Task 1: Store — schema `price_alerts` + CRUD + tests

**Files:** Modify `store.go`; Create/append `store_alerts_test.go`.

**Interfaces (Produces):**
- `type Alert struct { ID int64; Instrument string; Price float64; Active bool; CreatedAt int64; TriggeredAt *int64 }`
- `type AlertRow struct { UserID, ID int64; Instrument string; Price float64 }`
- `(s *Store) CreateAlert(uid int64, instrument string, price float64, createdAt int64) (int64, error)`
- `(s *Store) ListAlerts(uid int64) ([]Alert, error)`
- `(s *Store) DeleteAlert(uid, id int64) error`
- `(s *Store) AllActiveAlerts() ([]AlertRow, error)`
- `(s *Store) MarkAlertTriggered(id, triggeredAt int64) error`

- [ ] **Step 1: Tulis test dulu (gagal)** — `store_alerts_test.go`:
```go
package main

import "testing"

func TestAlertsCRUD(t *testing.T) {
	s := mustTestStore(t) // helper: buka Store di file temp + migrate (lihat Step 2)
	id, err := s.CreateAlert(1, "EUR_USD", 1.2345, 1000)
	if err != nil || id == 0 { t.Fatalf("create: id=%d err=%v", id, err) }
	got, err := s.ListAlerts(1)
	if err != nil || len(got) != 1 || got[0].Price != 1.2345 || !got[0].Active { t.Fatalf("list: %+v err=%v", got, err) }
	// ownership: user lain tak bisa hapus
	if err := s.DeleteAlert(2, id); err == nil { t.Fatalf("delete by wrong user should error") }
	// monitor melihatnya aktif
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].UserID != 1 { t.Fatalf("active rows: %+v", rows) }
	// trigger → one-shot: tak lagi aktif
	if err := s.MarkAlertTriggered(id, 2000); err != nil { t.Fatalf("mark: %v", err) }
	rows, _ = s.AllActiveAlerts()
	if len(rows) != 0 { t.Fatalf("after trigger, active should be 0: %+v", rows) }
	// masih tampil di ListAlerts (triggered, belum di-ack) dgn TriggeredAt terisi
	got, _ = s.ListAlerts(1)
	if len(got) != 1 || got[0].TriggeredAt == nil || *got[0].TriggeredAt != 2000 { t.Fatalf("triggered list: %+v", got) }
	// hapus oleh pemilik
	if err := s.DeleteAlert(1, id); err != nil { t.Fatalf("delete: %v", err) }
	got, _ = s.ListAlerts(1)
	if len(got) != 0 { t.Fatalf("after delete: %+v", got) }
}
```

- [ ] **Step 2: Jalankan → GAGAL** (fungsi/helper belum ada).
Run: `go test -run TestAlertsCRUD ./...`
Expected: FAIL (undefined `mustTestStore`/`CreateAlert`).

- [ ] **Step 3: Tambah helper test** (bila belum ada `mustTestStore`) di `store_alerts_test.go`:
```go
func mustTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(t.TempDir() + "/t.db") // sesuaikan nama konstruktor Store yg ada (mis. NewStore/OpenStore)
	if err != nil { t.Fatalf("open store: %v", err) }
	return s
}
```
(Verifikasi konstruktor Store yg sebenarnya di `store.go` — pakai nama itu; migrate dipanggil di konstruktor.)

- [ ] **Step 4: Tambah schema** di `store.go` — const `alertsSchema` + Exec di `migrate()` (dekat blok schema lain `store.go:51-66`):
```go
const alertsSchema = `
CREATE TABLE IF NOT EXISTS price_alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  instrument TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  triggered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(active);`
```
Di `migrate()` tambahkan: `if _, err := s.db.Exec(alertsSchema); err != nil { return err }` (ikuti gaya eksekusi schema lain di fungsi itu).

- [ ] **Step 5: Tambah tipe + CRUD** di `store.go`:
```go
type Alert struct {
	ID          int64
	Instrument  string
	Price       float64
	Active      bool
	CreatedAt   int64
	TriggeredAt *int64
}
type AlertRow struct {
	UserID     int64
	ID         int64
	Instrument string
	Price      float64
}

func (s *Store) CreateAlert(uid int64, instrument string, price float64, createdAt int64) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO price_alerts(user_id,instrument,price,active,created_at) VALUES(?,?,?,1,?)`,
		uid, instrument, price, createdAt)
	if err != nil { return 0, err }
	return res.LastInsertId()
}

func (s *Store) ListAlerts(uid int64) ([]Alert, error) {
	rows, err := s.db.Query(`SELECT id,instrument,price,active,created_at,triggered_at
		FROM price_alerts WHERE user_id=? AND (active=1 OR triggered_at IS NOT NULL)
		ORDER BY created_at DESC`, uid)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		var act int
		var trig *int64
		if err := rows.Scan(&a.ID, &a.Instrument, &a.Price, &act, &a.CreatedAt, &trig); err != nil { return nil, err }
		a.Active = act == 1
		a.TriggeredAt = trig
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) DeleteAlert(uid, id int64) error {
	res, err := s.db.Exec(`DELETE FROM price_alerts WHERE id=? AND user_id=?`, id, uid)
	if err != nil { return err }
	n, _ := res.RowsAffected()
	if n == 0 { return fmt.Errorf("alert not found") }
	return nil
}

func (s *Store) AllActiveAlerts() ([]AlertRow, error) {
	rows, err := s.db.Query(`SELECT user_id,id,instrument,price FROM price_alerts WHERE active=1`)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []AlertRow
	for rows.Next() {
		var r AlertRow
		if err := rows.Scan(&r.UserID, &r.ID, &r.Instrument, &r.Price); err != nil { return nil, err }
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) MarkAlertTriggered(id, triggeredAt int64) error {
	_, err := s.db.Exec(`UPDATE price_alerts SET active=0, triggered_at=? WHERE id=? AND active=1`, triggeredAt, id)
	return err
}
```
(Pastikan `fmt` sudah di-import di `store.go`; bila belum, tambahkan.)

- [ ] **Step 6: Jalankan → PASS**.
Run: `go test -run TestAlertsCRUD ./...`
Expected: PASS.

- [ ] **Step 7: Commit**:
```bash
git add store.go store_alerts_test.go
git commit -m "feat(alerts): tabel price_alerts + CRUD store per-user (+test)"
```

---

### Task 2: `alert_monitor.go` — crossing + monitor + wiring

**Files:** Create `alert_monitor.go`, `alert_monitor_test.go`; Modify `main.go`.

**Interfaces:**
- Consumes: `Store` (Task 1), `Hub` (`hub.go` — verifikasi signatur `Subscribe() <-chan Tick`/`Unsubscribe`, dan field `Tick{Instrument,Bid,Ask}` dari `paper_monitor.go`).
- Produces: `func crossed(prev, cur, lvl float64) bool`; `func startAlertMonitor(store *Store, hub *Hub)`.

- [ ] **Step 1: Test `crossed()` (gagal)** — `alert_monitor_test.go`:
```go
package main

import "testing"

func TestCrossed(t *testing.T) {
	cases := []struct{ a, b, lvl float64; want bool }{
		{1.10, 1.20, 1.15, true},  // naik melintas
		{1.20, 1.10, 1.15, true},  // turun melintas
		{1.10, 1.12, 1.15, false}, // tak sampai
		{1.20, 1.18, 1.15, false}, // tak sampai
		{1.10, 1.15, 1.15, true},  // sentuh tepat (naik)
		{1.20, 1.15, 1.15, true},  // sentuh tepat (turun)
	}
	for i, c := range cases {
		if got := crossed(c.a, c.b, c.lvl); got != c.want {
			t.Errorf("case %d crossed(%v,%v,%v)=%v want %v", i, c.a, c.b, c.lvl, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Jalankan → GAGAL** (undefined `crossed`).
Run: `go test -run TestCrossed ./...` → FAIL.

- [ ] **Step 3: Tulis `alert_monitor.go`**:
```go
package main

import (
	"log"
	"os"
	"strings"
	"time"
)

// crossed: true bila level lvl dilewati/disentuh antara harga prev→cur.
func crossed(prev, cur, lvl float64) bool {
	return (prev < lvl && cur >= lvl) || (prev > lvl && cur <= lvl)
}

// startAlertMonitor: monitor price alert server-side per-tick (semua instrumen), one-shot.
// Meniru paper_monitor.go. Aman dipanggil sekali saat startup (gate di main.go).
func startAlertMonitor(store *Store, hub *Hub) {
	ch := hub.Subscribe()
	go func() {
		defer hub.Unsubscribe(ch)
		var cache []AlertRow
		reload := func() {
			rows, err := store.AllActiveAlerts()
			if err == nil { cache = rows }
		}
		reload()
		refresh := time.NewTicker(2 * time.Second)
		defer refresh.Stop()
		last := map[string]float64{}
		log.Printf("alert monitor: price-alert server-side aktif")
		for {
			select {
			case <-refresh.C:
				reload()
			case t := <-ch:
				if t.Bid <= 0 || t.Ask <= 0 { continue }
				mid := (t.Bid + t.Ask) / 2
				prev, ok := last[t.Instrument]
				last[t.Instrument] = mid
				if !ok { continue }
				hit := false
				for _, a := range cache {
					if !strings.EqualFold(a.Instrument, t.Instrument) { continue }
					if crossed(prev, mid, a.Price) {
						if err := store.MarkAlertTriggered(a.ID, time.Now().UnixMilli()); err == nil {
							hit = true
						}
					}
				}
				if hit { reload() }
			}
		}
	}()
}
```
(Verifikasi terhadap `hub.go`/`paper_monitor.go`: nama `Hub`, `Subscribe`/`Unsubscribe`, tipe channel, dan field `Tick`. Sesuaikan bila berbeda — mis. bila `Subscribe` mengembalikan struct pembungkus.)

- [ ] **Step 4: Test one-shot (gagal→pass)** — tambah ke `alert_monitor_test.go`:
```go
func TestMonitorOneShot(t *testing.T) {
	s := mustTestStore(t)
	id, _ := s.CreateAlert(1, "EUR_USD", 1.15, 1000)
	_ = id
	// simulasikan langkah inti monitor tanpa Hub: prev→cur melintas → MarkAlertTriggered sekali
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 { t.Fatalf("want 1 active") }
	if crossed(1.10, 1.20, rows[0].Price) {
		s.MarkAlertTriggered(rows[0].ID, 2000)
	}
	rows2, _ := s.AllActiveAlerts()
	if len(rows2) != 0 { t.Fatalf("one-shot: harus 0 aktif setelah trigger, got %d", len(rows2)) }
}
```

- [ ] **Step 5: Jalankan → PASS**.
Run: `go test -run 'TestCrossed|TestMonitorOneShot' ./...` → PASS. Lalu `go build ./...`.

- [ ] **Step 6: Wire di `main.go`** (dekat gate paper monitor `main.go:105-107`):
```go
if cfg.Creds.AccountID != "" && os.Getenv("ALERT_MONITOR") != "0" {
	startAlertMonitor(store, hub)
}
```
(Pakai nama variabel `store`/`hub`/`cfg` yang benar di `main.go` — verifikasi.)

- [ ] **Step 7: Commit**:
```bash
git add alert_monitor.go alert_monitor_test.go main.go
git commit -m "feat(alerts): alert_monitor server-side (crossing per-tick, one-shot) + wiring"
```

---

### Task 3: API — `GET/POST /api/alerts` + `/api/alerts/delete`

**Files:** Modify `api.go` (register + 3 handler).

**Interfaces:**
- Consumes: `userIDFromCtx` (`auth.go:189`), `writeJSON`/`writeErr` (`api.go:177-185`), `decodeJSON` (`auth.go:263`) atau `json.NewDecoder(io.LimitReader(...))`, store CRUD (Task 1).
- Produces route: `GET /api/alerts`, `POST /api/alerts`, `POST /api/alerts/delete`.

- [ ] **Step 1: Register route** di `registerAPI(mux)` (`api.go:25-36`, pola `mux.HandleFunc("POST /api/order", requireUser(handlePaperOrder))`):
```go
mux.HandleFunc("GET /api/alerts", requireUser(handleAlertsList))
mux.HandleFunc("POST /api/alerts", requireUser(handleAlertCreate))
mux.HandleFunc("POST /api/alerts/delete", requireUser(handleAlertDelete))
```

- [ ] **Step 2: Handler** (tambahkan di `api.go`; pola `handlePaperModify` `paper.go:129-167`):
```go
type alertView struct {
	ID          int64   `json:"id"`
	Instrument  string  `json:"instrument"`
	Price       float64 `json:"price"`
	Active      bool    `json:"active"`
	CreatedAt   int64   `json:"createdAt"`
	TriggeredAt *int64  `json:"triggeredAt"`
}

func handleAlertsList(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	rows, err := store.ListAlerts(uid)
	if err != nil { writeErr(w, http.StatusInternalServerError, err.Error()); return }
	out := make([]alertView, 0, len(rows))
	for _, a := range rows {
		out = append(out, alertView{a.ID, a.Instrument, a.Price, a.Active, a.CreatedAt, a.TriggeredAt})
	}
	writeJSON(w, http.StatusOK, out)
}

func handleAlertCreate(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		Instrument string  `json:"instrument"`
		Price      float64 `json:"price"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json"); return
	}
	if req.Instrument == "" || req.Price <= 0 {
		writeErr(w, http.StatusBadRequest, "instrument & price required"); return
	}
	now := time.Now().UnixMilli()
	id, err := store.CreateAlert(uid, req.Instrument, req.Price, now)
	if err != nil { writeErr(w, http.StatusInternalServerError, err.Error()); return }
	writeJSON(w, http.StatusOK, alertView{id, req.Instrument, req.Price, true, now, nil})
}

func handleAlertDelete(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct{ ID int64 `json:"id"` }
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json"); return
	}
	if err := store.DeleteAlert(uid, req.ID); err != nil {
		writeErr(w, http.StatusNotFound, "alert not found"); return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```
(Verifikasi cara akses `store` global di `api.go`/`paper.go` — pakai pola yg sama, mis. paket-level `store`. Pastikan import `io`, `time`, `encoding/json`, `net/http` ada.)

- [ ] **Step 3: Build + smoke**:
Run: `go build ./... && go vet ./...`
Expected: sukses tanpa error.

- [ ] **Step 4: Manual smoke (opsional, butuh server+login)**: `curl` dgn cookie sesi:
`POST /api/alerts {"instrument":"EUR_USD","price":1.2}` → 200 + view; `GET /api/alerts` → list berisi; `POST /api/alerts/delete {"id":<id>}` → ok; `GET` → kosong. (Bila tak bisa curl bersesi, verifikasi lewat FE di Task 4/6.)

- [ ] **Step 5: Commit**:
```bash
git add api.go
git commit -m "feat(alerts): API GET/POST/delete /api/alerts (requireUser)"
```

---

### Task 4: Frontend data layer — alerts dari server + `checkAlerts` replay-only

**Files:** Modify `index.html`.

**Interfaces:** Consumes API Task 3. Mengubah: `alerts` state, `loadAlerts`, `addAlert`, `createAlertAt`, `removeAlert`, `checkAlerts`, buang `saveAlerts`/`br_alerts`.

- [ ] **Step 1: Ganti `loadAlerts`/`saveAlerts`** (`index.html:4893-4894`) → server:
```js
async function loadAlerts(){
  try{
    const r=await fetch('/api/alerts'); if(!r.ok){ alerts=[]; renderAlertList(); drawAlertLines(); return; }
    const rows=await r.json();
    alerts=(rows||[]).map(a=>({id:a.id, sym:a.instrument, price:a.price, triggeredAt:a.triggeredAt, oid:null}));
    renderAlertList(); drawAlertLines();
  }catch(e){ alerts=[]; }
}
// saveAlerts dihapus — server jadi source of truth. (Cari & hapus semua pemanggilan saveAlerts.)
```

- [ ] **Step 2: `addAlert`/`createAlertAt` → POST**; `removeAlert` → delete (`index.html:4927-4943`):
```js
async function createServerAlert(price){
  const p=+(+price).toFixed(priceDecimals()); if(!p||p<=0) return null;
  try{
    const r=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({instrument:inst, price:p})});
    if(!r.ok) return null;
    const a=await r.json();
    alerts.push({id:a.id, sym:a.instrument, price:a.price, triggeredAt:null, oid:null});
    track('alert',{inst}); renderAlertList(); drawAlertLines(); return a;
  }catch(e){ return null; }
}
function createAlertAt(price){ if(price==null||isNaN(price)) return;
  if(typeof Notification!=='undefined' && Notification.permission==='default'){ try{Notification.requestPermission();}catch(e){} }
  createServerAlert(price).then(a=>{ if(a) toast('Alert set @ '+fmt(a.price),'success'); });
}
async function removeAlert(i){
  const a=alerts[i]; if(!a) return;
  try{ await fetch('/api/alerts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id})}); }catch(e){}
  if(a.oid!=null){ try{chart.removeOverlay(a.oid);}catch(e){} }
  alerts.splice(i,1); renderAlertList(); drawAlertLines();
}
```
(Tombol lama `#alertAdd`/`#alertPrice` akan diganti dialog di Task 6; sementara boleh sisakan binding lama menunjuk ke `createServerAlert($('#alertPrice').value)`.)

- [ ] **Step 3: `checkAlerts` → replay-only, non-destruktif** (`index.html:4945-4955`):
```js
let replayFiredAlerts = new Set();   // id alert yg sudah bunyi di run replay ini (dedup, non-destruktif)
function checkAlerts(c){
  if(!replayMode) return;            // LIVE ditangani server monitor → cegah dobel
  const fired=alerts.filter(a=>a.sym===inst && c.low<=a.price && a.price<=c.high && !replayFiredAlerts.has(a.id));
  if(!fired.length) return;
  fired.forEach(a=>{
    replayFiredAlerts.add(a.id);     // JANGAN hapus alert server (simulasi)
    const msg=a.sym+' touched '+a.price+' (replay)';
    try{ if(typeof Notification!=='undefined' && Notification.permission==='granted') new Notification('Luna Trade — Alert', {body:msg}); }catch(e){}
    toast(msg,'info');
  });
}
```
Bersihkan `replayFiredAlerts.clear()` saat mulai/keluar replay — tambahkan di handler pick (`setTimeout(()=>{ T=ts; fillT=T; ... }`) dan `exitReplay()`.

- [ ] **Step 4: Init** — `loadAlerts()` sudah dipanggil di boot (`index.html:6010` `loadAlerts(); renderAlertList();`). Karena kini async, pastikan dipanggil setelah auth siap (dekat `spSync`/boot pasca-login). Pindahkan/pastikan `loadAlerts()` jalan setelah login sukses.

- [ ] **Step 5: Cek sintaks inline** → `SYNTAX OK`.

- [ ] **Step 6: Verifikasi manual** (server+login): tambah alert via input lama → muncul di list + garis; reload → tetap ada (server); hapus → hilang. Di replay: alert bunyi (info toast) tanpa terhapus dari server.

- [ ] **Step 7: Commit**:
```bash
git add index.html
git commit -m "feat(alerts): FE alerts dari server (fetch CRUD) + checkAlerts replay-only non-destruktif"
```

---

### Task 5: Frontend poll — surface triggered (toast/Notification → ack)

**Files:** Modify `index.html`.

**Interfaces:** Consumes `GET /api/alerts` + `/api/alerts/delete`. Produces `alertPoll()` + timer.

- [ ] **Step 1: `alertPoll`** (tambahkan dekat `spStartPolling`/`connectPriceStream`):
```js
let alertPollTimer=null;
const shownTriggered=new Set();     // id alert triggered yg sudah ditampilkan (anti-dobel)
async function alertPoll(){
  try{
    const r=await fetch('/api/alerts'); if(!r.ok) return;
    const rows=await r.json();
    // sinkron list dasar (untuk panel) — pertahankan oid overlay bila id sama
    const byId={}; alerts.forEach(a=>byId[a.id]=a);
    const next=(rows||[]).map(a=>({id:a.id, sym:a.instrument, price:a.price, triggeredAt:a.triggeredAt, oid:(byId[a.id]&&byId[a.id].oid)||null}));
    // deteksi triggered baru → toast + Notification + ack (hapus)
    for(const a of rows){
      if(a.triggeredAt!=null && !shownTriggered.has(a.id)){
        shownTriggered.add(a.id);
        const msg=a.instrument+' crossed '+a.price;
        try{ if(typeof Notification!=='undefined' && Notification.permission==='granted') new Notification('Luna Trade — Alert', {body:msg}); }catch(e){}
        toast(msg,'success');
        try{ await fetch('/api/alerts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id})}); }catch(e){}
      }
    }
    // buang yg sudah di-ack dari list yg akan dirender
    alerts=next.filter(a=>!(a.triggeredAt!=null && shownTriggered.has(a.id)));
    renderAlertList(); drawAlertLines();
  }catch(e){}
}
function startAlertPoll(){ if(alertPollTimer) return; alertPoll(); alertPollTimer=setInterval(alertPoll, 2000); }
function stopAlertPoll(){ clearInterval(alertPollTimer); alertPollTimer=null; }
```

- [ ] **Step 2: Mulai poll setelah login** (dekat tempat `connectPriceStream()`/boot pasca-auth): panggil `startAlertPoll()`. Pada logout → `stopAlertPoll()`.

- [ ] **Step 3: Cek sintaks inline** → `SYNTAX OK`.

- [ ] **Step 4: Verifikasi manual**: set alert dekat harga live; saat harga melintasi → dalam ~2s muncul toast + Notification, alert hilang (one-shot), konsisten di 2 browser login sama. Server jalan tanpa browser → buka lagi → alert triggered muncul lalu hilang (ack).

- [ ] **Step 5: Commit**:
```bash
git add index.html
git commit -m "feat(alerts): FE poll ~2s surface alert triggered (toast/Notification → ack one-shot)"
```

---

### Task 6: Frontend UI — panel Alerts + dialog Create

**Files:** Modify `index.html` (HTML section, CSS, JS dialog + renderAlertList).

**Interfaces:** Consumes `createServerAlert` (Task 4), `removeAlert`. Produces panel + `openAlertDialog()`.

- [ ] **Step 1: Ganti blok alert tersembunyi** (`index.html:1313-1317`, `.wl-alert display:none`) → section terlihat:
```html
<div class="wl-alert" id="alertsPanel">
  <div class="wl-head">Alerts<span class="grow"></span><button class="al-add" id="alertAddBtn" title="Create alert">+</button></div>
  <div id="alertList"></div>
</div>
```
Hapus `style="display:none"` dan input `#alertPrice`/`#alertAdd` lama.

- [ ] **Step 2: `renderAlertList`** (`index.html:4920-4926`) → format TradingView:
```js
function renderAlertList(){
  const el=$('#alertList'); if(!el) return;
  el.innerHTML = alerts.length
    ? alerts.map((a,i)=>`<div class="al-item"><div class="al-main">${a.sym.replace('_','')} Crossing ${a.price}</div>`
        +`<div class="al-sub">${a.sym.replace('_','')} · <span class="al-st${a.triggeredAt?' trig':''}">${a.triggeredAt?'Triggered':'Active'}</span></div>`
        +`<button class="al-x" data-i="${i}" title="Delete">✕</button></div>`).join('')
    : '<div class="al-empty">No alerts yet. Click + to add.</div>';
  el.querySelectorAll('.al-x').forEach(b=>b.onclick=()=>removeAlert(+b.dataset.i));
}
```

- [ ] **Step 3: Dialog Create** — tambah HTML modal (dekat modal/pop lain) + JS:
```html
<div class="alert-modal" id="alertModal" role="dialog" aria-modal="true">
  <div class="am-card">
    <div class="am-head">Create alert on <b id="amInst">—</b><span class="grow"></span><button class="am-x" id="amClose">✕</button></div>
    <div class="am-row"><span class="am-lbl">Condition</span><div class="am-cond">Price · Crossing</div></div>
    <div class="am-row"><span class="am-lbl">Price</span><input type="number" step="0.0001" id="amPrice"></div>
    <div class="am-act"><button id="amCancel">Cancel</button><button class="primary" id="amCreate">Create</button></div>
  </div>
</div>
```
```js
function openAlertDialog(){
  $('#amInst').textContent=inst.replace('_','');
  const m=liveMid?liveMid():null, cur=currentCandle();
  $('#amPrice').value=(m!=null?m:(cur?cur.close:'')) || '';
  $('#alertModal').classList.add('open'); setTimeout(()=>$('#amPrice').focus(),0);
}
function closeAlertDialog(){ $('#alertModal').classList.remove('open'); }
$('#alertAddBtn').onclick=openAlertDialog;
$('#amClose').onclick=closeAlertDialog; $('#amCancel').onclick=closeAlertDialog;
$('#amCreate').onclick=async()=>{ const p=+$('#amPrice').value; if(!p){ setStatus('Enter a price.',true); return; }
  const a=await createServerAlert(p); if(a){ closeAlertDialog(); toast('Alert created @ '+a.price,'success'); } };
$('#alertModal').addEventListener('mousedown',e=>{ if(e.target===$('#alertModal')) closeAlertDialog(); });
```

- [ ] **Step 4: CSS** (dekat CSS panel/menu; pakai vars tema):
```css
#alertsPanel .al-add{ width:24px;height:24px;border-radius:6px;background:var(--btn);border:1px solid var(--border);color:var(--txt);font-size:16px;line-height:1;cursor:pointer }
#alertsPanel .al-add:hover{ background:var(--btn-hover) }
.al-item{ position:relative;padding:8px 26px 8px 8px;border-radius:8px }
.al-item:hover{ background:var(--btn-hover) }
.al-main{ font-weight:600;color:var(--txt);font-size:13px }
.al-sub{ font-size:12px;color:var(--muted);margin-top:2px }
.al-st{ color:var(--green) } .al-st.trig{ color:var(--muted) }
.al-x{ position:absolute;right:6px;top:8px;background:none;border:0;color:var(--muted);cursor:pointer }
.al-x:hover{ color:var(--red) }
.al-empty{ color:var(--muted);font-size:12px;padding:8px }
.alert-modal{ display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);align-items:center;justify-content:center }
.alert-modal.open{ display:flex }
.am-card{ width:min(440px,92vw);background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5) }
.am-head{ display:flex;align-items:center;font-size:16px;color:var(--txt);margin-bottom:12px }
.am-row{ display:flex;align-items:center;gap:12px;margin:10px 0 } .am-lbl{ width:84px;color:var(--muted);font-size:13px }
.am-cond{ flex:1;padding:8px 10px;background:var(--btn);border:1px solid var(--border);border-radius:8px;color:var(--txt) }
#amPrice{ flex:1;padding:8px 10px;background:var(--btn);border:1px solid var(--accent);border-radius:8px;color:var(--txt);font-variant-numeric:tabular-nums }
.am-act{ display:flex;justify-content:flex-end;gap:8px;margin-top:16px }
.am-x{ background:none;border:0;color:var(--muted);cursor:pointer;font-size:16px }
```
(Sesuaikan nama var warna dg yg ada: `--green`/`--red`/`--accent` — verifikasi; bila beda pakai yg tersedia.)

- [ ] **Step 5: Cek sintaks inline** → `SYNTAX OK`.

- [ ] **Step 6: Verifikasi manual**: panel "Alerts" tampak; "+" buka dialog "Create alert on <INST>" dg harga live terisi; Create → item "<INST> Crossing <price> · Active" + garis chart; hapus ✕; triggered (dari Task 5) tampil "Triggered" lalu hilang saat di-ack. Tema gelap/terang rapi. Console bersih.

- [ ] **Step 7: Commit**:
```bash
git add index.html
git commit -m "feat(alerts): panel Alerts terlihat + dialog Create (v1 ala TradingView)"
```

---

## Self-Review
**Spec coverage:** tabel+CRUD (T1) ✓; monitor crossing+one-shot+gate (T2) ✓; API requireUser (T3) ✓; FE server data + checkAlerts replay-only non-destruktif (T4) ✓; poll surface triggered+ack (T5) ✓; panel + dialog Create v1 (T6) ✓. Directionless crossing (T2 `crossed`) ✓. All-instruments (monitor loop by instrument) ✓.
**Placeholder scan:** semua step berisi kode nyata; TODO hanya "verifikasi nama simbol aktual" (Hub/Store constructor/store global) — itu instruksi verifikasi, bukan placeholder kode.
**Type consistency:** `Alert`/`AlertRow` (T1) dipakai konsisten di store/monitor/api; `alertView` JSON `{id,instrument,price,active,createdAt,triggeredAt}` cocok dg FE map (T4/T5). `crossed(prev,cur,lvl)` dipakai monitor + test. FE `alerts=[{id,sym,price,triggeredAt,oid}]` konsisten T4/T5/T6.
**Catatan verifikasi simbol (WAJIB saat implement):** konfirmasi di kode nyata — konstruktor `Store` (mis. `OpenStore`/`NewStore`) + apakah `migrate` dipanggil di sana; signatur `Hub.Subscribe/Unsubscribe` + field `Tick`; cara akses `store` global di `api.go`; nama `cfg`/`store`/`hub` di `main.go`; var warna CSS (`--green/--red/--accent`); `liveMid`/`currentCandle` tersedia.
