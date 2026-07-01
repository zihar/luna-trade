// Persistensi server-side untuk live trading: journal, fills, snapshot akun, dan
// audit order. Sumber kebenaran live = server (bukan localStorage browser).
//
// Driver: modernc.org/sqlite (pure-Go, tanpa CGO) supaya cross-compile arm64 +
// single-binary tetap jalan seperti sebelumnya. Skema sudah menyertakan kolom
// user_id (default 'local') agar multi-user bisa menyusul tanpa migrasi besar.
package main

import (
	"database/sql"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Store membungkus koneksi SQLite + helper query.
type Store struct {
	db *sql.DB
}

// openStore membuka (atau membuat) database di path dan menjalankan migrasi.
func openStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite: serialkan akses lewat satu koneksi → tak ada SQLITE_BUSY saat snapshot
	// poll & tulis audit/journal bertabrakan. Sekaligus menjamin PRAGMA per-koneksi
	// (foreign_keys) benar-benar berlaku. Beban app ini kecil → biaya serial nol.
	db.SetMaxOpenConns(1)
	// WAL: writer tak memblok reader; cocok untuk polling akun + tulis audit barengan.
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// migrate membuat semua tabel bila belum ada (idempotent).
func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	if _, err := s.db.Exec(authSchema); err != nil {
		return err
	}
	if _, err := s.db.Exec(analyticsSchema); err != nil {
		return err
	}
	// Kolom tambahan (idempotent) — utk DB lama yg tabelnya sudah ada.
	s.addColumnIfMissing("users", "picture", "TEXT")
	s.addColumnIfMissing("journal", "sl", "REAL") // SL/TP paper (server-side)
	s.addColumnIfMissing("journal", "tp", "REAL")
	return nil
}

// addColumnIfMissing menjalankan ALTER TABLE ADD COLUMN; abaikan jika kolom sudah ada.
func (s *Store) addColumnIfMissing(table, col, typ string) {
	if _, err := s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + typ); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		log.Printf("migrate: add %s.%s: %v", table, col, err)
	}
}

const schema = `
CREATE TABLE IF NOT EXISTS journal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL DEFAULT 'local',
  broker          TEXT NOT NULL,            -- oanda | tradelocker | replay
  mode            TEXT NOT NULL,            -- live | replay
  instrument      TEXT NOT NULL,
  dir             TEXT NOT NULL,            -- long | short
  entry           REAL NOT NULL,
  exit            REAL,
  units           REAL NOT NULL,
  r               REAL,
  pnl_ccy         REAL,                     -- realized, mata uang akun (USD)
  balance_after   REAL,
  partial         INTEGER NOT NULL DEFAULT 0,
  open_time       TEXT NOT NULL,
  exit_time       TEXT,
  broker_trade_id TEXT,
  sl              REAL,                     -- stop loss price (paper); NULL = tak ada
  tp              REAL                      -- take profit price (paper); NULL = tak ada
);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal(user_id, exit_time);

CREATE TABLE IF NOT EXISTS fills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL DEFAULT 'local',
  broker          TEXT NOT NULL,
  broker_order_id TEXT,
  broker_trade_id TEXT,
  instrument      TEXT NOT NULL,
  side            TEXT NOT NULL,            -- buy | sell
  units           REAL NOT NULL,
  price           REAL NOT NULL,
  ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL DEFAULT 'local',
  broker        TEXT NOT NULL,
  balance       REAL,
  equity        REAL,
  unrealized_pl REAL,
  margin_used   REAL,
  margin_avail  REAL,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS order_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL DEFAULT 'local',
  broker      TEXT NOT NULL,
  client_tag  TEXT,
  endpoint    TEXT NOT NULL,               -- /api/order, /api/positions/close, ...
  req_json    TEXT NOT NULL,               -- body tervalidasi yang dikirim ke broker
  resp_status INTEGER,
  resp_json   TEXT,                        -- raw response broker
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Idempotency: client_tag unik (kecuali kosong/NULL → boleh banyak utk order
-- tanpa tag). Klaim kedua dgn tag sama gagal di INSERT → ditolak sbg duplikat.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_audit_tag
  ON order_audit(client_tag) WHERE client_tag IS NOT NULL AND client_tag <> '';
`

// authSchema = tabel multi-user (Fase 2a-i). Terpisah dari `schema` agar jelas
// ini lapisan auth/akun, bukan jurnal trading.
const authSchema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,                      -- NULL/'' untuk user Google-only (2a-ii)
  google_sub    TEXT UNIQUE,               -- NULL untuk user password-only
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,             -- 32-byte acak (hex)
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id  INTEGER PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance  REAL NOT NULL                   -- cash/realized; init 10000 saat register
);
`

// User = baris tabel users (subset yang dipakai auth).
type User struct {
	ID           int64
	Email        string
	PasswordHash string
	DisplayName  string
	Picture      string // URL foto profil (Google); kosong utk user password
}

// CreateUser membuat user + paper_account(initBalance) dalam satu transaksi.
// Gagal di salah satu → keduanya batal. Email duplikat → error UNIQUE (dideteksi pemanggil).
func (s *Store) CreateUser(email, passwordHash, displayName string, initBalance float64) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(
		`INSERT INTO users (email,password_hash,display_name) VALUES (?,?,?)`,
		email, passwordHash, displayName,
	)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO paper_accounts (user_id,balance) VALUES (?,?)`, id, initBalance); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}

// GetUserByEmail → user (nil bila tak ada).
func (s *Store) GetUserByEmail(email string) (*User, error) {
	return s.scanUser(`SELECT id,email,password_hash,display_name,picture FROM users WHERE email=?`, email)
}

// GetUserByID → user (nil bila tak ada).
func (s *Store) GetUserByID(id int64) (*User, error) {
	return s.scanUser(`SELECT id,email,password_hash,display_name,picture FROM users WHERE id=?`, id)
}

func (s *Store) scanUser(query string, arg any) (*User, error) {
	var u User
	var pw, dn, pic sql.NullString
	err := s.db.QueryRow(query, arg).Scan(&u.ID, &u.Email, &pw, &dn, &pic)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.PasswordHash, u.DisplayName, u.Picture = pw.String, dn.String, pic.String
	return &u, nil
}

// GetUserByGoogleSub → user via subject Google (nil bila tak ada).
func (s *Store) GetUserByGoogleSub(sub string) (*User, error) {
	return s.scanUser(`SELECT id,email,password_hash,display_name,picture FROM users WHERE google_sub=?`, sub)
}

// UpsertGoogleUser = find-or-create utk login Google:
//  1. cocok google_sub → pakai user itu.
//  2. cocok email (user password lama) → tautkan google_sub ke user itu.
//  3. tak ada → buat user baru (password_hash NULL) + paper_account(initBalance).
//
// Aman dari ras karena seluruh akses store di-serialkan SetMaxOpenConns(1).
func (s *Store) UpsertGoogleUser(sub, email, name, picture string, initBalance float64) (int64, error) {
	if u, err := s.GetUserByGoogleSub(sub); err != nil {
		return 0, err
	} else if u != nil {
		// Segarkan foto (& isi nama bila kosong) tiap login Google.
		_, _ = s.db.Exec(`UPDATE users SET display_name=COALESCE(NULLIF(display_name,''),?), picture=? WHERE id=?`, name, picture, u.ID)
		return u.ID, nil
	}
	if u, err := s.GetUserByEmail(email); err != nil {
		return 0, err
	} else if u != nil {
		// Tautkan akun email lama ke Google; isi display_name bila kosong + foto.
		if _, err := s.db.Exec(
			`UPDATE users SET google_sub=?, display_name=COALESCE(NULLIF(display_name,''),?), picture=? WHERE id=?`,
			sub, name, picture, u.ID,
		); err != nil {
			return 0, err
		}
		return u.ID, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO users (email,google_sub,display_name,picture) VALUES (?,?,?,?)`, email, sub, name, picture)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO paper_accounts (user_id,balance) VALUES (?,?)`, id, initBalance); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}

// CreateSession menyimpan satu sesi (token unik, dgn expiry).
func (s *Store) CreateSession(token string, userID int64, expiresAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)`,
		token, userID, expiresAt.UTC().Format(time.RFC3339),
	)
	return err
}

// SessionUser melihat user dari token sesi; ok=false bila tak ada / kedaluwarsa.
// Expiry dicek di Go (parse RFC3339) agar tak bergantung format string SQLite.
func (s *Store) SessionUser(token string) (userID int64, ok bool, err error) {
	var exp string
	err = s.db.QueryRow(`SELECT user_id,expires_at FROM sessions WHERE token=?`, token).Scan(&userID, &exp)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	t, perr := time.Parse(time.RFC3339, exp)
	if perr != nil || time.Now().After(t) {
		return 0, false, nil
	}
	return userID, true, nil
}

// DeleteSession menghapus sesi (logout / revoke).
func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token=?`, token)
	return err
}

// ===================== Paper engine per-user (Fase 2b) =====================
// Posisi paper memakai tabel `journal` dgn mode='paper', broker='paper',
// user_id = id user. Posisi terbuka = exit IS NULL. Saldo cash di paper_accounts;
// equity/margin dihitung on-the-fly di paper.go (tak ditulis per tick).

// PaperTrade = posisi paper terbuka (subset journal).
type PaperTrade struct {
	ID         int64    `json:"id"`
	Instrument string   `json:"instrument"`
	Dir        string   `json:"dir"` // long | short
	Entry      float64  `json:"entry"`
	Units      float64  `json:"units"`
	OpenTime   string   `json:"openTime"`
	SL         *float64 `json:"sl,omitempty"` // stop loss price (nil = tak ada)
	TP         *float64 `json:"tp,omitempty"` // take profit price (nil = tak ada)
}

// ClosedPaperTrade = baris journal paper yang sudah ditutup (utk riwayat).
type ClosedPaperTrade struct {
	PaperTrade
	Exit         float64 `json:"exit"`
	PnLCcy       float64 `json:"pnlCcy"`
	BalanceAfter float64 `json:"balanceAfter"`
	ExitTime     string  `json:"exitTime"`
}

func uidStr(userID int64) string { return strconv.FormatInt(userID, 10) }

// PaperBalance mengembalikan saldo cash (realized) paper user.
func (s *Store) PaperBalance(userID int64) (float64, error) {
	var bal float64
	err := s.db.QueryRow(`SELECT balance FROM paper_accounts WHERE user_id=?`, userID).Scan(&bal)
	return bal, err
}

// OpenPaperTrade menyisipkan posisi paper terbuka (exit NULL) → balikan id-nya.
func (s *Store) OpenPaperTrade(userID int64, instrument, dir string, entry, units float64, openTime string, sl, tp *float64) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO journal (user_id,broker,mode,instrument,dir,entry,units,open_time,sl,tp)
		 VALUES (?, 'paper', 'paper', ?, ?, ?, ?, ?, ?, ?)`,
		uidStr(userID), instrument, dir, entry, units, openTime, sl, tp,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// OpenPaperTrades = semua posisi paper terbuka milik user.
func (s *Store) OpenPaperTrades(userID int64) ([]PaperTrade, error) {
	rows, err := s.db.Query(
		`SELECT id,instrument,dir,entry,units,open_time,sl,tp FROM journal
		 WHERE user_id=? AND mode='paper' AND exit IS NULL ORDER BY id`,
		uidStr(userID),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PaperTrade
	for rows.Next() {
		var t PaperTrade
		if err := rows.Scan(&t.ID, &t.Instrument, &t.Dir, &t.Entry, &t.Units, &t.OpenTime, &t.SL, &t.TP); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetPaperTrade mengambil satu posisi paper TERBUKA milik user (nil bila tak ada).
func (s *Store) GetPaperTrade(userID, id int64) (*PaperTrade, error) {
	var t PaperTrade
	err := s.db.QueryRow(
		`SELECT id,instrument,dir,entry,units,open_time,sl,tp FROM journal
		 WHERE id=? AND user_id=? AND mode='paper' AND exit IS NULL`,
		id, uidStr(userID),
	).Scan(&t.ID, &t.Instrument, &t.Dir, &t.Entry, &t.Units, &t.OpenTime, &t.SL, &t.TP)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdatePaperSLTP memperbarui SL/TP posisi paper TERBUKA milik user (nil = hapus level).
func (s *Store) UpdatePaperSLTP(userID, id int64, sl, tp *float64) error {
	res, err := s.db.Exec(
		`UPDATE journal SET sl=?, tp=? WHERE id=? AND user_id=? AND mode='paper' AND exit IS NULL`,
		sl, tp, id, uidStr(userID),
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("posisi tidak ditemukan atau sudah ditutup")
	}
	return nil
}

// PaperOpenSLTP = posisi paper terbuka (lintas user) yg punya SL atau TP — utk monitor.
type PaperOpenSLTP struct {
	UserID int64
	PaperTrade
}

// AllOpenPaperSLTP mengembalikan semua posisi paper terbuka milik SEMUA user yang
// memiliki SL dan/atau TP. Dipakai goroutine monitor utk auto-close server-side.
func (s *Store) AllOpenPaperSLTP() ([]PaperOpenSLTP, error) {
	rows, err := s.db.Query(
		`SELECT user_id,id,instrument,dir,entry,units,open_time,sl,tp FROM journal
		 WHERE mode='paper' AND exit IS NULL AND (sl IS NOT NULL OR tp IS NOT NULL)`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PaperOpenSLTP
	for rows.Next() {
		var p PaperOpenSLTP
		var uid string
		if err := rows.Scan(&uid, &p.ID, &p.Instrument, &p.Dir, &p.Entry, &p.Units, &p.OpenTime, &p.SL, &p.TP); err != nil {
			return nil, err
		}
		p.UserID, _ = strconv.ParseInt(uid, 10, 64)
		out = append(out, p)
	}
	return out, rows.Err()
}

// ClosePaperTrade merealisasikan P&L: update saldo (sekali) + tutup baris journal,
// dalam satu transaksi. Balikan saldo baru. Gagal bila posisi bukan milik user / sudah tutup.
func (s *Store) ClosePaperTrade(userID, id int64, exit, pnlCcy float64, exitTime string) (newBalance float64, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Guard + tutup baris journal (atomik dgn update saldo).
	res, err := tx.Exec(
		`UPDATE journal SET exit=?, pnl_ccy=?, exit_time=?
		 WHERE id=? AND user_id=? AND mode='paper' AND exit IS NULL`,
		exit, pnlCcy, exitTime, id, uidStr(userID),
	)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, errors.New("posisi tidak ditemukan atau sudah ditutup")
	}
	if _, err = tx.Exec(`UPDATE paper_accounts SET balance=balance+? WHERE user_id=?`, pnlCcy, userID); err != nil {
		return 0, err
	}
	if err = tx.QueryRow(`SELECT balance FROM paper_accounts WHERE user_id=?`, userID).Scan(&newBalance); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(`UPDATE journal SET balance_after=? WHERE id=?`, newBalance, id); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return newBalance, nil
}

// ClosedPaperTrades = riwayat posisi paper tertutup milik user (terbaru dulu).
func (s *Store) ClosedPaperTrades(userID int64) ([]ClosedPaperTrade, error) {
	rows, err := s.db.Query(
		`SELECT id,instrument,dir,entry,units,open_time,exit,pnl_ccy,balance_after,exit_time
		 FROM journal WHERE user_id=? AND mode='paper' AND exit IS NOT NULL
		 ORDER BY exit_time DESC, id DESC`,
		uidStr(userID),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClosedPaperTrade
	for rows.Next() {
		var t ClosedPaperTrade
		var exit, pnl, balAfter sql.NullFloat64
		var exitTime sql.NullString
		if err := rows.Scan(&t.ID, &t.Instrument, &t.Dir, &t.Entry, &t.Units, &t.OpenTime,
			&exit, &pnl, &balAfter, &exitTime); err != nil {
			return nil, err
		}
		t.Exit, t.PnLCcy, t.BalanceAfter, t.ExitTime = exit.Float64, pnl.Float64, balAfter.Float64, exitTime.String
		out = append(out, t)
	}
	return out, rows.Err()
}

// logf util kecil supaya pemanggil store bisa lapor sekali di startup.
func (s *Store) logReady(path string) {
	log.Printf("Store SQLite siap → %s", path)
}

// SaveAccountSnapshot menyimpan snapshot ringkasan akun (dipanggil saat /api/account).
func (s *Store) SaveAccountSnapshot(broker string, a Account) error {
	_, err := s.db.Exec(
		`INSERT INTO account_snapshots (broker,balance,equity,unrealized_pl,margin_used,margin_avail)
		 VALUES (?,?,?,?,?,?)`,
		broker, a.Balance, a.Equity, a.UnrealizedPL, a.MarginUsed, a.MarginAvailable,
	)
	return err
}

// SaveOrderAudit mencatat satu percakapan order ke broker (request tervalidasi + respons).
func (s *Store) SaveOrderAudit(broker, clientTag, endpoint, reqJSON string, respStatus int, respJSON string) error {
	_, err := s.db.Exec(
		`INSERT INTO order_audit (broker,client_tag,endpoint,req_json,resp_status,resp_json)
		 VALUES (?,?,?,?,?,?)`,
		broker, clientTag, endpoint, reqJSON, respStatus, respJSON,
	)
	return err
}

// ClaimOrder mengklaim client_tag dengan menyisipkan baris audit 'pending'
// (resp_status=0). UNIQUE index pada client_tag membuat klaim kedua gagal di
// INSERT → balikan claimed=false = duplikat; pemanggil WAJIB menolak order agar
// tak dobel. Tag yang sama tidak akan pernah mengeksekusi order dua kali, bahkan
// jika request datang bersamaan (klaim di-serialkan oleh SetMaxOpenConns(1) dan
// dijamin atomik oleh UNIQUE constraint).
func (s *Store) ClaimOrder(broker, clientTag, endpoint, reqJSON string) (id int64, claimed bool, err error) {
	res, err := s.db.Exec(
		`INSERT INTO order_audit (broker,client_tag,endpoint,req_json,resp_status,resp_json)
		 VALUES (?,?,?,?,0,'')`,
		broker, clientTag, endpoint, reqJSON,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return 0, false, nil
		}
		return 0, false, err
	}
	id, _ = res.LastInsertId()
	return id, true, nil
}

// CompleteOrderAudit melengkapi baris audit yang sudah diklaim (ClaimOrder)
// dengan status & respons broker setelah order dieksekusi.
func (s *Store) CompleteOrderAudit(id int64, respStatus int, respJSON string) error {
	_, err := s.db.Exec(
		`UPDATE order_audit SET resp_status=?, resp_json=? WHERE id=?`,
		respStatus, respJSON, id,
	)
	return err
}

// SaveFill mencatat satu fill (eksekusi terisi) dari broker.
func (s *Store) SaveFill(broker, brokerOrderID, brokerTradeID, instrument, side string, units, price float64) error {
	_, err := s.db.Exec(
		`INSERT INTO fills (broker,broker_order_id,broker_trade_id,instrument,side,units,price)
		 VALUES (?,?,?,?,?,?,?)`,
		broker, brokerOrderID, brokerTradeID, instrument, side, units, price,
	)
	return err
}

// OpenJournal membuat baris journal saat posisi dibuka (exit/pnl masih kosong).
func (s *Store) OpenJournal(broker, instrument, dir string, entry, units float64, openTime, brokerTradeID string) error {
	_, err := s.db.Exec(
		`INSERT INTO journal (broker,mode,instrument,dir,entry,units,open_time,broker_trade_id)
		 VALUES (?,'live',?,?,?,?,?,?)`,
		broker, instrument, dir, entry, units, openTime, brokerTradeID,
	)
	return err
}

// CloseJournal melengkapi baris journal saat posisi ditutup (by broker_trade_id).
func (s *Store) CloseJournal(brokerTradeID string, exit, pnlCcy, balanceAfter float64, exitTime string) error {
	_, err := s.db.Exec(
		`UPDATE journal SET exit=?, pnl_ccy=?, balance_after=?, exit_time=?
		 WHERE broker_trade_id=? AND exit IS NULL`,
		exit, pnlCcy, balanceAfter, exitTime, brokerTradeID,
	)
	return err
}

// ===================== analytics (event usage fitur per user) =====================

const analyticsSchema = `
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name    TEXT    NOT NULL,            -- nama event/fitur, mis. 'draw','order','layout'
  props   TEXT,                        -- JSON properti opsional (instrument, tool, dst)
  ts      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);
CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts);
`

// LogEvent menyimpan satu event pemakaian fitur. propsJSON boleh "" / "{}".
func (s *Store) LogEvent(userID int64, name, propsJSON string) error {
	_, err := s.db.Exec(`INSERT INTO events (user_id,name,props) VALUES (?,?,?)`, userID, name, propsJSON)
	return err
}

// FeatureStat = ringkasan pemakaian satu fitur.
type FeatureStat struct {
	Name   string `json:"name"`
	Count  int    `json:"count"`  // total event
	Users  int    `json:"users"`  // user unik yang memakai
}

// FeatureUsage = pemakaian per fitur sejak `sinceISO` (RFC3339), urut terpopuler.
func (s *Store) FeatureUsage(sinceISO string) ([]FeatureStat, error) {
	rows, err := s.db.Query(
		`SELECT name, COUNT(*) c, COUNT(DISTINCT user_id) u
		 FROM events WHERE ts>=? GROUP BY name ORDER BY c DESC`, sinceISO)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FeatureStat
	for rows.Next() {
		var f FeatureStat
		if err := rows.Scan(&f.Name, &f.Count, &f.Users); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ActiveUsers = jumlah user unik yang punya event sejak `sinceISO`.
func (s *Store) ActiveUsers(sinceISO string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(DISTINCT user_id) FROM events WHERE ts>=?`, sinceISO).Scan(&n)
	return n, err
}

// NameCount = pasangan nama-fitur + jumlah (rincian per user).
type NameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// UserActivity = aktivitas satu user (total event, terakhir aktif, rincian fitur).
type UserActivity struct {
	Email    string      `json:"email"`
	Events   int         `json:"events"`
	LastSeen string      `json:"last_seen"`
	Features []NameCount `json:"features"`
}

// UserActivities = per-user (siapa pakai fitur apa) sejak `sinceISO`, urut paling aktif.
func (s *Store) UserActivities(sinceISO string) ([]UserActivity, error) {
	rows, err := s.db.Query(
		`SELECT u.email, e.name, COUNT(*) c, MAX(e.ts) last
		 FROM events e JOIN users u ON u.id=e.user_id
		 WHERE e.ts>=? GROUP BY u.email, e.name ORDER BY c DESC`, sinceISO)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	idx := map[string]*UserActivity{}
	var order []*UserActivity
	for rows.Next() {
		var email, name, last string
		var c int
		if err := rows.Scan(&email, &name, &c, &last); err != nil {
			return nil, err
		}
		ua := idx[email]
		if ua == nil {
			ua = &UserActivity{Email: email}
			idx[email] = ua
			order = append(order, ua)
		}
		ua.Events += c
		ua.Features = append(ua.Features, NameCount{Name: name, Count: c})
		if last > ua.LastSeen {
			ua.LastSeen = last
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// urut user paling aktif dulu (simple insertion sort — jumlah user kecil)
	out := make([]UserActivity, 0, len(order))
	for _, ua := range order {
		out = append(out, *ua)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Events > out[j-1].Events; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}
