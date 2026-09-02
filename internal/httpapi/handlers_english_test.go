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

func TestEnglishReadingAPIWorkflow(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("english-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{"name": "English learner", "email": "english@example.com", "password": "safe-password-123"})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	created := performJSON(t, handler, http.MethodPost, "/api/v1/english/library", auth.Data.Token, map[string]any{"article": map[string]any{"id": "offline-1", "title": "Read with purpose", "summary": "Good readers ask questions while they read.", "source": "StudyFlow Reading Lab", "category": "learning", "difficulty": "B1", "reading_minutes": 1, "word_count": 8, "offline": true}, "status": "saved"})
	var saved struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &saved) != nil || saved.Data.ID == "" {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	completed := performJSON(t, handler, http.MethodPatch, "/api/v1/english/library/"+saved.Data.ID, auth.Data.Token, map[string]any{"status": "completed", "notes": "Ask better questions.", "new_words": []string{"purpose"}})
	if completed.Code != http.StatusOK {
		t.Fatalf("complete status=%d body=%s", completed.Code, completed.Body.String())
	}
	overview := performJSON(t, handler, http.MethodGet, "/api/v1/english/overview", auth.Data.Token, nil)
	if overview.Code != http.StatusOK || !json.Valid(overview.Body.Bytes()) {
		t.Fatalf("overview status=%d body=%s", overview.Code, overview.Body.String())
	}
	library := performJSON(t, handler, http.MethodGet, "/api/v1/english/library", auth.Data.Token, nil)
	if library.Code != http.StatusOK {
		t.Fatalf("library status=%d body=%s", library.Code, library.Body.String())
	}
}
