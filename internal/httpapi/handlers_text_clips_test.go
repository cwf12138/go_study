package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestTextClipsHTTPPersistenceAndIsolation(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("text-clip-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repo, tokens, bus)
	h := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if r := performJSON(t, h, "GET", "/api/v1/text-clips", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	register := func(email string) (string, string) {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Clips", "email": email, "password": "test-password-123"})
		var out struct {
			Data struct {
				Token string
				User  domain.User
			}
		}
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token, out.Data.User.ID
	}
	alice, user := register("clip-alice@example.test")
	bob, _ := register("clip-bob@example.test")
	for _, input := range []map[string]any{{"text": "missing expiry", "revision": 0}, {"text": "missing revision", "ttl_hours": 24}, {"text": "null expiry", "ttl_hours": nil, "revision": 0}} {
		if r := performJSON(t, h, "PUT", "/api/v1/text-clips/clip-missing", alice, input); r.Code != 400 {
			t.Fatal("required fields", r.Code, r.Body.String())
		}
	}
	in := map[string]any{"title": "收件地址", "text": "第一行\n第二行 <script>", "ttl_hours": 24, "pinned": true, "deleted": false, "revision": 0}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/text-clips/clip-persistent", alice, in)
		var out struct{ Data domain.TextClip }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Revision != 1 {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	r := performJSON(t, h, "GET", "/api/v1/text-clips", alice, nil)
	var list struct {
		Data       []domain.TextClip
		ServerTime time.Time `json:"server_time"`
	}
	if json.Unmarshal(r.Body.Bytes(), &list) != nil || len(list.Data) != 1 || list.ServerTime.IsZero() || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(r.Body.String(), r.Header())
	}
	if r := performJSON(t, h, "GET", "/api/v1/text-clips", bob, nil); json.Unmarshal(r.Body.Bytes(), &list) != nil || len(list.Data) != 0 {
		t.Fatal("isolation", r.Body.String())
	}
	if r := performJSON(t, h, "DELETE", "/api/v1/text-clips/clip-persistent?revision=1", bob, nil); r.Code != 404 {
		t.Fatal(r.Code)
	}
	in["revision"] = 1
	in["deleted"] = true
	if r := performJSON(t, h, "PUT", "/api/v1/text-clips/clip-persistent", alice, in); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	file := filepath.Join(t.TempDir(), "snapshot.json")
	if err := repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err := restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	rows, err := restored.ListTextClips(context.Background(), user)
	if err != nil || len(rows) != 1 || !rows[0].Deleted || rows[0].Revision != 2 {
		t.Fatal(rows, err)
	}
	bundle, err := svc.ExportUserData(context.Background(), user)
	if err != nil || len(bundle.TextClips) != 1 || bundle.Counts["text_clips"] != 1 {
		t.Fatal("export", err)
	}
	if r := performJSON(t, h, "DELETE", "/api/v1/text-clips/clip-persistent?revision=1", alice, nil); r.Code != 409 {
		t.Fatal(r.Code)
	}
	if r := performJSON(t, h, "DELETE", "/api/v1/text-clips/clip-persistent?revision=2", alice, nil); r.Code != 204 {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := performJSON(t, h, "DELETE", "/api/v1/text-clips/clip-persistent?revision=2", alice, nil); r.Code != 404 {
		t.Fatal(r.Code)
	}
	for _, name := range []string{"text-clips.js", "text-clips-core.js", "text-clips.css"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", "/static/"+name, nil))
		if r.Code != 200 {
			t.Fatal(name, r.Code)
		}
	}
}
