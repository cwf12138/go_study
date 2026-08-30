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

func TestHomeAndStaticAssetsAreServed(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("frontend-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	home := httptest.NewRecorder()
	handler.ServeHTTP(home, httptest.NewRequest(http.MethodGet, "/", nil))
	if home.Code != http.StatusOK || !strings.Contains(home.Body.String(), "StudyFlow") || !strings.Contains(home.Body.String(), "mood-trend") || !strings.Contains(home.Body.String(), "theme-toggle") || !strings.Contains(home.Body.String(), "vocab-catalogs") || !strings.Contains(home.Body.String(), "vocab-pagination") {
		t.Fatalf("home status = %d, body = %q", home.Code, home.Body.String())
	}
	if contentType := home.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("home content type = %q", contentType)
	}

	javascript := httptest.NewRecorder()
	handler.ServeHTTP(javascript, httptest.NewRequest(http.MethodGet, "/static/app.js", nil))
	if javascript.Code != http.StatusOK || !strings.Contains(javascript.Body.String(), "function bootstrap") {
		t.Fatalf("asset status = %d", javascript.Code)
	}

	catalogStyles := httptest.NewRecorder()
	handler.ServeHTTP(catalogStyles, httptest.NewRequest(http.MethodGet, "/static/vocabulary-catalogs.css", nil))
	if catalogStyles.Code != http.StatusOK || !strings.Contains(catalogStyles.Body.String(), ".vocab-catalog") || !strings.HasPrefix(catalogStyles.Header().Get("Content-Type"), "text/css") {
		t.Fatalf("catalog stylesheet status = %d, content-type = %q", catalogStyles.Code, catalogStyles.Header().Get("Content-Type"))
	}
}
