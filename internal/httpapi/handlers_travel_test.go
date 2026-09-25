package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestTravelHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("travel-integration-test-secret", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Test", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	a, b := register("travel-a@example.com"), register("travel-b@example.com")
	path := "/api/v1/travel-plans/travel-00000001"
	body := map[string]any{"title": "Private trip", "destination": "杭州", "start_date": "2026-10-01", "end_date": "2026-10-02", "stops": []any{}, "packing": []any{}, "revision": 0}
	for _, method := range []string{"GET", "PUT"} {
		url := "/api/v1/travel-plans"
		if method == "PUT" {
			url = path
		}
		if r := performJSON(t, h, method, url, "", body); r.Code != 401 {
			t.Fatal(r.Code)
		}
	}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", path, a, body)
		if r.Code != 200 || !strings.Contains(r.Body.String(), `"revision":1`) {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	if r := performJSON(t, h, "GET", "/api/v1/travel-plans", a, nil); r.Code != 200 || !strings.Contains(r.Body.String(), "Private trip") {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, h, "GET", "/api/v1/travel-plans", b, nil); r.Code != 200 || strings.Contains(r.Body.String(), "Private trip") {
		t.Fatal("account leak", r.Body.String())
	}
	body["title"] = "stale update"
	if r := performJSON(t, h, "PUT", path, a, body); r.Code != 409 {
		t.Fatal(r.Code, r.Body.String())
	}
	body["revision"] = 1
	body["archived"] = true
	if r := performJSON(t, h, "PUT", path, a, body); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	body["revision"] = 2
	body["budget_cents"] = -1
	if r := performJSON(t, h, "PUT", path, a, body); r.Code != 400 {
		t.Fatal(r.Code, r.Body.String())
	}
	body["budget_cents"] = 0
	body["unknown_field"] = "blocked"
	if r := performJSON(t, h, "PUT", path, a, body); r.Code != 400 {
		t.Fatal(r.Code, r.Body.String())
	}
}
