package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// Body non-JSON dari upstream (Cloudflare "error code: 504") dibungkus jadi JSON supaya klien tak
// pernah melihat "Unexpected token 'e' … is not valid JSON".
func TestUpstreamErrorBodyWrappedAsJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeCandleBody(w, 504, []byte("error code: 504"))
	if w.Code != 504 {
		t.Fatalf("status harus tetap 504, dapat %d", w.Code)
	}
	var j map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &j); err != nil {
		t.Fatalf("body harus JSON: %v (%q)", err, w.Body.String())
	}
	if j["errorMessage"] == "" {
		t.Fatalf("errorMessage kosong: %q", w.Body.String())
	}
}

// Body JSON (sukses atau error OANDA berformat {"errorMessage":…}) diteruskan apa adanya.
func TestUpstreamJSONBodyPassthrough(t *testing.T) {
	for _, tc := range []struct {
		code int
		body string
	}{{200, `{"candles":[]}`}, {400, `{"errorMessage":"Invalid value specified for 'instrument'"}`}} {
		w := httptest.NewRecorder()
		writeCandleBody(w, tc.code, []byte(tc.body))
		if w.Code != tc.code || w.Body.String() != tc.body {
			t.Fatalf("passthrough rusak: %d %q", w.Code, w.Body.String())
		}
	}
}
