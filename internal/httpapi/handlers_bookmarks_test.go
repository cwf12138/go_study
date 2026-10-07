package httpapi

import (
	"encoding/json"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestBookmarksHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("bookmark-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, handler, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Reader", "email": email, "password": "safe-password-123"})
		var auth struct{ Data struct{ Token string } }
		if json.Unmarshal(r.Body.Bytes(), &auth) != nil || r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		return auth.Data.Token
	}
	alice, bob := register("bookmark-a@example.com"), register("bookmark-b@example.com")
	body := map[string]any{"url": "https://example.com", "title": "A bookmark", "revision": 0}
	for i := 0; i < 2; i++ {
		if r := performJSON(t, handler, "PUT", "/api/v1/bookmarks/bookmark-01", alice, body); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	if r := performJSON(t, handler, "GET", "/api/v1/bookmarks", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	if r := performJSON(t, handler, "PUT", "/api/v1/bookmarks/bookmark-02", alice, body); r.Code != 409 {
		t.Fatal(r.Code)
	}
	for _, tc := range []struct {
		token string
		count int
	}{{alice, 1}, {bob, 0}} {
		r := performJSON(t, handler, "GET", "/api/v1/bookmarks", tc.token, nil)
		var list struct{ Data []domain.Bookmark }
		if json.Unmarshal(r.Body.Bytes(), &list) != nil || r.Code != 200 || len(list.Data) != tc.count {
			t.Fatal(r.Body.String())
		}
		r = performJSON(t, handler, "GET", "/api/v1/exports/data", tc.token, nil)
		var bundle service.UserDataExport
		if json.Unmarshal(r.Body.Bytes(), &bundle) != nil || r.Code != 200 || len(bundle.Bookmarks) != tc.count || bundle.Counts["bookmarks"] != tc.count {
			t.Fatal(r.Body.String())
		}
	}
	body["revision"] = 1
	body["title"] = "cannot alter another account"
	if r := performJSON(t, handler, "PUT", "/api/v1/bookmarks/bookmark-01", bob, body); r.Code != 404 {
		t.Fatal(r.Code)
	}
	body["url"] = "javascript:alert(1)"
	if r := performJSON(t, handler, "PUT", "/api/v1/bookmarks/bookmark-01", alice, body); r.Code != 400 {
		t.Fatal(r.Code)
	}
}
