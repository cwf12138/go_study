package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestMemoHTTPConditionalSave(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	tokens := security.NewTokenManager("memo-version-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repository, tokens, nil)
	// A signed actor is sufficient; this route is tested independently from registration.
	token, err := tokens.Issue("owner", "student")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(svc, tokens, event.NewBus(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	note, err := svc.CreateMemoNote(ctx, "owner", service.SaveMemoNoteInput{Title: "Before"})
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/memos/" + note.ID
	write := func(content string) *httptest.ResponseRecorder {
		return performJSON(t, handler, http.MethodPatch, path, token, map[string]any{"content": content, "expected_updated_at": note.UpdatedAt})
	}
	if response := write("Accepted"); response.Code != http.StatusOK {
		t.Fatalf("first write=%d %s", response.Code, response.Body.String())
	}
	if response := write("Stale"); response.Code != http.StatusConflict {
		t.Fatalf("stale write=%d %s", response.Code, response.Body.String())
	}
	loaded, _ := svc.MemoNote(ctx, "owner", note.ID)
	if loaded.Content != "Accepted" {
		t.Fatal("stale request changed memo")
	}
	malformed := performJSON(t, handler, http.MethodPatch, path, token, map[string]any{"expected_updated_at": "invalid"})
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("malformed time=%d", malformed.Code)
	}
	// Existing API clients can still omit the precondition.
	legacy := performJSON(t, handler, http.MethodPatch, path, token, map[string]any{"content": "Legacy"})
	if legacy.Code != http.StatusOK {
		t.Fatalf("legacy=%d", legacy.Code)
	}
	if err := repository.DeleteMemoNote(ctx, note.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MemoNote(ctx, "owner", note.ID); err != domain.ErrNotFound {
		t.Fatal(err)
	}
}

func TestMemoAPIWorkflow(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("memo-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{"name": "Memo owner", "email": "memo@example.com", "password": "safe-password-123"})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	folderResponse := performJSON(t, handler, http.MethodPost, "/api/v1/memo-folders", auth.Data.Token, map[string]any{"name": "灵感", "color": "violet"})
	var folder struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if folderResponse.Code != http.StatusCreated || json.Unmarshal(folderResponse.Body.Bytes(), &folder) != nil || folder.Data.ID == "" {
		t.Fatalf("folder status=%d body=%s", folderResponse.Code, folderResponse.Body.String())
	}
	create := performJSON(t, handler, http.MethodPost, "/api/v1/memos", auth.Data.Token, map[string]any{"folder_id": folder.Data.ID, "title": "周末采购", "content": "- [x] 咖啡\n- [ ] 牛奶", "tags": []string{"生活"}, "color": "yellow"})
	var note struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if create.Code != http.StatusCreated || json.Unmarshal(create.Body.Bytes(), &note) != nil || note.Data.ID == "" {
		t.Fatalf("memo create status=%d body=%s", create.Code, create.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/memos?view=checklists&q=%E7%89%9B%E5%A5%B6", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"checklist_total":2`) || !strings.Contains(list.Body.String(), "周末采购") {
		t.Fatalf("memo list status=%d body=%s", list.Code, list.Body.String())
	}
	trashed := performJSON(t, handler, http.MethodDelete, "/api/v1/memos/"+note.Data.ID, auth.Data.Token, nil)
	if trashed.Code != http.StatusNoContent {
		t.Fatalf("trash status=%d body=%s", trashed.Code, trashed.Body.String())
	}
	restored := performJSON(t, handler, http.MethodPost, "/api/v1/memos/"+note.Data.ID+"/restore", auth.Data.Token, nil)
	if restored.Code != http.StatusOK || !strings.Contains(restored.Body.String(), "周末采购") {
		t.Fatalf("restore status=%d body=%s", restored.Code, restored.Body.String())
	}
}
