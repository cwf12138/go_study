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
	if home.Code != http.StatusOK || !strings.Contains(home.Body.String(), "StudyFlow") || !strings.Contains(home.Body.String(), "mood-trend") || !strings.Contains(home.Body.String(), "theme-toggle") || !strings.Contains(home.Body.String(), "vocab-catalogs") || !strings.Contains(home.Body.String(), "vocab-pagination") || !strings.Contains(home.Body.String(), "panel-calendar") || !strings.Contains(home.Body.String(), "panel-knowledge") || !strings.Contains(home.Body.String(), "command-dialog") || !strings.Contains(home.Body.String(), "app.js?v=20260901-6") {
		t.Fatalf("home status = %d, body = %q", home.Code, home.Body.String())
	}
	if contentType := home.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("home content type = %q", contentType)
	}
	if cacheControl := home.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "must-revalidate") {
		t.Fatalf("home cache control = %q", cacheControl)
	}

	javascript := httptest.NewRecorder()
	handler.ServeHTTP(javascript, httptest.NewRequest(http.MethodGet, "/static/app.js", nil))
	if javascript.Code != http.StatusOK || !strings.Contains(javascript.Body.String(), "function bootstrap") {
		t.Fatalf("asset status = %d", javascript.Code)
	}
	if cacheControl := javascript.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "must-revalidate") {
		t.Fatalf("javascript cache control = %q", cacheControl)
	}

	catalogStyles := httptest.NewRecorder()
	handler.ServeHTTP(catalogStyles, httptest.NewRequest(http.MethodGet, "/static/vocabulary-catalogs.css", nil))
	if catalogStyles.Code != http.StatusOK || !strings.Contains(catalogStyles.Body.String(), ".vocab-catalog") || !strings.HasPrefix(catalogStyles.Header().Get("Content-Type"), "text/css") {
		t.Fatalf("catalog stylesheet status = %d, content-type = %q", catalogStyles.Code, catalogStyles.Header().Get("Content-Type"))
	}

	calendarScript := httptest.NewRecorder()
	handler.ServeHTTP(calendarScript, httptest.NewRequest(http.MethodGet, "/static/calendar.js", nil))
	if calendarScript.Code != http.StatusOK || !strings.Contains(calendarScript.Body.String(), "function renderYear") {
		t.Fatalf("calendar script status = %d", calendarScript.Code)
	}

	knowledgeScript := httptest.NewRecorder()
	handler.ServeHTTP(knowledgeScript, httptest.NewRequest(http.MethodGet, "/static/knowledge.js", nil))
	if knowledgeScript.Code != http.StatusOK || !strings.Contains(knowledgeScript.Body.String(), "function renderKnowledgeGraph") {
		t.Fatalf("knowledge script status = %d", knowledgeScript.Code)
	}
}
