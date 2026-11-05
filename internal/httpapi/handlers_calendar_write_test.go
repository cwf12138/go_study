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

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestCalendarWriteHTTPContract(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("calendar-write-fixture-secret", "test", time.Hour)
	h := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	auth := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Calendar", "email": "calendar-write@example.test", "password": "fixture-password-123"})
	var session struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	json.Unmarshal(auth.Body.Bytes(), &session)
	request := func(method, path, etag string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+session.Data.Token)
		if etag != "" {
			r.Header.Set("If-Match", etag)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	body := map[string]any{"schema_version": 1, "request_id": "calendar-http-12345678", "title": "中文日程", "start_at": "2026-11-05T08:00:00.123456789Z", "end_at": "2026-11-05T09:00:00.123456789Z"}
	first := request("POST", "/api/v1/calendar/event-commands", "", body)
	var out struct {
		Data service.CalendarCommandResult `json:"data"`
	}
	json.Unmarshal(first.Body.Bytes(), &out)
	if first.Code != 201 || out.Data.Event == nil {
		t.Fatal(first.Code, first.Body.String())
	}
	if replay := request("POST", "/api/v1/calendar/event-commands", "", body); replay.Code != 200 {
		t.Fatal(replay.Code, replay.Body.String())
	}
	body["title"] = "不同内容"
	if r := request("POST", "/api/v1/calendar/event-commands", "", body); r.Code != 409 {
		t.Fatal("changed command", r.Code)
	}
	body["user_id"] = "other"
	if r := request("POST", "/api/v1/calendar/event-commands", "", body); r.Code != 400 {
		t.Fatal("unsupported field", r.Code)
	}
	path := "/api/v1/calendar/events/" + out.Data.Event.ID
	read := request("GET", path, "", nil)
	etag := read.Header().Get("ETag")
	if read.Code != 200 || etag == "" {
		t.Fatal(read.Code, read.Body.String())
	}
	for _, header := range []string{"*", "W/" + etag, etag + "," + etag, "\"other@2026-11-05T00:00:00Z\""} {
		if r := request("PATCH", path, header, map[string]any{"title": "change"}); r.Code != 400 {
			t.Fatal("invalid condition", r.Code)
		}
	}
	updated := request("PATCH", path, etag, map[string]any{"title": "更新标题"})
	if updated.Code != 200 || updated.Header().Get("ETag") == etag {
		t.Fatal(updated.Code, updated.Body.String())
	}
	if r := request("PATCH", path, etag, map[string]any{"title": "stale"}); r.Code != 409 {
		t.Fatal("stale edit", r.Code)
	}
	if r := request("DELETE", path, etag, nil); r.Code != 409 {
		t.Fatal("stale delete", r.Code)
	}
	if r := request("DELETE", path, updated.Header().Get("ETag"), nil); r.Code != 204 {
		t.Fatal(r.Code, r.Body.String())
	}
	receipt := request("GET", "/api/v1/calendar/event-commands/calendar-http-12345678", "", nil)
	json.Unmarshal(receipt.Body.Bytes(), &out)
	if receipt.Code != 200 || out.Data.Event != nil {
		t.Fatal("deleted receipt", receipt.Code, receipt.Body.String())
	}
	if r := performJSON(t, h, http.MethodGet, path, "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
}
