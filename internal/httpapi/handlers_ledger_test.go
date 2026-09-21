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

func TestLedgerHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("ledger-integration-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Ledger", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("ledger-alice@example.com"), register("ledger-bob@example.com")
	body := map[string]any{"kind": "expense", "amount": 1234, "date": "2026-09-22", "category": "餐饮", "account": "现金", "note": "private-lunch", "revision": 0}
	if r := performJSON(t, handler, "PUT", "/api/v1/ledger/entry-00000001", alice, body); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, handler, "GET", "/api/v1/ledger", bob, nil); r.Code != 200 || strings.Contains(r.Body.String(), "private-lunch") {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, handler, "GET", "/api/v1/ledger", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	body["amount"] = 1.5
	if r := performJSON(t, handler, "PUT", "/api/v1/ledger/entry-00000002", alice, body); r.Code != 400 {
		t.Fatal("fractional fen accepted", r.Code)
	}
	body["amount"] = 999
	if r := performJSON(t, handler, "PUT", "/api/v1/ledger/entry-00000001", alice, body); r.Code != 409 {
		t.Fatal("missing revision check", r.Code)
	}
}
