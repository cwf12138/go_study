package httpapi

import (
	"encoding/json"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestProjectsHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("project-integration-test-secret", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Test", "email": email, "password": "safe-password-123"})
		var a struct{ Data struct{ Token string } }
		if e := json.Unmarshal(r.Body.Bytes(), &a); e != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return a.Data.Token
	}
	a, b := register("project-a@example.com"), register("project-b@example.com")
	body := map[string]any{"title": "Private project", "description": "", "color": "#537e78", "cards": []any{}, "revision": 0}
	if r := performJSON(t, h, "PUT", "/api/v1/projects/project-00000001", a, body); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, h, "GET", "/api/v1/projects", b, nil); r.Code != 200 || strings.Contains(r.Body.String(), "Private") {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, h, "GET", "/api/v1/projects", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	body["title"] = "Different"
	if r := performJSON(t, h, "PUT", "/api/v1/projects/project-00000001", a, body); r.Code != 409 {
		t.Fatal(r.Code)
	}
	body["color"] = "javascript:alert(1)"
	if r := performJSON(t, h, "PUT", "/api/v1/projects/project-00000001", a, body); r.Code != 400 {
		t.Fatal(r.Code)
	}
}
