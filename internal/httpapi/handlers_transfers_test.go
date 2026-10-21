package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"github.com/example/studyflow/internal/transfers"
)

func TestTransfersHTTP(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	bus := event.NewBus()
	tokens := security.NewTokenManager("transfer-test-secret-long-enough", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, route := range [][2]string{{"GET", "/api/v1/transfers"}, {"GET", "/api/v1/transfers/info"}, {"GET", "/api/v1/transfers/file-sample/content"}, {"PUT", "/api/v1/transfers/file-sample"}, {"POST", "/api/v1/transfers/file-sample/actions"}, {"DELETE", "/api/v1/transfers/file-sample"}} {
		r := performJSON(t, h, route[0], route[1], "", nil)
		if r.Code != 401 {
			t.Fatal(route, r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Transfer", "email": email, "password": "safe-password-123"})
		var out struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token
	}
	alice, bob := register("ft-alice@example.test"), register("ft-bob@example.test")
	upload := func(body, name, ttl string, size int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest("PUT", "/api/v1/transfers/file-sample", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("X-File-Name", url.PathEscape(name))
		req.Header.Set("X-File-TTL", ttl)
		req.ContentLength = size
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}
	name := "照片 + 测试.html"
	data := "<script>alert(1)</script>"
	for i := 0; i < 2; i++ {
		r := upload(data, name, "24", int64(len(data)))
		if r.Code != 200 || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	if r := upload("different", name, "24", 9); r.Code != 409 {
		t.Fatal("ID overwrite", r.Code)
	}
	r := performJSON(t, h, "GET", "/api/v1/transfers", bob, nil)
	var empty struct{ Data transfers.Listing }
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &empty) != nil || len(empty.Data.Items) != 0 {
		t.Fatal("owner", r.Body.String())
	}
	if r = performJSON(t, h, "GET", "/api/v1/transfers/file-sample/content", bob, nil); r.Code != 404 {
		t.Fatal(r.Code)
	}
	req := httptest.NewRequest("GET", "/api/v1/transfers/file-sample/content", nil)
	req.Header.Set("Authorization", "Bearer "+alice)
	req.Header.Set("Range", "bytes=0-7")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 206 || rr.Body.String() != data[:8] || rr.Header().Get("Content-Type") != "application/octet-stream" || !strings.HasPrefix(rr.Header().Get("Content-Disposition"), "attachment;") || !strings.Contains(rr.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("safe download/range", rr.Code, rr.Header(), rr.Body.String())
	}
	if r = upload("x", "../escape", "24", 1); r.Code != 400 {
		t.Fatal(r.Code)
	}
	if r = upload("x", "file", "12", 1); r.Code != 400 {
		t.Fatal(r.Code)
	}
	if r = upload("x", "file", "24", transfers.MaxFileBytes+1); r.Code != 413 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, h, "DELETE", "/api/v1/transfers/file-sample", alice, nil)
	if r.Code != 400 {
		t.Fatal("must trash first", r.Code)
	}
	for _, action := range []string{"trash", "restore", "extend", "trash"} {
		r = performJSON(t, h, "POST", "/api/v1/transfers/file-sample/actions", alice, map[string]any{"action": action})
		if r.Code != 200 {
			t.Fatal(action, r.Code, r.Body.String())
		}
	}
	r = performJSON(t, h, "GET", "/api/v1/transfers/file-sample/content", alice, nil)
	if r.Code != 410 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, h, "DELETE", "/api/v1/transfers/file-sample", alice, nil)
	if r.Code != 204 {
		t.Fatal(r.Code)
	}
	for _, path := range []string{"/static/transfers.js", "/static/transfers-core.js", "/static/transfers.css"} {
		r = performJSON(t, h, "GET", path, "", nil)
		if r.Code != 200 {
			t.Fatal(path, r.Code)
		}
	}
}

func TestTransferRealHTTPStream(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	bus := event.NewBus()
	tokens := security.NewTokenManager("isolated-transfer-integration-secret", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(h)
	defer server.Close()
	token, err := tokens.Issue("alice", "user")
	if err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte{0, 1, 2, 3, 4, 255}, 350000) // Larger than the JSON API's 1 MiB body limit.
	req, _ := http.NewRequest("PUT", server.URL+"/api/v1/transfers/network-file", bytes.NewReader(content))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-File-Name", url.PathEscape("设备互传.bin"))
	req.Header.Set("X-File-TTL", "24")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded struct{ Data transfers.File }
	err = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || uploaded.Data.Size != int64(len(content)) {
		t.Fatal(response.StatusCode, err)
	}
	// A second HTTP client authenticates independently; no cookies or token-bearing URLs.
	req, _ = http.NewRequest("GET", server.URL+"/api/v1/transfers/network-file/content", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 10 * time.Second}
	response, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	received, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || sha256.Sum256(received) != sha256.Sum256(content) {
		t.Fatal("network content mismatch", response.StatusCode, err)
	}
}

func TestTransferDefaultKeyLocalOnly(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	bus := event.NewBus()
	tokens := security.NewTokenManager("development-secret-change-me-please", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	token, err := tokens.Issue("owner", "user")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		address string
		status  int
	}{{"10.1.2.3:5000", 403}, {"127.0.0.1:5000", 200}, {"[::1]:5000", 200}} {
		req := httptest.NewRequest("GET", "/api/v1/transfers", nil)
		req.RemoteAddr = tc.address
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", "127.0.0.1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != tc.status {
			t.Fatal(tc.address, rr.Code, rr.Body.String())
		}
	}
}
