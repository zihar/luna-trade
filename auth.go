// Autentikasi multi-user (Fase 2a-i): email+password dengan sesi cookie.
// Menggantikan HTTP Basic Auth single-user. Sesi disimpan di tabel `sessions`
// (revocable, ada expiry); password di-hash bcrypt. Google OAuth menyusul (2a-ii),
// paper engine per-user menyusul (2b) — register di sini sudah membuat baris
// paper_accounts(balance=10000) agar siap dipakai fase berikutnya.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookie    = "luna_session"
	sessionDuration  = 30 * 24 * time.Hour
	paperInitBalance = 10000.0 // saldo paper awal per user baru (USD)
	bcryptCost       = 12
	minPasswordLen   = 8
)

// userIDCtxKey = kunci context tempat requireUser menyuntik id user terautentikasi.
type ctxKey string

const userIDCtxKey ctxKey = "userID"

// dummyHash dipakai login untuk menyamakan waktu bcrypt saat email tak ditemukan
// (cegah user-enumeration lewat timing). Dihitung sekali saat init.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("luna-timing-equalizer"), bcryptCost)

// authLimiter = rate-limit sederhana per-IP untuk register/login (defense-in-depth).
var authLimiter = newRateLimiter(10, time.Minute)

// registerAuth mendaftarkan endpoint auth (publik — tidak di balik requireUser).
func registerAuth(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/register", handleRegister)
	mux.HandleFunc("POST /api/auth/login", handleLogin)
	mux.HandleFunc("POST /api/auth/logout", handleLogout)
	mux.HandleFunc("GET /api/auth/me", handleMe)
	mux.HandleFunc("GET /api/auth/config", handleAuthConfig)
}

// GET /api/auth/config — kapabilitas auth utk FE (mis. tampilkan tombol Google?).
func handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"google": cfg.GoogleEnabled()})
}

type credsBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// POST /api/auth/register — buat user + paper account, lalu mulai sesi.
func handleRegister(w http.ResponseWriter, r *http.Request) {
	if !authLimiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "terlalu banyak percobaan — coba lagi sebentar")
		return
	}
	var body credsBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(email) {
		writeErr(w, http.StatusBadRequest, "email tidak valid")
		return
	}
	if len(body.Password) < minPasswordLen {
		writeErr(w, http.StatusBadRequest, "password minimal 8 karakter")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcryptCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal memproses password")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = email
	}
	uid, err := store.CreateUser(email, string(hash), name, paperInitBalance)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, http.StatusConflict, "email sudah terdaftar")
			return
		}
		log.Printf("register: create user gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "gagal membuat akun")
		return
	}
	if err := startSession(w, r, uid); err != nil {
		log.Printf("register: start session gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "akun dibuat tapi gagal membuat sesi — coba login")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": email, "name": name})
}

// POST /api/auth/login — verifikasi bcrypt, mulai sesi.
func handleLogin(w http.ResponseWriter, r *http.Request) {
	if !authLimiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "terlalu banyak percobaan — coba lagi sebentar")
		return
	}
	var body credsBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	u, err := store.GetUserByEmail(email)
	if err != nil {
		log.Printf("login: lookup user gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "gagal memproses login")
		return
	}
	// Selalu jalankan bcrypt (pakai dummyHash bila user tak ada / Google-only)
	// supaya waktu respons seragam → tak bocorkan keberadaan email.
	hash := dummyHash
	if u != nil && u.PasswordHash != "" {
		hash = []byte(u.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(body.Password)) != nil || u == nil || u.PasswordHash == "" {
		writeErr(w, http.StatusUnauthorized, "email atau password salah")
		return
	}
	if err := startSession(w, r, u.ID); err != nil {
		log.Printf("login: start session gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "gagal membuat sesi")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": u.Email, "name": u.DisplayName})
}

// POST /api/auth/logout — hapus sesi + clear cookie.
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := store.DeleteSession(c.Value); err != nil {
			log.Printf("logout: hapus sesi gagal: %v", err)
		}
	}
	clearSessionCookie(w, isHTTPS(r))
	writeJSON(w, http.StatusOK, map[string]string{"ok": "1"})
}

// GET /api/auth/me — info user saat ini, atau 401. Dipakai FE untuk gating overlay.
func handleMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := sessionUserID(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "belum login")
		return
	}
	u, err := store.GetUserByID(uid)
	if err != nil || u == nil {
		writeErr(w, http.StatusUnauthorized, "sesi tidak valid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": u.Email, "name": u.DisplayName})
}

// requireUser membungkus handler: tolak 401 bila tak ada sesi valid, jika valid
// suntik userID ke context (dipakai paper engine di fase 2b).
func requireUser(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sessionUserID(r)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "perlu login")
			return
		}
		ctx := context.WithValue(r.Context(), userIDCtxKey, uid)
		h(w, r.WithContext(ctx))
	}
}

// sessionUserID membaca cookie sesi → validasi (termasuk expiry) di store.
func sessionUserID(r *http.Request) (int64, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return 0, false
	}
	uid, ok, err := store.SessionUser(c.Value)
	if err != nil {
		log.Printf("sessionUserID: lookup gagal: %v", err)
		return 0, false
	}
	return uid, ok
}

// startSession membuat token acak, simpan baris sessions, set cookie.
func startSession(w http.ResponseWriter, r *http.Request, uid int64) error {
	token, err := newToken()
	if err != nil {
		return err
	}
	if err := store.CreateSession(token, uid, time.Now().Add(sessionDuration)); err != nil {
		return err
	}
	setSessionCookie(w, token, isHTTPS(r))
	return nil
}

func setSessionCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(sessionDuration),
		MaxAge:   int(sessionDuration.Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// newToken = 32 byte acak → hex (64 char).
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// isHTTPS deteksi koneksi aman (langsung TLS, atau di balik nginx via header).
func isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(v)
}

func validEmail(s string) bool {
	if s == "" || len(s) > 254 || strings.ContainsAny(s, " \t") {
		return false
	}
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Address == s
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimiter = sliding-window sederhana per key (in-memory). Cukup untuk
// memperlambat brute-force; bukan pengganti WAF.
type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: make(map[string][]time.Time), max: max, window: window}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-rl.window)
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.max {
		rl.hits[key] = kept
		return false
	}
	rl.hits[key] = append(kept, time.Now())
	return true
}
