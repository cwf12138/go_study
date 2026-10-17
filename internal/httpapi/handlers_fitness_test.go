package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestFitnessHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("fitness-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, route := range [][2]string{{"GET", "/api/v1/fitness"}, {"PUT", "/api/v1/fitness/routine-01"}, {"POST", "/api/v1/fitness/sessions/session-01/start"}, {"POST", "/api/v1/fitness/sessions/session-01/actions"}} {
		if r := performJSON(t, handler, route[0], route[1], "", nil); r.Code != 401 {
			t.Fatalf("unauthorized %v: %d", route, r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Fitness", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 || auth.Data.Token == "" {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("fitness-alice@example.com"), register("fitness-bob@example.com")
	read := func(r *httptest.ResponseRecorder, code int) domain.FitnessEntry {
		t.Helper()
		var body struct {
			Data       domain.FitnessEntry `json:"data"`
			ServerTime time.Time           `json:"server_time"`
		}
		if r.Code != code || json.Unmarshal(r.Body.Bytes(), &body) != nil || body.ServerTime.IsZero() {
			t.Fatalf("expected %d, got %d: %s", code, r.Code, r.Body.String())
		}
		return body.Data
	}
	routine := map[string]any{"kind": "routine", "title": "Easy walk", "category": "cardio", "equipment": "none", "revision": 0, "moves": []map[string]any{{"name": "Walk", "mode": "time", "target": 60, "sets": 1, "rest_seconds": 0}}}
	for i := 0; i < 2; i++ {
		row := read(performJSON(t, handler, "PUT", "/api/v1/fitness/routine-01", alice, routine), 200)
		if row.Revision != 1 {
			t.Fatal("save retry changed revision", row.Revision)
		}
	}
	plan := map[string]any{"kind": "plan", "routine_id": "routine-01", "date": "2026-10-18", "state": "scheduled", "revision": 0}
	read(performJSON(t, handler, "PUT", "/api/v1/fitness/fitness-plan-01", alice, plan), 200)
	start := map[string]any{"source_id": "fitness-plan-01"}
	for i := 0; i < 2; i++ {
		row := read(performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-01/start", alice, start), 200)
		if row.Revision != 1 || row.State != "active" {
			t.Fatal("start retry", row)
		}
	}
	if r := performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-02/start", alice, start); r.Code != 409 {
		t.Fatal("second active session", r.Code, r.Body.String())
	}
	if r := performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-01/actions", bob, map[string]any{"action": "pause", "command_id": "command-01", "revision": 1}); r.Code != 404 {
		t.Fatal("owner isolation", r.Code)
	}
	if r := performJSON(t, handler, "GET", "/api/v1/fitness", bob, nil); r.Code != 200 {
		t.Fatal(r.Code)
	} else {
		var body struct{ Data []domain.FitnessEntry }
		if json.Unmarshal(r.Body.Bytes(), &body) != nil || len(body.Data) != 0 {
			t.Fatal("list leaks another owner", r.Body.String())
		}
	}
	complete := map[string]any{"action": "complete_set", "command_id": "command-01", "revision": 1}
	for i := 0; i < 2; i++ {
		row := read(performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-01/actions", alice, complete), 200)
		if row.Revision != 2 || row.Moves[0].Done != 1 || row.Phase != "done" {
			t.Fatal("duplicate set", row)
		}
	}
	if r := performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-01/actions", alice, map[string]any{"action": "stop", "command_id": "command-02", "revision": 1}); r.Code != 409 {
		t.Fatal("stale action", r.Code)
	}
	finish := map[string]any{"action": "finish", "command_id": "command-03", "revision": 2, "effort": 2, "note": "Comfortable"}
	for i := 0; i < 2; i++ {
		r := performJSON(t, handler, "POST", "/api/v1/fitness/sessions/session-01/actions", alice, finish)
		row := read(r, 200)
		var body struct {
			Plan domain.FitnessEntry `json:"related_plan"`
		}
		if json.Unmarshal(r.Body.Bytes(), &body) != nil || row.State != "completed" || row.Revision != 3 || body.Plan.State != "completed" || body.Plan.Revision != 2 {
			t.Fatal("atomic plan completion/retry", r.Body.String())
		}
	}
	// Strict decoding rejects trailing JSON and client-controlled session fields.
	for _, raw := range []string{`{"kind":"routine"} {}`, `{"kind":"session","running_since":"2026-10-18T00:00:00Z"}`} {
		req := httptest.NewRequest("PUT", "/api/v1/fitness/invalid-01", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("Content-Type", "application/json")
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, req)
		if r.Code != 400 {
			t.Fatalf("invalid JSON accepted: %d %s", r.Code, r.Body.String())
		}
	}
	if r := performJSON(t, handler, "PUT", "/api/v1/fitness/invalid-02", alice, map[string]any{"kind": "log", "title": "Run", "date": "2026-10-18", "category": "cardio", "elapsed_seconds": 86401}); r.Code != 400 {
		t.Fatal("unbounded duration", r.Code)
	}
}
