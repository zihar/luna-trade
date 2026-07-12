// Persist snapshot feed News (kalender & headlines) untuk warm-start antar-restart.
// Satu baris per key ("calendar"/"headlines"); payload = JSON payload mentah cache.
package main

import "time"

// newsSnapshotSchema = tabel snapshot cache News (didaftarkan di Store.migrate).
const newsSnapshotSchema = `
CREATE TABLE IF NOT EXISTS news_snapshot(
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);`

// SaveNewsSnapshot menyimpan (upsert) snapshot JSON untuk key.
func (s *Store) SaveNewsSnapshot(key, payload string, fetchedAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO news_snapshot(key,payload,fetched_at) VALUES(?,?,?)
		 ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`,
		key, payload, fetchedAt.UTC().Format(time.RFC3339Nano),
	)
	return err
}

// LoadNewsSnapshot membaca snapshot untuk key. ok=false bila belum ada / rusak.
func (s *Store) LoadNewsSnapshot(key string) (payload string, fetchedAt time.Time, ok bool) {
	var ts string
	if err := s.db.QueryRow(
		`SELECT payload,fetched_at FROM news_snapshot WHERE key=?`, key,
	).Scan(&payload, &ts); err != nil {
		return "", time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return "", time.Time{}, false
	}
	return payload, t.UTC(), true
}
