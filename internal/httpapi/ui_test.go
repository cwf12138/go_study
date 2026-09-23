package httpapi

import (
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
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
	if home.Code != http.StatusOK || !strings.Contains(home.Body.String(), "StudyFlow") || !strings.Contains(home.Body.String(), "mood-trend") || !strings.Contains(home.Body.String(), "theme-toggle") || !strings.Contains(home.Body.String(), "vocab-catalogs") || !strings.Contains(home.Body.String(), "vocab-pagination") || !strings.Contains(home.Body.String(), "panel-calendar") || !strings.Contains(home.Body.String(), "panel-memos") || !strings.Contains(home.Body.String(), "memo-editor") || !strings.Contains(home.Body.String(), "panel-knowledge") || !strings.Contains(home.Body.String(), "panel-english") || !strings.Contains(home.Body.String(), "panel-literature") || !strings.Contains(home.Body.String(), "ebook-reader-dialog") || !strings.Contains(home.Body.String(), "classic-reader-dialog") || !strings.Contains(home.Body.String(), "english-reader-dialog") || !strings.Contains(home.Body.String(), "command-dialog") || !strings.Contains(home.Body.String(), "memos.js?v=20260909-1") || !regexp.MustCompile(`src="/static/app.js\?v=[^"]+"`).MatchString(home.Body.String()) || strings.Contains(home.Body.String(), "panel-review") || strings.Contains(home.Body.String(), `data-view="review"`) {
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
	if javascript.Code != http.StatusOK || !strings.Contains(javascript.Body.String(), "function bootstrap") || strings.Contains(javascript.Body.String(), "/api/v1/cards") || strings.Contains(javascript.Body.String(), "/api/v1/decks") {
		t.Fatalf("asset status = %d", javascript.Code)
	}
	if cacheControl := javascript.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "must-revalidate") {
		t.Fatalf("javascript cache control = %q", cacheControl)
	}

	for _, mood := range []string{"awful", "low", "neutral", "good", "great"} {
		t.Run("mood artwork "+mood, func(t *testing.T) {
			asset := httptest.NewRecorder()
			handler.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/static/mood-art/"+mood+"-flat-v2.png", nil))
			if asset.Code != http.StatusOK || asset.Header().Get("Content-Type") != "image/png" {
				t.Fatalf("mood image status = %d, content type = %q", asset.Code, asset.Header().Get("Content-Type"))
			}
			picture, err := png.Decode(asset.Body)
			if err != nil {
				t.Fatalf("decode mood image: %v", err)
			}
			bounds := picture.Bounds()
			if bounds.Dx() < 256 || bounds.Dx() != bounds.Dy() {
				t.Fatalf("expected high-resolution square mood art, got %v", bounds)
			}
			for _, corner := range [][2]int{{0, 0}, {bounds.Max.X - 1, 0}, {0, bounds.Max.Y - 1}, {bounds.Max.X - 1, bounds.Max.Y - 1}} {
				// Full-bleed badge textures are clipped into circles in CSS/SVG.
				// They must remain opaque so matte extraction cannot punch holes.
				if _, _, _, alpha := picture.At(corner[0], corner[1]).RGBA(); alpha < 0xff00 {
					t.Fatal("flat mood badge must have an opaque color background")
				}
			}
			if _, _, _, alpha := picture.At(bounds.Dx()/2, bounds.Dy()/2).RGBA(); alpha == 0 {
				t.Fatal("mood artwork must contain a visible character")
			}
		})
	}

	if !strings.Contains(home.Body.String(), `/static/organizer-studio.css?v=`) {
		t.Fatal("calendar and memos shared presentation stylesheet is missing")
	}
	organizerStyles := httptest.NewRecorder()
	handler.ServeHTTP(organizerStyles, httptest.NewRequest(http.MethodGet, "/static/organizer-studio.css?v=test", nil))
	if organizerStyles.Code != http.StatusOK || !strings.HasPrefix(organizerStyles.Header().Get("Content-Type"), "text/css") || !strings.Contains(organizerStyles.Body.String(), "#panel-memos") || !strings.Contains(organizerStyles.Body.String(), "#panel-calendar") {
		t.Fatalf("organizer stylesheet status = %d", organizerStyles.Code)
	}
	if !strings.Contains(organizerStyles.Header().Get("Cache-Control"), "must-revalidate") {
		t.Fatal("organizer styles must be revalidated")
	}

	if !strings.Contains(home.Body.String(), `/static/focus-studio.css?v=`) || !strings.Contains(home.Body.String(), `id="focus-phase-track"`) || !strings.Contains(home.Body.String(), `form="focus-form"`) {
		t.Fatal("focus studio stylesheet, phase track or form submission control is missing")
	}
	focusStyles := httptest.NewRecorder()
	handler.ServeHTTP(focusStyles, httptest.NewRequest(http.MethodGet, "/static/focus-studio.css?v=test", nil))
	if focusStyles.Code != http.StatusOK || !strings.HasPrefix(focusStyles.Header().Get("Content-Type"), "text/css") || !strings.Contains(focusStyles.Body.String(), "#panel-focus") {
		t.Fatalf("focus stylesheet status = %d, content-type = %q", focusStyles.Code, focusStyles.Header().Get("Content-Type"))
	}
	if !strings.Contains(focusStyles.Header().Get("Cache-Control"), "must-revalidate") {
		t.Fatal("focus stylesheet must revalidate with the server")
	}

	for _, marker := range []string{`/static/task-studio.css?v=`, `id="task-search"`, `id="tasks-pagination"`, `id="task-create-shortcut"`} {
		if !strings.Contains(home.Body.String(), marker) {
			t.Fatalf("task studio marker is missing: %s", marker)
		}
	}
	taskStyles := httptest.NewRecorder()
	handler.ServeHTTP(taskStyles, httptest.NewRequest(http.MethodGet, "/static/task-studio.css?v=test", nil))
	if taskStyles.Code != http.StatusOK || !strings.HasPrefix(taskStyles.Header().Get("Content-Type"), "text/css") || !strings.Contains(taskStyles.Body.String(), "#panel-tasks") {
		t.Fatalf("task stylesheet status = %d, content-type = %q", taskStyles.Code, taskStyles.Header().Get("Content-Type"))
	}
	if !strings.Contains(taskStyles.Header().Get("Cache-Control"), "must-revalidate") {
		t.Fatal("task stylesheet must revalidate with the server")
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
	memosScript := httptest.NewRecorder()
	handler.ServeHTTP(memosScript, httptest.NewRequest(http.MethodGet, "/static/memos.js", nil))
	if memosScript.Code != http.StatusOK || !strings.Contains(memosScript.Body.String(), "function renderMemos") || !strings.Contains(memosScript.Body.String(), "function saveCurrent") {
		t.Fatalf("memos script status = %d", memosScript.Code)
	}

	englishScript := httptest.NewRecorder()
	handler.ServeHTTP(englishScript, httptest.NewRequest(http.MethodGet, "/static/english.js", nil))
	if englishScript.Code != http.StatusOK || !strings.Contains(englishScript.Body.String(), "function renderFeed") || !strings.Contains(englishScript.Body.String(), "function openReader") {
		t.Fatalf("english script status = %d", englishScript.Code)
	}
	englishStyles := httptest.NewRecorder()
	handler.ServeHTTP(englishStyles, httptest.NewRequest(http.MethodGet, "/static/english.css", nil))
	if englishStyles.Code != http.StatusOK || !strings.Contains(englishStyles.Body.String(), ".english-reader-dialog") {
		t.Fatalf("english stylesheet status = %d", englishStyles.Code)
	}
	literatureScript := httptest.NewRecorder()
	handler.ServeHTTP(literatureScript, httptest.NewRequest(http.MethodGet, "/static/literature.js", nil))
	if literatureScript.Code != http.StatusOK || !strings.Contains(literatureScript.Body.String(), "function renderCatalog") || !strings.Contains(literatureScript.Body.String(), "function openClassic") {
		t.Fatalf("literature script status = %d", literatureScript.Code)
	}
	literatureStyles := httptest.NewRecorder()
	handler.ServeHTTP(literatureStyles, httptest.NewRequest(http.MethodGet, "/static/literature.css", nil))
	if literatureStyles.Code != http.StatusOK || !strings.Contains(literatureStyles.Body.String(), ".ebook-reader-dialog") || !strings.Contains(literatureStyles.Body.String(), ".classic-parallel-text") {
		t.Fatalf("literature stylesheet status = %d", literatureStyles.Code)
	}
}
