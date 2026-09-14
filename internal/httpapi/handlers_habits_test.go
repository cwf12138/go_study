package httpapi

import (
	"encoding/json"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestHabitHTTP(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		t.Helper()
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Habit user", "email": email, "password": "safe-password-123"})
		var body struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || r.Code != 201 || body.Data.Token == "" {
			t.Fatalf("register: %s", r.Body.String())
		}
		return body.Data.Token
	}
	token := register("habit@example.com")
	other := register("other-habit@example.com")
	r := performJSON(t, handler, "POST", "/api/v1/habits", token, map[string]any{"title": "Read"})
	var body struct{ Data service.HabitView }
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || r.Code != 201 {
		t.Fatalf("create: %s", r.Body.String())
	}
	path := "/api/v1/habits/" + body.Data.ID
	for _, tc := range []struct {
		method, path, token string
		body                any
		want                int
	}{
		{"GET", "/api/v1/habits", "", nil, 401},
		{"PUT", path + "/checkins/" + body.Data.Today, token, map[string]any{}, 400},
		{"PUT", path + "/checkins/" + body.Data.Today, other, map[string]any{"checked": true}, 404},
		{"PUT", path + "/checkins/" + body.Data.Today, token, map[string]any{"checked": true}, 200},
		{"PATCH", path + "/archive", token, map[string]any{}, 400},
		{"PATCH", path + "/archive", token, map[string]any{"archived": true}, 200},
		{"PATCH", path + "/archive", token, map[string]any{"archived": false}, 200},
		{"GET", "/api/v1/habits", token, nil, 200},
	} {
		r := performJSON(t, handler, tc.method, tc.path, tc.token, tc.body)
		if r.Code != tc.want {
			t.Errorf("%s %s: %d want %d: %s", tc.method, tc.path, r.Code, tc.want, r.Body.String())
		}
	}
}
