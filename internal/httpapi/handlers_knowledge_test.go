package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestKnowledgeAPIWorkflow(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("knowledge-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Knowledge owner", "email": "knowledge-owner@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	first := performJSON(t, handler, http.MethodPost, "/api/v1/knowledge/notes", auth.Data.Token, map[string]any{
		"title": "Go Channel", "content": "channel 用于通信。", "tags": []string{"Go", "并发"}, "pinned": true,
	})
	if first.Code != http.StatusCreated {
		t.Fatalf("create first status = %d, body = %s", first.Code, first.Body.String())
	}
	second := performJSON(t, handler, http.MethodPost, "/api/v1/knowledge/notes", auth.Data.Token, map[string]any{
		"title": "Select", "content": "关联 [[Go Channel]] 与 [[Context]]。", "tags": []string{"Go"},
	})
	var created struct {
		Data struct {
			Note struct {
				ID string `json:"id"`
			} `json:"note"`
		} `json:"data"`
	}
	if second.Code != http.StatusCreated || json.Unmarshal(second.Body.Bytes(), &created) != nil || created.Data.Note.ID == "" {
		t.Fatalf("create second status = %d, body = %s", second.Code, second.Body.String())
	}

	detail := performJSON(t, handler, http.MethodGet, "/api/v1/knowledge/notes/"+created.Data.Note.ID, auth.Data.Token, nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), "outgoing_links") || !strings.Contains(detail.Body.String(), "unresolved_links") || !strings.Contains(detail.Body.String(), "Go Channel") {
		t.Fatalf("detail status = %d, body = %s", detail.Code, detail.Body.String())
	}
	graph := performJSON(t, handler, http.MethodGet, "/api/v1/knowledge/graph", auth.Data.Token, nil)
	if graph.Code != http.StatusOK || strings.Count(graph.Body.String(), "backlink_count") != 2 || !strings.Contains(graph.Body.String(), `"unresolved_count":1`) {
		t.Fatalf("graph status = %d, body = %s", graph.Code, graph.Body.String())
	}
	search := performJSON(t, handler, http.MethodGet, "/api/v1/knowledge/notes?q=channel&tag=Go", auth.Data.Token, nil)
	if search.Code != http.StatusOK || !strings.Contains(search.Body.String(), "Go Channel") || !strings.Contains(search.Body.String(), `"total"`) && !strings.Contains(search.Body.String(), `"count"`) {
		t.Fatalf("search status = %d, body = %s", search.Code, search.Body.String())
	}
	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/knowledge/notes/"+created.Data.Note.ID, auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
}
