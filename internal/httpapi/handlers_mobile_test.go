package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestMobileInfoCompatibilityAndDevelopmentKey(t *testing.T) {
	for _, secret := range []string{"development-secret-change-me-please", "private-mobile-test-secret-long-enough"} {
		t.Run(secret[:8], func(t *testing.T) {
			t.Setenv("DATA_FILE", t.TempDir()+"/test.json")
			tokens := security.NewTokenManager(secret, "test", time.Hour)
			bus := event.NewBus()
			h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
			res := httptest.NewRecorder()
			h.ServeHTTP(res, httptest.NewRequest("GET", "/api/v1/mobile-info", nil))
			var body struct {
				Data struct {
					Application    string `json:"application"`
					Protocol       int    `json:"mobile_protocol"`
					RequiresSecret bool   `json:"requires_secure_secret"`
					AILoopback     bool   `json:"ai_requires_loopback"`
				}
			}
			if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &body) != nil || body.Data.Application != "daynest" || body.Data.Protocol != 1 || body.Data.RequiresSecret != tokens.UsesDevelopmentSecret() || !body.Data.AILoopback || res.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(res.Code, res.Body.String())
			}
		})
	}
}
