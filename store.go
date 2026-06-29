// Persistensi server-side untuk live trading: journal, fills, snapshot akun, dan
// audit order. Sumber kebenaran live = server (bukan localStorage browser).
//
// Driver: modernc.org/sqlite (pure-Go, tanpa CGO) supaya cross-compile arm64 +
// single-binary tetap jalan seperti sebelumnya. Skema sudah menyertakan kolom
// user_id (default 'local') agar multi-user bisa menyusul tanpa migrasi besar.
package main

import (
	"database/sql"
	"log"
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
	_, err := s.db.Exec(authSchema)
	return err
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
  broker_trade_id TEXT
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
	return s.scanUser(`SELECT id,email,password_hash,display_name FROM users WHERE email=?`, email)
}

// GetUserByID → user (nil bila tak ada).
func (s *Store) GetUserByID(id int64) (*User, error) {
	return s.scanUser(`SELECT id,email,password_hash,display_name FROM users WHERE id=?`, id)
}

func (s *Store) scanUser(query string, arg any) (*User, error) {
	var u User
	var pw, dn sql.NullString
	err := s.db.QueryRow(query, arg).Scan(&u.ID, &u.Email, &pw, &dn)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.PasswordHash, u.DisplayName = pw.String, dn.String
	return &u, nil
}

// GetUserByGoogleSub → user via subject Google (nil bila tak ada).
func (s *Store) GetUserByGoogleSub(sub string) (*User, error) {
	return s.scanUser(`SELECT id,email,password_hash,display_name FROM users WHERE google_sub=?`, sub)
}

// UpsertGoogleUser = find-or-create utk login Google:
//  1. cocok google_sub → pakai user itu.
//  2. cocok email (user password lama) → tautkan google_sub ke user itu.
//  3. tak ada → buat user baru (password_hash NULL) + paper_account(initBalance).
//
// Aman dari ras karena seluruh akses store di-serialkan SetMaxOpenConns(1).
func (s *Store) UpsertGoogleUser(sub, email, name string, initBalance float64) (int64, error) {
	if u, err := s.GetUserByGoogleSub(sub); err != nil {
		return 0, err
	} else if u != nil {
		return u.ID, nil
	}
	if u, err := s.GetUserByEmail(email); err != nil {
		return 0, err
	} else if u != nil {
		// Tautkan akun email lama ke Google; isi display_name bila masih kosong.
		if _, err := s.db.Exec(
			`UPDATE users SET google_sub=?, display_name=COALESCE(NULLIF(display_name,''),?) WHERE id=?`,
			sub, name, u.ID,
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
	res, err := tx.Exec(`INSERT INTO users (email,google_sub,display_name) VALUES (?,?,?)`, email, sub, name)
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
