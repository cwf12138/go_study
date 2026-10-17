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

func TestNutritionHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("nutrition-test-secret-long-enough", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, method := range []string{"GET", "PUT"} {
		path := "/api/v1/fitness/nutrition"
		if method == "PUT" {
			path += "/nutrition-preferences"
		}
		if r := performJSON(t, h, method, path, "", nil); r.Code != 401 {
			t.Fatal("auth", r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Nutrition", "email": email, "password": "safe-password-123"})
		var out struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token
	}
	alice, bob := register("nutrition-alice@example.test"), register("nutrition-bob@example.test")
	body := map[string]any{"kind": "favorite", "card_id": "rice-chicken", "revision": 0}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/fitness/nutrition/nutrition-favorite-rice-chicken", alice, body)
		var out struct{ Data domain.NutritionEntry }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Revision != 1 || out.Data.Card == nil {
			t.Fatal("save/retry", r.Code, r.Body.String())
		}
	}
	for _, user := range []string{alice, bob} {
		r := performJSON(t, h, "GET", "/api/v1/fitness/nutrition", user, nil)
		var out struct {
			Data struct {
				Catalog []domain.NutritionCard
				Entries []domain.NutritionEntry
			}
		}
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || len(out.Data.Catalog) != 24 {
			t.Fatal(r.Body.String())
		}
		if user == bob && len(out.Data.Entries) != 0 {
			t.Fatal("list isolation")
		}
		for _, c := range out.Data.Catalog {
			if c.Allergens == nil {
				t.Fatal("nil catalogue arrays", c.ID)
			}
		}
	}
	body["deleted"] = true
	if r := performJSON(t, h, "PUT", "/api/v1/fitness/nutrition/nutrition-favorite-rice-chicken", alice, body); r.Code != 409 {
		t.Fatal("conflict", r.Code)
	}
	for _, raw := range []string{`{"kind":"favorite","card_id":"rice-chicken","card":{"title":"untrusted"}}`, `{"kind":"favorite"} {}`} {
		req := httptest.NewRequest("PUT", "/api/v1/fitness/nutrition/nutrition-invalid", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("Content-Type", "application/json")
		r := httptest.NewRecorder()
		h.ServeHTTP(r, req)
		if r.Code != 400 {
			t.Fatal("strict decoding", r.Code)
		}
	}
}
