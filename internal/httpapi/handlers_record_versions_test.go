package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestRecordHTTPVersionContracts(t *testing.T) {
	tokens := security.NewTokenManager("record-version-http-secret-long-enough", "test", time.Hour)
	token, err := tokens.Issue("owner", "student")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service.New(store.NewMemory(), tokens, nil), tokens, event.NewBus(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	path := "/api/v1/moods/2026-11-02"
	body := map[string]any{"mood": "good", "stress": 3, "energy": 4, "note": "文字", "expected_version": ""}
	created := performJSON(t, handler, http.MethodPut, path, token, body)
	var entry struct {
		Data domain.MoodEntry `json:"data"`
	}
	if created.Code != http.StatusOK || json.Unmarshal(created.Body.Bytes(), &entry) != nil || entry.Data.ID == "" {
		t.Fatalf("create=%d %s", created.Code, created.Body.String())
	}
	if r := performJSON(t, handler, http.MethodPut, path, token, body); r.Code != http.StatusConflict {
		t.Fatalf("duplicate create=%d", r.Code)
	}
	version := entry.Data.ID + "@" + entry.Data.UpdatedAt.Format(time.RFC3339Nano)
	body["expected_version"] = version
	body["note"] = "新文字"
	if r := performJSON(t, handler, http.MethodPut, path, token, body); r.Code != http.StatusOK {
		t.Fatalf("edit=%d %s", r.Code, r.Body.String())
	}
	if r := performJSON(t, handler, http.MethodDelete, path+"?expected_version="+url.QueryEscape(version), token, nil); r.Code != http.StatusConflict {
		t.Fatalf("stale delete=%d", r.Code)
	}
	body["expected_version"] = "bad"
	if r := performJSON(t, handler, http.MethodPut, path, token, body); r.Code != http.StatusBadRequest {
		t.Fatalf("malformed=%d", r.Code)
	}
	delete(body, "expected_version")
	if r := performJSON(t, handler, http.MethodPut, path, token, body); r.Code != http.StatusOK {
		t.Fatalf("legacy=%d", r.Code)
	}
}
