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

func TestTodoImportHTTPReplayAndDeletion(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("todo-import-http-fixture-secret", "test", time.Hour)
	handler := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	auth := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{"name": "Alice", "email": "import@example.test", "password": "fixture-password-123"})
	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(auth.Body.Bytes(), &login); err != nil || login.Data.Token == "" {
		t.Fatal(err, auth.Body.String())
	}
	body := map[string]any{"schema_version": 1, "request_id": "request-http-123456789", "title": "原样提交的中文待办", "notes": "先保存在本机", "priority": "medium"}
	var created struct {
		Data service.TodoImportResult `json:"data"`
	}
	first := performJSON(t, handler, http.MethodPost, "/api/v1/todo-imports", login.Data.Token, body)
	if first.Code != http.StatusCreated {
		t.Fatal(first.Code, first.Body.String())
	}
	if err := json.Unmarshal(first.Body.Bytes(), &created); err != nil || created.Data.Todo == nil {
		t.Fatal(err)
	}
	replay := performJSON(t, handler, http.MethodPost, "/api/v1/todo-imports", login.Data.Token, body)
	if replay.Code != http.StatusOK {
		t.Fatal(replay.Code, replay.Body.String())
	}
	body["title"] = "变更内容"
	changed := performJSON(t, handler, http.MethodPost, "/api/v1/todo-imports", login.Data.Token, body)
	if changed.Code != http.StatusConflict {
		t.Fatal(changed.Code, changed.Body.String())
	}
	body["repeat_rule"] = "daily"
	unsupported := performJSON(t, handler, http.MethodPost, "/api/v1/todo-imports", login.Data.Token, body)
	if unsupported.Code != http.StatusBadRequest {
		t.Fatal(unsupported.Code, unsupported.Body.String())
	}
	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/todos/"+created.Data.Todo.ID, login.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatal(deleted.Code, deleted.Body.String())
	}
	lookup := performJSON(t, handler, http.MethodGet, "/api/v1/todo-imports/request-http-123456789", login.Data.Token, nil)
	var result struct {
		Data service.TodoImportResult `json:"data"`
	}
	json.Unmarshal(lookup.Body.Bytes(), &result)
	if lookup.Code != http.StatusOK || result.Data.Todo != nil || result.Data.Receipt.ID != created.Data.Receipt.ID {
		t.Fatal(lookup.Code, lookup.Body.String())
	}
	unauthorized := performJSON(t, handler, http.MethodGet, "/api/v1/todo-imports/request-http-123456789", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatal(unauthorized.Code)
	}
}
