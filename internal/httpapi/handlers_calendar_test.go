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

func TestCalendarAPIWorkflow(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("calendar-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Calendar owner", "email": "calendar-owner@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	created := performJSON(t, handler, http.MethodPost, "/api/v1/calendar/events", auth.Data.Token, map[string]any{
		"title": "Weekly review", "start_at": "2026-08-31T11:00:00Z", "end_at": "2026-08-31T12:00:00Z",
		"repeat_rule": "weekly", "repeat_until": "2026-09-30T15:59:59Z", "color": "#5b81ff", "reminder_minutes": 30,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var eventResponse struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(created.Body.Bytes(), &eventResponse) != nil || eventResponse.Data.ID == "" {
		t.Fatalf("created event missing id: %s", created.Body.String())
	}

	overview := performJSON(t, handler, http.MethodGet, "/api/v1/calendar?start=2026-08-31&end=2026-10-01", auth.Data.Token, nil)
	if overview.Code != http.StatusOK || strings.Count(overview.Body.String(), "occurrence_id") != 5 {
		t.Fatalf("overview status = %d, body = %s", overview.Code, overview.Body.String())
	}
	day := performJSON(t, handler, http.MethodGet, "/api/v1/calendar/days/2026-02-17", auth.Data.Token, nil)
	if day.Code != http.StatusOK || !strings.Contains(day.Body.String(), "正月初一") || !strings.Contains(day.Body.String(), "春节") {
		t.Fatalf("day status = %d, body = %s", day.Code, day.Body.String())
	}
	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/calendar/events/"+eventResponse.Data.ID, auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
}
