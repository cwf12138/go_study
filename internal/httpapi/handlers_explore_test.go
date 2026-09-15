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

func TestExploreHTTP(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Explorer", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	token := register("explorer@example.com")
	other := register("otherexplorer@example.com")
	r := performJSON(t, handler, "POST", "/api/v1/explore/letter", token, map[string]any{"id": "letter-test-http-0001", "title": "Future", "body": "SECRET-LETTER", "unlock_at": time.Now().Add(time.Hour)})
	if r.Code != 201 || strings.Contains(r.Body.String(), "SECRET-LETTER") {
		t.Fatal(r.Code, r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/explore", token, nil)
	if r.Code != 200 || strings.Contains(r.Body.String(), "SECRET-LETTER") {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/explore", "", nil)
	if r.Code != 401 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, handler, "GET", "/api/v1/explore", other, nil)
	if r.Code != 200 || strings.Contains(r.Body.String(), "Future") {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", "/api/v1/explore/letter-test-http-0001/completion", other, map[string]any{})
	if r.Code != 404 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, handler, "POST", "/api/v1/explore/challenge", token, map[string]any{"id": "challenge-test-http-0001", "minutes": 15, "budget": 0, "place": "indoor"})
	if r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", "/api/v1/explore/challenge-test-http-0001/completion", token, map[string]any{"reflection": "lovely"})
	if r.Code != 200 || !strings.Contains(r.Body.String(), "lovely") {
		t.Fatal(r.Body.String())
	}
}
