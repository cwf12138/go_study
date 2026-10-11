package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestSubscriptionsHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("subscription-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if r := performJSON(t, handler, "GET", "/api/v1/subscriptions", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	authToken := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Subscriptions", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := authToken("sub-alice@example.com"), authToken("sub-bob@example.com")
	body := map[string]any{"name": "Music", "category": "影音", "amount_cents": 1500, "cycle": "monthly", "anchor_date": "2026-10-11", "paid_cycles": 0, "state": "active", "revision": 0}
	r := performJSON(t, handler, "PUT", "/api/v1/subscriptions/subscribe-01", alice, body)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", "/api/v1/subscriptions/subscribe-01", alice, body)
	if r.Code != 200 {
		t.Fatal("retry", r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/subscriptions", bob, nil)
	var empty struct{ Data []any }
	json.Unmarshal(r.Body.Bytes(), &empty)
	if r.Code != 200 || len(empty.Data) != 0 {
		t.Fatal("leak", r.Body.String())
	}
	body["name"] = "Changed"
	r = performJSON(t, handler, "PUT", "/api/v1/subscriptions/subscribe-01", alice, body)
	if r.Code != 409 {
		t.Fatal("conflict", r.Body.String())
	}
	body["revision"] = 1
	body["amount_cents"] = -1
	r = performJSON(t, handler, "PUT", "/api/v1/subscriptions/subscribe-01", alice, body)
	if r.Code != 400 {
		t.Fatal("validation", r.Body.String())
	}
}
