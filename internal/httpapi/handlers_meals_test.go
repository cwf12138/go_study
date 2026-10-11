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

func TestMealsHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("meal-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, method := range []string{"GET", "PUT", "POST"} {
		path := "/api/v1/meals"
		if method == "PUT" {
			path += "/recipe-01"
		}
		if method == "POST" {
			path += "/shopping"
		}
		if r := performJSON(t, handler, method, path, "", nil); r.Code != 401 {
			t.Fatal("unauthorized", r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Kitchen", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("meal-alice@example.com"), register("meal-bob@example.com")
	body := map[string]any{"kind": "recipe", "title": "炒蛋", "minutes": 10, "servings": 1, "ingredients": []map[string]string{{"name": "鸡蛋", "quantity": "2个"}}, "steps": []string{"炒至熟透。"}, "revision": 0}
	for i := 0; i < 2; i++ {
		if r := performJSON(t, handler, "PUT", "/api/v1/meals/recipe-01", alice, body); r.Code != 200 {
			t.Fatal("save/retry", r.Body.String())
		}
	}
	if r := performJSON(t, handler, "GET", "/api/v1/meals", bob, nil); r.Code != 200 || r.Body.String() != "{\"data\":[]}\n" {
		t.Fatal("isolation", r.Body.String())
	}
	request := map[string]any{"ids": []string{"recipe-01"}, "have": []string{}}
	if r := performJSON(t, handler, "POST", "/api/v1/meals/shopping", bob, request); r.Code != 404 {
		t.Fatal("cross-account shopping", r.Code)
	}
	if r := performJSON(t, handler, "POST", "/api/v1/meals/shopping", alice, request); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	var result struct {
		Data struct {
			Added    int
			Existing int
		}
	}
	r := performJSON(t, handler, "POST", "/api/v1/meals/shopping", alice, request)
	if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil || result.Data.Added != 0 || result.Data.Existing != 1 {
		t.Fatal("retry", r.Body.String())
	}
	body["title"] = "不同内容"
	if r := performJSON(t, handler, "PUT", "/api/v1/meals/recipe-01", alice, body); r.Code != 409 {
		t.Fatal("conflict", r.Code)
	}
}
