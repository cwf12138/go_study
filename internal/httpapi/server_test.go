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

	goal := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{"title": "Learn concurrency"})
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

func TestListGoalsSupportsPaginationFilteringAndSorting(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repository, tokens, bus)
	handler := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Lin", "email": "lin@example.com", "password": "safe-password-123",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(register.Body.Bytes(), &auth); err != nil {
		t.Fatalf("decode auth response: %v", err)
	}

	createGoal := func(title string) struct {
		ID        string    `json:"id"`
		CreatedAt time.Time `json:"created_at"`
	} {
		t.Helper()
		response := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{"title": title})
		if response.Code != http.StatusCreated {
			t.Fatalf("create %q status = %d, body = %s", title, response.Code, response.Body.String())
		}
		var created struct {
			Data struct {
				ID        string    `json:"id"`
				CreatedAt time.Time `json:"created_at"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode created goal: %v", err)
		}
		if created.Data.ID == "" || created.Data.CreatedAt.IsZero() {
			t.Fatalf("created goal is missing id or created_at: %s", response.Body.String())
		}
		return created.Data
	}

	alpha := createGoal("Alpha")
	_ = createGoal("Zebra")
	done := createGoal("Completed target")
	changeStatus := performJSON(t, handler, http.MethodPatch, "/api/v1/goals/"+done.ID+"/status", auth.Data.Token, map[string]any{"status": "completed"})
	if changeStatus.Code != http.StatusOK {
		t.Fatalf("complete goal status = %d, body = %s", changeStatus.Code, changeStatus.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/goals?status=active&sort=title&order=asc&page=1&page_size=1", auth.Data.Token, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list goals status = %d, body = %s", list.Code, list.Body.String())
	}
	var page struct {
		Data []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"data"`
		Meta struct {
			Count      int `json:"count"`
			Total      int `json:"total"`
			Page       int `json:"page"`
			PageSize   int `json:"page_size"`
			TotalPages int `json:"total_pages"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode paged goals: %v", err)
	}
	if len(page.Data) != 1 || page.Data[0].ID != alpha.ID || page.Data[0].Title != "Alpha" {
		t.Fatalf("unexpected first page data: %#v", page.Data)
	}
	if strings.Contains(list.Body.String(), "\"target_minutes\"") || strings.Contains(list.Body.String(), "\"progress\"") {
		t.Fatalf("goal list exposes removed progress fields: %s", list.Body.String())
	}
	if page.Meta.Count != 1 || page.Meta.Total != 2 || page.Meta.Page != 1 || page.Meta.PageSize != 1 || page.Meta.TotalPages != 2 {
		t.Fatalf("unexpected pagination metadata: %#v", page.Meta)
	}

	invalidSort := performJSON(t, handler, http.MethodGet, "/api/v1/goals?sort=priority", auth.Data.Token, nil)
	if invalidSort.Code != http.StatusBadRequest {
		t.Fatalf("invalid sort status = %d, want %d", invalidSort.Code, http.StatusBadRequest)
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
