package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestDiagnosticsAuthenticationTruthfulnessAndRedaction(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_FILE", filepath.Join(dir, "PRIVATE_PERSONAL_PATH.json"))
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("private-token-signing-secret-for-diagnostics", "test", time.Hour)
	h := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)), RuntimeOptions{SnapshotInterval: 23 * time.Second})
	if res := performJSON(t, h, "GET", "/api/v1/system/diagnostics", "", nil); res.Code != 401 {
		t.Fatal(res.Code)
	}
	res := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "PRIVATE_NAME_SENTINEL", "email": "private-email@example.test", "password": "private-user-password"})
	var auth struct{ Data struct{ Token string } }
	if res.Code != 201 || json.Unmarshal(res.Body.Bytes(), &auth) != nil {
		t.Fatal(res.Body.String())
	}
	get := func() map[string]any {
		res := performJSON(t, h, "GET", "/api/v1/system/diagnostics", auth.Data.Token, nil)
		var body struct{ Data map[string]any }
		if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &body) != nil || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(res.Code, res.Body.String())
		}
		for _, secret := range []string{dir, "PRIVATE_PERSONAL_PATH", "PRIVATE_NAME_SENTINEL", "private-email", "private-user-password", auth.Data.Token} {
			if strings.Contains(res.Body.String(), secret) {
				t.Fatal("leaked diagnostic", secret)
			}
		}
		return body.Data
	}
	p := get()["persistence"].(map[string]any)
	if p["state"] != "awaiting_first_write" || p["interval_seconds"] != float64(23) || p["response_means_immediate_disk_write"] != false {
		t.Fatal(p)
	}
	if err := repo.SaveJSON(filepath.Join(dir, "snapshot.json")); err != nil {
		t.Fatal(err)
	}
	if p = get()["persistence"].(map[string]any); p["state"] != "recent_write" {
		t.Fatal(p)
	}
	block := filepath.Join(dir, "PRIVATE_BLOCKED_PATH")
	os.WriteFile(block, []byte("blocked"), 0600)
	if err := repo.SaveJSON(filepath.Join(block, "fail.json")); err == nil {
		t.Fatal("expected failed write")
	}
	p = get()["persistence"].(map[string]any)
	if p["state"] != "write_failed" {
		t.Fatal(p)
	}
	b := get()["backup"].(map[string]any)
	if b["json_includes_transfer_files"] != false || b["json_includes_transfer_metadata"] != false || b["restore_verified"] != false {
		t.Fatal(b)
	}
}
