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

func TestInventoryHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("inventory-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "user", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("inventory-alice@example.com"), register("inventory-bob@example.com")
	body := map[string]any{"name": "private-headphones", "category": "设备", "quantity": 1, "price": 1234, "revision": 0}
	if r := performJSON(t, handler, "PUT", "/api/v1/inventory/item-000001", alice, body); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, handler, "GET", "/api/v1/inventory", bob, nil); r.Code != 200 || strings.Contains(r.Body.String(), "private-headphones") {
		t.Fatal(r.Body.String())
	}
	if r := performJSON(t, handler, "GET", "/api/v1/inventory", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	for _, tc := range []struct {
		token string
		count int
	}{{alice, 1}, {bob, 0}} {
		r := performJSON(t, handler, "GET", "/api/v1/exports/data", tc.token, nil)
		var bundle service.UserDataExport
		if err := json.Unmarshal(r.Body.Bytes(), &bundle); err != nil || r.Code != 200 || len(bundle.Inventory) != tc.count || bundle.Counts["inventory"] != tc.count {
			t.Fatalf("export inventory: %s", r.Body.String())
		}
	}
	body["price"] = 1.5
	if r := performJSON(t, handler, "PUT", "/api/v1/inventory/item-000001", alice, body); r.Code != 400 {
		t.Fatal("fractional fen accepted", r.Code)
	}
	body["price"] = 3000
	if r := performJSON(t, handler, "PUT", "/api/v1/inventory/item-000001", alice, body); r.Code != 409 {
		t.Fatal("missing conflict", r.Code)
	}
}
