package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/ehxor/unloyalty/server/internal/config"
	"github.com/ehxor/unloyalty/server/internal/store"
)

type harness struct {
	t   *testing.T
	srv *httptest.Server
	st  *store.Store
}

func newHarness(t *testing.T, cfg config.Config) *harness {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "wallet.db"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = 24 * time.Hour
	}
	web := fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>app</title>")},
		"sw.js":                {Data: []byte("self.x=1")},
		"manifest.webmanifest": {Data: []byte("{}")},
		"assets/index-abc.js":  {Data: []byte("console.log(1)")},
	}
	srv := httptest.NewServer(New(Options{Store: st, Config: cfg, Version: "test", Web: web, Logger: discardLogger()}).Handler())
	t.Cleanup(func() {
		srv.Close()
		st.Close()
	})
	return &harness{t: t, srv: srv, st: st}
}

type response struct {
	status int
	header http.Header
	body   []byte
}

func (r response) json(v any) {
	if err := json.Unmarshal(r.body, v); err != nil {
		panic(err)
	}
}

func (r response) errorCode() string {
	var e errorBody
	_ = json.Unmarshal(r.body, &e)
	return e.Error.Code
}

func (h *harness) do(method, path, token string, body any) response {
	h.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		reader = bytes.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return response{status: res.StatusCode, header: res.Header, body: data}
}

func (h *harness) register(username string) (string, response) {
	h.t.Helper()
	res := h.do("POST", "/api/auth/register", "", credentials{Username: username, Password: "correct horse"})
	var s sessionResponse
	if res.status == http.StatusCreated {
		res.json(&s)
	}
	return s.Token, res
}

func wireCard(id, name, updatedAt string) store.Card {
	return store.Card{ID: id, Name: name, Format: "code128", Value: "ABC-1", SortOrder: 1,
		CreatedAt: "2026-01-01T00:00:00.000Z", UpdatedAt: updatedAt}
}

const cardID = "01900000-0000-7000-8000-0000000000aa"

func TestRegistrationBootstrap(t *testing.T) {
	h := newHarness(t, config.Config{})
	var cfg map[string]any
	h.do("GET", "/api/config", "", nil).json(&cfg)
	if cfg["registrationOpen"] != true {
		t.Fatalf("fresh server should accept the first registration: %v", cfg)
	}
	if _, res := h.register("Alice"); res.status != http.StatusCreated {
		t.Fatalf("first user: %d %s", res.status, res.body)
	}
	if _, res := h.register("bob"); res.status != http.StatusForbidden || res.errorCode() != codeRegistrationClosed {
		t.Fatalf("second user without ALLOW_REGISTRATION: %d %s", res.status, res.body)
	}
	h.do("GET", "/api/config", "", nil).json(&cfg)
	if cfg["registrationOpen"] != false {
		t.Fatalf("registration should now be closed: %v", cfg)
	}
}

func TestRegistrationOpenAndValidation(t *testing.T) {
	h := newHarness(t, config.Config{AllowRegistration: true})
	if _, res := h.register("alice"); res.status != http.StatusCreated {
		t.Fatal(res.status)
	}
	if _, res := h.register("ALICE"); res.status != http.StatusConflict || res.errorCode() != codeUsernameTaken {
		t.Fatalf("duplicate: %d %s", res.status, res.body)
	}
	res := h.do("POST", "/api/auth/register", "", credentials{Username: "bob", Password: "short"})
	if res.status != http.StatusBadRequest {
		t.Fatalf("short password: %d", res.status)
	}
}

func TestLoginLogoutAndMe(t *testing.T) {
	h := newHarness(t, config.Config{})
	if _, res := h.register("alice"); res.status != http.StatusCreated {
		t.Fatal(res.status)
	}
	if res := h.do("POST", "/api/auth/login", "", credentials{Username: "alice", Password: "wrong password"}); res.status != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", res.status)
	}
	res := h.do("POST", "/api/auth/login", "", credentials{Username: " Alice ", Password: "correct horse"})
	if res.status != http.StatusOK {
		t.Fatalf("login: %d %s", res.status, res.body)
	}
	var s sessionResponse
	res.json(&s)

	var me struct{ User store.User }
	h.do("GET", "/api/me", s.Token, nil).json(&me)
	if me.User.Username != "alice" {
		t.Fatalf("me: %+v", me)
	}
	if res := h.do("POST", "/api/auth/logout", s.Token, nil); res.status != http.StatusNoContent {
		t.Fatalf("logout: %d", res.status)
	}
	if res := h.do("GET", "/api/me", s.Token, nil); res.status != http.StatusUnauthorized || res.errorCode() != codeUnauthorized {
		t.Fatalf("token after logout: %d %s", res.status, res.body)
	}
}

func TestLoginRateLimit(t *testing.T) {
	h := newHarness(t, config.Config{})
	bad := credentials{Username: "nobody", Password: "whatever1"}
	for i := range 5 {
		if res := h.do("POST", "/api/auth/login", "", bad); res.status != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i+1, res.status)
		}
	}
	res := h.do("POST", "/api/auth/login", "", bad)
	if res.status != http.StatusTooManyRequests || res.errorCode() != codeRateLimited || res.header.Get("Retry-After") == "" {
		t.Fatalf("6th attempt: %d %s", res.status, res.body)
	}
}

func TestSyncRoundTripAndCursorReset(t *testing.T) {
	h := newHarness(t, config.Config{})
	token, _ := h.register("alice")
	if res := h.do("POST", "/api/sync", "", syncRequest{}); res.status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated sync: %d", res.status)
	}

	res := h.do("POST", "/api/sync", token, syncRequest{Changes: []store.Card{wireCard(cardID, "Shop", "2026-01-01T10:00:00.000Z")}})
	if res.status != http.StatusOK {
		t.Fatalf("sync: %d %s", res.status, res.body)
	}
	var out syncResponse
	res.json(&out)
	if out.DBID != h.st.DBID() || out.Cursor != 1 || len(out.Changes) != 1 {
		t.Fatalf("sync response: %+v", out)
	}

	// The exact JSON shape the web client parses.
	var raw map[string]any
	res.json(&raw)
	got := raw["changes"].([]any)[0].(map[string]any)
	for _, key := range []string{"color", "notes", "lastUsedAt"} {
		if _, present := got[key]; present {
			t.Errorf("absent optional %q should be omitted, got %v", key, got[key])
		}
	}
	if got["deleted"] != false || got["sortOrder"] != 1.0 {
		t.Errorf("card JSON: %v", got)
	}

	for name, req := range map[string]syncRequest{
		"other database": {DBID: "0123456789abcdef0123456789abcdef", Cursor: 1},
		"cursor ahead":   {Cursor: 99},
	} {
		if res := h.do("POST", "/api/sync", token, req); res.status != http.StatusConflict || res.errorCode() != codeCursorReset {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
	}
}

func TestSyncRejectsInvalidCards(t *testing.T) {
	h := newHarness(t, config.Config{})
	token, _ := h.register("alice")
	valid := wireCard(cardID, "Shop", "2026-01-01T10:00:00.000Z")
	for name, mutate := range map[string]func(*store.Card){
		"bad id":         func(c *store.Card) { c.ID = "not-a-uuid" },
		"unknown format": func(c *store.Card) { c.Format = "maxicode" },
		"empty name":     func(c *store.Card) { c.Name = "" },
		"padded name":    func(c *store.Card) { c.Name = " Shop" },
		"long name":      func(c *store.Card) { c.Name = strings.Repeat("x", 101) },
		"bad timestamp":  func(c *store.Card) { c.UpdatedAt = "2026-01-01T10:00:00Z" },
		"bad color":      func(c *store.Card) { c.Color = new("red") },
	} {
		c := valid
		mutate(&c)
		if res := h.do("POST", "/api/sync", token, syncRequest{Changes: []store.Card{c}}); res.status != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
	}
	unknownField := []byte(`{"cursor":0,"changes":[],"extra":1}`)
	if res := h.do("POST", "/api/sync", token, unknownField); res.status != http.StatusBadRequest {
		t.Errorf("unknown field: %d", res.status)
	}
	huge := []byte(`{"cursor":0,"changes":[],"x":"` + strings.Repeat("a", maxBodyBytes) + `"}`)
	if res := h.do("POST", "/api/sync", token, huge); res.status != http.StatusRequestEntityTooLarge || res.errorCode() != codePayloadTooLarge {
		t.Errorf("oversized body: %d %s", res.status, res.body)
	}
}

func TestUsersCannotSeeEachOthersCards(t *testing.T) {
	h := newHarness(t, config.Config{AllowRegistration: true})
	alice, _ := h.register("alice")
	bob, _ := h.register("bob")
	h.do("POST", "/api/sync", alice, syncRequest{Changes: []store.Card{wireCard(cardID, "Alice's", "2026-01-01T10:00:00.000Z")}})

	var out syncResponse
	h.do("POST", "/api/sync", bob, syncRequest{}).json(&out)
	if len(out.Changes) != 0 {
		t.Fatalf("bob pulled alice's cards: %+v", out.Changes)
	}
	// Same id from Bob, newer: lands in Bob's wallet only.
	h.do("POST", "/api/sync", bob, syncRequest{Changes: []store.Card{wireCard(cardID, "Bob's", "2027-01-01T10:00:00.000Z")}})
	var export struct{ Cards []store.Card }
	h.do("GET", "/api/export", alice, nil).json(&export)
	if len(export.Cards) != 1 || export.Cards[0].Name != "Alice's" {
		t.Fatalf("alice's export: %+v", export.Cards)
	}
}

func TestStaticServingAndHeaders(t *testing.T) {
	h := newHarness(t, config.Config{})
	cases := []struct {
		path, wantType, wantCache string
		wantStatus                int
	}{
		{"/", "text/html", "no-cache", 200},
		{"/card/0190-abc/edit", "text/html", "no-cache", 200}, // client-side route
		{"/sw.js", "text/javascript", "no-cache", 200},
		{"/manifest.webmanifest", "application/manifest+json", "no-cache", 200},
		{"/assets/index-abc.js", "text/javascript", "immutable", 200},
		{"/assets/missing.js", "", "", 404},
		{"/missing.png", "", "", 404},
	}
	for _, c := range cases {
		res := h.do("GET", c.path, "", nil)
		if res.status != c.wantStatus {
			t.Errorf("%s: status %d", c.path, res.status)
			continue
		}
		if !strings.HasPrefix(res.header.Get("Content-Type"), c.wantType) || !strings.Contains(res.header.Get("Cache-Control"), c.wantCache) {
			t.Errorf("%s: type %q cache %q", c.path, res.header.Get("Content-Type"), res.header.Get("Cache-Control"))
		}
	}

	res := h.do("GET", "/api/nope", "", nil)
	if res.status != 404 || res.errorCode() != codeNotFound {
		t.Errorf("unknown API path: %d %s", res.status, res.body)
	}
	for _, header := range []string{"Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"} {
		if res.header.Get(header) == "" {
			t.Errorf("missing %s", header)
		}
	}
	if res.header.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS sent without a trusted proxy reporting HTTPS")
	}
}

func TestHSTSOnlyBehindTrustedHTTPSProxy(t *testing.T) {
	h := newHarness(t, config.Config{TrustProxyHeaders: true})
	req, _ := http.NewRequest("GET", h.srv.URL+"/api/health", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.Header.Get("Strict-Transport-Security") == "" {
		t.Error("expected HSTS behind a trusted HTTPS proxy")
	}
}
