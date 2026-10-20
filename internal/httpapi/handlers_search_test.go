package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
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

type failedSearchRepo struct{ store.Repository }

func (r failedSearchRepo) ListMemoNotes(context.Context, string) ([]domain.MemoNote, error) {
	return nil, errors.New("SENSITIVE_DB_DETAIL")
}

func TestContentSearchHTTP(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("search-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repo, tokens, bus)
	h := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if r := performJSON(t, h, "POST", "/api/v1/search", "", map[string]any{"query": "日常"}); r.Code != 401 {
		t.Fatal("auth", r.Code)
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Search", "email": email, "password": "safe-password-123"})
		var out struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token
	}
	alice, bob := register("search-alice@example.test"), register("search-bob@example.test")
	r := performJSON(t, h, "POST", "/api/v1/memos", alice, map[string]any{"title": "搜索样例", "content": "ONLY_ALICE_PRIVATE"})
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body.String())
	}
	for _, tc := range []struct {
		token string
		total int
	}{{alice, 1}, {bob, 0}} {
		r = performJSON(t, h, "POST", "/api/v1/search", tc.token, map[string]any{"query": "ONLY_ALICE_PRIVATE", "sources": []string{"memos"}})
		var out struct{ Data domain.SearchResult }
		if r.Code != 200 || r.Header().Get("Cache-Control") != "no-store" || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Total != tc.total {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	for _, raw := range []string{`{"query":""}`, `{"query":"x","sources":["letters"]}`, `{"query":"x","unexpected":true}`, `{"query":"x"} {}`, `null`} {
		req := httptest.NewRequest("POST", "/api/v1/search", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 400 {
			t.Fatal(raw, rr.Code, rr.Body.String())
		}
	}
	failed := NewHandler(service.New(failedSearchRepo{repo}, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r = performJSON(t, failed, "POST", "/api/v1/search", alice, map[string]any{"query": "x", "sources": []string{"memos"}})
	if r.Code != 503 || strings.Contains(r.Body.String(), "SENSITIVE") {
		t.Fatal(r.Code, r.Body.String())
	}
	for _, path := range []string{"/static/content-search.js", "/static/content-search.css"} {
		req := httptest.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatal(path, rr.Code)
		}
	}
}
