package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestOfflineReaderPublicShellDoesNotExposeBusinessData(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("offline-fixture-long-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, test := range []struct{ path, kind, marker string }{{"/offline/", "text/html", "本机快照"}, {"/offline/sw.js", "text/javascript", "daynest-read-shell-"}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Content-Type"), test.kind) || !strings.Contains(response.Body.String(), test.marker) {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
		if !strings.Contains(response.Header().Get("Cache-Control"), "must-revalidate") || response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("missing shell headers: %v", response.Header())
		}
	}
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/v1/memos", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("offline routes bypassed auth: %d", unauthorized.Code)
	}
	unknown := httptest.NewRecorder()
	handler.ServeHTTP(unknown, httptest.NewRequest(http.MethodGet, "/offline/not-a-route", nil))
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unexpected offline fallback: %d", unknown.Code)
	}
}
