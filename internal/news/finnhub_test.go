package news

import "testing"

func TestNormalizeFinnhub(t *testing.T) {
	body := []byte(`[
		{"category":"general","datetime":1752310800,"headline":"Gold slips as dollar firms","id":1,"source":"Reuters","summary":"s","url":"https://r.com/a"},
		{"category":"forex","datetime":1752314400,"headline":"","id":2,"source":"X","summary":"","url":"https://r.com/b"},
		{"category":"forex","datetime":1752314400,"headline":"No URL","id":3,"source":"X","summary":"","url":""}
	]`)
	hs, err := NormalizeFinnhub(body)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// item ke-2 (headline kosong) & ke-3 (url kosong) di-skip → sisa 1
	if len(hs) != 1 {
		t.Fatalf("want 1 valid headline, got %d", len(hs))
	}
	h := hs[0]
	if h.Title != "Gold slips as dollar firms" || h.Source != "Reuters" || h.Via != "finnhub" {
		t.Fatalf("bad normalize: %+v", h)
	}
	if h.ID == "" || h.PublishedAt.IsZero() {
		t.Fatalf("ID & PublishedAt must be set: %+v", h)
	}
}

func TestNormalizeFinnhubBadJSON(t *testing.T) {
	if _, err := NormalizeFinnhub([]byte("{not json")); err == nil {
		t.Fatal("want error on invalid JSON")
	}
}

func TestFinnhubEnabled(t *testing.T) {
	if (Finnhub{Token: ""}).Enabled() {
		t.Fatal("empty token → disabled")
	}
	if !(Finnhub{Token: "x"}).Enabled() {
		t.Fatal("non-empty token → enabled")
	}
	if (Finnhub{Token: "x"}).Name() != "finnhub" {
		t.Fatal("name should be finnhub")
	}
}
