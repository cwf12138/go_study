package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestLiteratureAPIWorkflow(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("literature-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{"name": "Reader", "email": "reader@example.com", "password": "safe-password-123"})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	catalog := performJSON(t, handler, http.MethodGet, "/api/v1/literature/catalog", auth.Data.Token, nil)
	if catalog.Code != http.StatusOK {
		t.Fatalf("catalog status=%d body=%s", catalog.Code, catalog.Body.String())
	}
	created := performJSON(t, handler, http.MethodPost, "/api/v1/literature/shelf", auth.Data.Token, map[string]any{"book": map[string]any{"id": "pg-1342", "title": "Pride and Prejudice", "chinese_title": "傲慢与偏见", "authors": []string{"Jane Austen"}, "summary": "A classic novel.", "language": "en", "content_url": "https://www.gutenberg.org/cache/epub/1342/pg1342.txt", "source_url": "https://www.gutenberg.org/ebooks/1342"}})
	var saved struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &saved) != nil || saved.Data.ID == "" {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	progress := performJSON(t, handler, http.MethodPatch, "/api/v1/literature/shelf/"+saved.Data.ID+"/progress", auth.Data.Token, map[string]any{"page_index": 2, "total_pages": 8, "reading_seconds_delta": 90})
	if progress.Code != http.StatusOK {
		t.Fatalf("progress status=%d body=%s", progress.Code, progress.Body.String())
	}
	bookmark := performJSON(t, handler, http.MethodPost, "/api/v1/literature/shelf/"+saved.Data.ID+"/bookmarks", auth.Data.Token, map[string]any{"page_index": 2, "label": "Chapter I", "excerpt": "It is a truth..."})
	if bookmark.Code != http.StatusCreated {
		t.Fatalf("bookmark status=%d body=%s", bookmark.Code, bookmark.Body.String())
	}
	classics := performJSON(t, handler, http.MethodGet, "/api/v1/literature/classics?q=静夜思", auth.Data.Token, nil)
	if classics.Code != http.StatusOK {
		t.Fatalf("classics status=%d body=%s", classics.Code, classics.Body.String())
	}
	study := performJSON(t, handler, http.MethodPut, "/api/v1/literature/classic-studies/tang-jing-ye-si", auth.Data.Token, map[string]any{"favorite": true, "status": "mastered", "notes": "月光与乡愁。", "increment_recitation": true})
	if study.Code != http.StatusOK {
		t.Fatalf("study status=%d body=%s", study.Code, study.Body.String())
	}
	overview := performJSON(t, handler, http.MethodGet, "/api/v1/literature/overview", auth.Data.Token, nil)
	if overview.Code != http.StatusOK {
		t.Fatalf("overview status=%d body=%s", overview.Code, overview.Body.String())
	}
}
