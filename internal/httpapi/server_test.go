package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestRegisterCreateGoalAndAuthorization(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repository, tokens, bus)
	handler := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Ada", "email": "ada@example.com", "password": "safe-password-123",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(register.Body.Bytes(), &auth); err != nil || auth.Data.Token == "" {
		t.Fatalf("decode auth response: %v, body = %s", err, register.Body.String())
	}

	goal := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{
		"title": "Learn concurrency", "target_minutes": 600,
	})
	if goal.Code != http.StatusCreated {
		t.Fatalf("create goal status = %d, body = %s", goal.Code, goal.Body.String())
	}
	unauthorized := performJSON(t, handler, http.MethodGet, "/api/v1/goals", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/goals", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "Learn concurrency") {
		t.Fatalf("list goals status = %d, body = %s", list.Code, list.Body.String())
	}
	focus := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions", auth.Data.Token, map[string]any{
		"planned_minutes": 25,
	})
	if focus.Code != http.StatusCreated {
		t.Fatalf("start focus status = %d, body = %s", focus.Code, focus.Body.String())
	}
	var startedFocus struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(focus.Body.Bytes(), &startedFocus); err != nil || startedFocus.Data.ID == "" {
		t.Fatalf("decode focus response: %v, body = %s", err, focus.Body.String())
	}
	active := performJSON(t, handler, http.MethodGet, "/api/v1/focus-sessions/active", auth.Data.Token, nil)
	if active.Code != http.StatusOK || !strings.Contains(active.Body.String(), "\"status\":\"running\"") {
		t.Fatalf("active focus status = %d, body = %s", active.Code, active.Body.String())
	}
	secondFocus := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions", auth.Data.Token, map[string]any{
		"planned_minutes": 15,
	})
	if secondFocus.Code != http.StatusConflict {
		t.Fatalf("second focus status = %d, want %d", secondFocus.Code, http.StatusConflict)
	}
	paused := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions/"+startedFocus.Data.ID+"/pause", auth.Data.Token, nil)
	if paused.Code != http.StatusOK || !strings.Contains(paused.Body.String(), "\"status\":\"paused\"") {
		t.Fatalf("pause focus status = %d, body = %s", paused.Code, paused.Body.String())
	}
	resumed := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions/"+startedFocus.Data.ID+"/resume", auth.Data.Token, nil)
	if resumed.Code != http.StatusOK || !strings.Contains(resumed.Body.String(), "\"status\":\"running\"") {
		t.Fatalf("resume focus status = %d, body = %s", resumed.Code, resumed.Body.String())
	}
}

func performJSON(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = bytes.NewReader(data)
	}
	request := httptest.NewRequest(method, path, payload)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
