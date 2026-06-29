// Login Google via OAuth 2.0 Authorization Code flow (Fase 2a-ii) — server-side,
// tanpa library berat (cukup net/http + encoding/json). Client Secret tak pernah
// menyentuh browser; token Google hanya dipakai sekejap di callback untuk ambil
// profil, lalu kita terbitkan sesi sendiri (sama seperti email+password).
//
// Aktif hanya bila GOOGLE_CLIENT_ID/SECRET/REDIRECT_URL terisi; jika kosong,
// endpoint balas 503 dan FE menyembunyikan tombolnya — email+password tetap jalan.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	oauthStateCookie = "luna_oauth_state"
	googleAuthURL    = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL   = "https://oauth2.googleapis.com/token"
	googleUserURL    = "https://www.googleapis.com/oauth2/v3/userinfo"
)

func registerGoogleOAuth(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/google", handleGoogleStart)
	mux.HandleFunc("GET /api/auth/google/callback", handleGoogleCallback)
}

// GET /api/auth/google → set cookie state (anti-CSRF) lalu redirect ke Google.
func handleGoogleStart(w http.ResponseWriter, r *http.Request) {
	if !cfg.GoogleEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "login Google belum dikonfigurasi")
		return
	}
	state, err := newToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "gagal membuat state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600, // 10 menit cukup utk consent
	})
	p := url.Values{}
	p.Set("client_id", cfg.GoogleClientID)
	p.Set("redirect_uri", cfg.GoogleRedirectURL)
	p.Set("response_type", "code")
	p.Set("scope", "openid email profile")
	p.Set("state", state)
	p.Set("access_type", "online")
	p.Set("prompt", "select_account")
	http.Redirect(w, r, googleAuthURL+"?"+p.Encode(), http.StatusFound)
}

// GET /api/auth/google/callback?code=&state= — verifikasi state, tukar code→token,
// ambil profil, find-or-create user, mulai sesi, redirect ke /.
func handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !cfg.GoogleEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "login Google belum dikonfigurasi")
		return
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		redirectAuthError(w, r, "login Google dibatalkan")
		return
	}
	// Verifikasi state vs cookie (anti-CSRF), lalu hapus cookie state.
	c, err := r.Cookie(oauthStateCookie)
	state := q.Get("state")
	clearStateCookie(w, r)
	if err != nil || c.Value == "" || state == "" ||
		subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		redirectAuthError(w, r, "state OAuth tidak cocok — coba lagi")
		return
	}
	code := q.Get("code")
	if code == "" {
		redirectAuthError(w, r, "code OAuth kosong")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	token, err := googleExchangeCode(ctx, code)
	if err != nil {
		log.Printf("google oauth: tukar code gagal: %v", err)
		redirectAuthError(w, r, "gagal tukar token Google")
		return
	}
	info, err := googleUserInfo(ctx, token)
	if err != nil {
		log.Printf("google oauth: ambil profil gagal: %v", err)
		redirectAuthError(w, r, "gagal ambil profil Google")
		return
	}
	if info.Sub == "" || info.Email == "" {
		redirectAuthError(w, r, "profil Google tidak lengkap")
		return
	}
	name := strings.TrimSpace(info.Name)
	if name == "" {
		name = info.Email
	}
	uid, err := store.UpsertGoogleUser(info.Sub, strings.ToLower(info.Email), name, info.Picture, paperInitBalance)
	if err != nil {
		log.Printf("google oauth: upsert user gagal: %v", err)
		redirectAuthError(w, r, "gagal membuat akun")
		return
	}
	if err := startSession(w, r, uid); err != nil {
		log.Printf("google oauth: start session gagal: %v", err)
		redirectAuthError(w, r, "gagal membuat sesi")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func clearStateCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// redirectAuthError balik ke shell dengan pesan; FE menampilkannya di overlay.
func redirectAuthError(w http.ResponseWriter, r *http.Request, msg string) {
	http.Redirect(w, r, "/?auth_error="+url.QueryEscape(msg), http.StatusFound)
}

// googleExchangeCode menukar authorization code → access token.
func googleExchangeCode(ctx context.Context, code string) (string, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", cfg.GoogleClientID)
	form.Set("client_secret", cfg.GoogleClientSecret)
	form.Set("redirect_uri", cfg.GoogleRedirectURL)
	form.Set("grant_type", "authorization_code")

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint status %d: %s", resp.StatusCode, body)
	}
	var t struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &t); err != nil {
		return "", err
	}
	if t.AccessToken == "" {
		return "", fmt.Errorf("access_token kosong")
	}
	return t.AccessToken, nil
}

type googleProfile struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// googleUserInfo mengambil profil (sub/email/name) memakai access token.
func googleUserInfo(ctx context.Context, accessToken string) (*googleProfile, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, googleUserURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo status %d: %s", resp.StatusCode, body)
	}
	var p googleProfile
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	return &p, nil
}
