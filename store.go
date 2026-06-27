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
	_, err := s.db.Exec(schema)
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
