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
