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

func TestShoppingHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("shopping-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Shopping", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("shopping-a@example.com"), register("shopping-b@example.com")
	body := map[string]any{"name": "milk", "quantity": "2盒", "revision": 0}
	for i := 0; i < 2; i++ {
		if r := performJSON(t, handler, "PUT", "/api/v1/shopping/item-00001", alice, body); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	if r := performJSON(t, handler, "PUT", "/api/v1/shopping/item-00002", alice, body); r.Code != 409 {
		t.Fatal("duplicate", r.Code)
	}
	if r := performJSON(t, handler, "GET", "/api/v1/shopping", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	for _, tc := range []struct {
		token string
		count int
	}{{alice, 1}, {bob, 0}} {
		r := performJSON(t, handler, "GET", "/api/v1/exports/data", tc.token, nil)
		var bundle service.UserDataExport
		if err := json.Unmarshal(r.Body.Bytes(), &bundle); err != nil || r.Code != 200 || len(bundle.Shopping) != tc.count || bundle.Counts["shopping"] != tc.count {
			t.Fatal(r.Body.String())
		}
	}
	body["name"] = ""
	if r := performJSON(t, handler, "PUT", "/api/v1/shopping/item-00002", alice, body); r.Code != 400 {
		t.Fatal(r.Code)
	}
}
