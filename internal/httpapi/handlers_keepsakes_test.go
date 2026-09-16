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

func TestKeepsakesHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		t.Helper()
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Collector", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	token := register("collector@example.com")
	other := register("othercollector@example.com")
	url := "/api/v1/keepsakes/exhibit-00000000001"
	body := map[string]any{"kind": "exhibit", "title": "Private album", "category": "music", "revision": 0}
	r := performJSON(t, handler, "PUT", url, token, body)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", url, other, body)
	if r.Code != 404 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, handler, "GET", "/api/v1/keepsakes", other, nil)
	if r.Code != 200 || strings.Contains(r.Body.String(), "Private album") {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/keepsakes", "", nil)
	if r.Code != 401 {
		t.Fatal(r.Code)
	}
	body["title"] = "conflicting version"
	r = performJSON(t, handler, "PUT", url, token, body)
	if r.Code != 409 {
		t.Fatal(r.Code)
	}
	body["revision"] = 1
	body["archived"] = true
	r = performJSON(t, handler, "PUT", url, token, body)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
}
