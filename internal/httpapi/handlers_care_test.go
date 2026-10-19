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

func TestCareHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("care-tests-secret-long-enough", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, route := range [][2]string{{"GET", "/api/v1/care-items"}, {"PUT", "/api/v1/care-items/care-item-one"}, {"POST", "/api/v1/care-items/care-item-one/actions"}} {
		if r := performJSON(t, h, route[0], route[1], "", nil); r.Code != 401 {
			t.Fatal("auth", r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Care", "email": email, "password": "safe-password-123"})
		var a struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &a) != nil {
			t.Fatal(r.Body.String())
		}
		return a.Data.Token
	}
	alice, bob := register("care-alice@example.test"), register("care-bob@example.test")
	input := map[string]any{"title": "整理桌面", "category": "home", "interval": 7, "unit": "days", "rhythm": "rolling", "first_due": "2026-10-20", "importance": "normal", "revision": 0}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/care-items/care-item-one", alice, input)
		if r.Code != 200 {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	r := performJSON(t, h, "GET", "/api/v1/care-items", bob, nil)
	var list struct{ Data []domain.CareItem }
	if json.Unmarshal(r.Body.Bytes(), &list) != nil || len(list.Data) != 0 {
		t.Fatal("owner isolation", r.Body.String())
	}
	command := map[string]any{"action": "pause", "command_id": "care-pause-command", "revision": 1}
	if r = performJSON(t, h, "POST", "/api/v1/care-items/care-item-one/actions", bob, command); r.Code != 404 {
		t.Fatal("cross-owner action", r.Code)
	}
	for i := 0; i < 2; i++ {
		r = performJSON(t, h, "POST", "/api/v1/care-items/care-item-one/actions", alice, command)
		var out struct{ Data domain.CareItem }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.State != "paused" || out.Data.Revision != 2 {
			t.Fatal("action/retry", r.Code, r.Body.String())
		}
	}
	command["action"] = "archive"
	command["command_id"] = "care-stale-command"
	if r = performJSON(t, h, "POST", "/api/v1/care-items/care-item-one/actions", alice, command); r.Code != 409 {
		t.Fatal("stale mutation", r.Code)
	}
	for _, raw := range []string{`{"title":"bad","history":[]}`, `{"title":"bad"} {}`} {
		req := httptest.NewRequest("PUT", "/api/v1/care-items/care-item-two", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 400 {
			t.Fatal("strict JSON", rr.Code)
		}
	}
}
