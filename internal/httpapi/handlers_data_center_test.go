package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"github.com/example/studyflow/internal/transfers"
)

func TestDataCenterAccountScopePartialFailuresAndIntegrity(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_FILE", filepath.Join(dir, "PRIVATE_PATH.json"))
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("data-center-isolated-test-secret", "test", time.Hour)
	h := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, route := range [][2]string{{"GET", "/api/v1/data-center"}, {"POST", "/api/v1/data-center/transfers/check"}} {
		if res := performJSON(t, h, route[0], route[1], "", nil); res.Code != 401 {
			t.Fatal(res.Code)
		}
	}
	register := func(email string) (string, string) {
		res := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]string{"name": "Private Name", "email": email, "password": "test-password-only"})
		var out struct {
			Data struct {
				Token string
				User  domain.User
			}
		}
		if res.Code != 201 || json.Unmarshal(res.Body.Bytes(), &out) != nil {
			t.Fatal("registration failed")
		}
		return out.Data.Token, out.Data.User.ID
	}
	alice, uid := register("alice@example.test")
	bob, bobID := register("bob@example.test")
	repo.CreateMemoNote(context.Background(), domain.MemoNote{ID: "my-memo", UserID: uid, Content: "PRIVATE_MEMO_SENTINEL"})
	repo.CreateMemoNote(context.Background(), domain.MemoNote{ID: "bob-memo", UserID: bobID, Content: "BOB_MEMO_SENTINEL"})
	x := transfers.New(filepath.Join(dir, "transfers"))
	x.Upload(context.Background(), uid, "test-file-one", "my file.txt", 0, strings.NewReader("original"), 8)
	x.Upload(context.Background(), bobID, "test-file-bob", "BOB_FILENAME.txt", 0, strings.NewReader("bob"), 3)
	get := func(token string) (dataRecords, dataAttachments) {
		res := performJSON(t, h, "GET", "/api/v1/data-center", token, nil)
		var out struct {
			Data struct {
				Records     dataRecords
				Attachments dataAttachments
			}
		}
		if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &out) != nil || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("overview failed", res.Code)
		}
		for _, private := range []string{dir, "PRIVATE_PATH", "PRIVATE_MEMO_SENTINEL", "BOB_MEMO_SENTINEL", "BOB_FILENAME", uid, bobID, token} {
			if strings.Contains(res.Body.String(), private) {
				t.Fatal("overview disclosed private fields")
			}
		}
		return out.Data.Records, out.Data.Attachments
	}
	r, a := get(alice)
	if r.State != "available" || r.Objects != 1 || a.State != "available" || a.Files != 1 || a.AccountedBytes != 8 {
		t.Fatal(r, a)
	}
	r, a = get(bob)
	if r.Objects != 1 || a.Files != 1 || a.AccountedBytes != 3 {
		t.Fatal(r, a)
	}
	sum := sha256.Sum256([]byte(uid))
	blob := filepath.Join(dir, "transfers", hex.EncodeToString(sum[:]), "test-file-one.blob")
	if err := os.WriteFile(blob, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	res := performJSON(t, h, "POST", "/api/v1/data-center/transfers/check", alice, nil)
	var report struct{ Data transfers.IntegrityReport }
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &report) != nil || report.Data.Mismatched != 1 || report.Data.Verified != 0 || report.Data.BackupRestoreVerified {
		t.Fatal("hash mismatch not reported", res.Code)
	}
	if strings.Contains(res.Body.String(), dir) || strings.Contains(res.Body.String(), "BOB_FILENAME") {
		t.Fatal("integrity disclosed foreign path/file")
	}
	meta := strings.TrimSuffix(blob, ".blob") + ".json"
	if err := os.WriteFile(meta, []byte("bad metadata"), 0o600); err != nil {
		t.Fatal(err)
	}
	r, a = get(alice)
	if r.State != "available" || a.State != "unavailable" {
		t.Fatal("partial error reported as healthy", r, a)
	}
	res = performJSON(t, h, "POST", "/api/v1/data-center/transfers/check", alice, nil)
	if res.Code != 500 || strings.Contains(res.Body.String(), dir) || strings.Contains(res.Body.String(), "bad metadata") {
		t.Fatal("raw error disclosed", res.Code)
	}
}

func TestDataCenterRespectsDevelopmentKeyLANBoundary(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	repo := store.NewMemory()
	repo.CreateUser(context.Background(), domain.User{ID: "user", Email: "user@example.test"})
	tokens := security.NewTokenManager("development-secret-change-me-please", "test", time.Hour)
	token, err := tokens.Issue("user", "user")
	if err != nil {
		t.Fatal(err)
	}
	bus := event.NewBus()
	h := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, method := range []string{"GET", "POST"} {
		path := "/api/v1/data-center"
		want := 200
		if method == "POST" {
			path += "/transfers/check"
			want = 403
		}
		req := httptest.NewRequest(method, path, nil)
		req.RemoteAddr = "192.168.1.8:1234"
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatal(res.Code)
		}
		if method == "GET" && !strings.Contains(res.Body.String(), `"state":"local_only"`) {
			t.Fatal("LAN boundary not reflected")
		}
	}
}
