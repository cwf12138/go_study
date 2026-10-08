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

func TestHolidayHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("holiday-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if r := performJSON(t, handler, "GET", "/api/v1/holidays/next", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Holiday test", "email": "holiday@example.com", "password": "safe-password-123"})
	var auth struct{ Data struct{ Token string } }
	if err := json.Unmarshal(r.Body.Bytes(), &auth); err != nil || r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	r = performJSON(t, handler, "GET", "/api/v1/holidays/next", auth.Data.Token, nil)
	var body struct{ Data service.HolidayCountdown }
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if body.Data.Today == "" || body.Data.Timezone != "Asia/Shanghai" || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(r.Body.String())
	}
}
