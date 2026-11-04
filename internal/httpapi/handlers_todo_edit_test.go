package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestTodoEditHTTPConditionAndOwnership(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("todo-edit-fixture-secret", "test", time.Hour)
	handler := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Fixture", "email": email, "password": "fixture-password-123"})
		var result struct {
			Data struct {
				Token string `json:"token"`
			} `json:"data"`
		}
		if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil || result.Data.Token == "" {
			t.Fatal(err, r.Body.String())
		}
		return result.Data.Token
	}
	token, other := register("todo-edit-a@example.test"), register("todo-edit-b@example.test")
	created := performJSON(t, handler, "POST", "/api/v1/todos", token, map[string]any{"title": "原待办", "priority": "medium", "steps": []string{"旧步骤"}})
	var result struct {
		Data domain.TodoItem `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil || created.Code != 201 {
		t.Fatal(err, created.Body.String())
	}
	todo := result.Data
	path := "/api/v1/todos/" + todo.ID
	request := func(method, path, owner, etag string, body any) *httptest.ResponseRecorder {
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+owner)
		if etag != "" {
			r.Header.Set("If-Match", etag)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	read := request("GET", path, token, "", nil)
	etag := read.Header().Get("ETag")
	if read.Code != 200 || etag != "\""+service.TodoVersion(todo)+"\"" {
		t.Fatal(read.Code, etag)
	}
	body := map[string]any{"list_id": todo.ListID, "title": "已修改", "notes": "中文备注", "priority": "high", "repeat_rule": "none", "steps": []map[string]any{{"id": todo.Steps[0].ID, "title": "保留的步骤", "completed": true}}}
	for _, header := range []string{"", "*", "W/" + etag, etag + "," + etag, "\"other@2026-11-05T00:00:00Z\""} {
		if r := request("PATCH", path, token, header, body); r.Code != 400 {
			t.Fatal("invalid condition accepted", header, r.Code, r.Body.String())
		}
	}
	if r := request("PATCH", path, other, etag, body); r.Code != 403 {
		t.Fatal("cross-owner", r.Code)
	}
	body["status"] = "completed"
	if r := request("PATCH", path, token, etag, body); r.Code != 400 {
		t.Fatal("unsupported field", r.Code)
	}
	delete(body, "status")
	updated := request("PATCH", path, token, etag, body)
	if updated.Code != 200 || updated.Header().Get("ETag") == etag {
		t.Fatal(updated.Code, updated.Body.String())
	}
	if r := request("PATCH", path+"/status", token, etag, map[string]any{"completed": true}); r.Code != 409 {
		t.Fatal("stale status", r.Code)
	}
	if r := request("DELETE", path, token, etag, nil); r.Code != 409 {
		t.Fatal("stale deletion", r.Code)
	}
	if r := request("PATCH", path, token, etag, body); r.Code != 409 {
		t.Fatal("stale editor", r.Code)
	}
	current := updated.Header().Get("ETag")
	if r := request("PATCH", path+"/status", token, current, map[string]any{"completed": true}); r.Code != 200 {
		t.Fatal("conditional complete", r.Code, r.Body.String())
	}
	// Older clients still work, but each service write now commits against its read version.
	if r := request("PATCH", path+"/status", token, "", map[string]any{"completed": false}); r.Code != 200 {
		t.Fatal("legacy status", r.Code, r.Body.String())
	}
	if r := request("GET", path, "", "", nil); r.Code != http.StatusUnauthorized {
		t.Fatal(r.Code)
	}
}
