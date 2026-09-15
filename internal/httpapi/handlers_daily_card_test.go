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

func TestDailyCardHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Daily reader", "email": "daily@example.com", "password": "safe-password-123"})
	var auth struct{ Data struct{ Token string } }
	if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/daily-card", "", nil)
	if r.Code != 401 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, handler, "GET", "/api/v1/daily-card", auth.Data.Token, nil)
	var body struct{ Data struct{ Date string } }
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	path := "/api/v1/daily-card/" + body.Data.Date
	r = performJSON(t, handler, "POST", "/api/v1/daily-card/draw", auth.Data.Token, nil)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", path, auth.Data.Token, map[string]any{})
	if r.Code != 400 {
		t.Fatal(r.Code)
	}
	r = performJSON(t, handler, "PUT", path, auth.Data.Token, map[string]any{"favorite": true, "reflection": "private-daily-reflection"})
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "PUT", path, auth.Data.Token, map[string]any{"favorite": false})
	if r.Code != 200 || !strings.Contains(r.Body.String(), "private-daily-reflection") {
		t.Fatal(r.Body.String())
	}
}
