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
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWhiteboardsHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("whiteboard-test-secret-long-enough", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, method := range []string{"GET", "PUT"} {
		path := "/api/v1/whiteboards"
		if method == "PUT" {
			path += "/board-sample"
		}
		if r := performJSON(t, h, method, path, "", nil); r.Code != 401 {
			t.Fatal(r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Whiteboard", "email": email, "password": "safe-password-123"})
		var out struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token
	}
	alice, bob := register("wb-alice@example.test"), register("wb-bob@example.test")
	in := service.SaveWhiteboardInput{Title: "草图", Nodes: []domain.BoardNode{}}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/whiteboards/board-sample", alice, in)
		var out struct{ Data domain.Whiteboard }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Revision != 1 || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	r := performJSON(t, h, "GET", "/api/v1/whiteboards", bob, nil)
	var rows struct{ Data []domain.Whiteboard }
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &rows) != nil || len(rows.Data) != 0 {
		t.Fatal(r.Body.String())
	}
	in.Revision = 1
	if r = performJSON(t, h, "PUT", "/api/v1/whiteboards/board-sample", bob, in); r.Code != 404 {
		t.Fatal(r.Code)
	}
	in.Title = "新标题"
	if r = performJSON(t, h, "PUT", "/api/v1/whiteboards/board-sample", alice, in); r.Code != 200 {
		t.Fatal(r.Code)
	}
	in.Title = "stale"
	if r = performJSON(t, h, "PUT", "/api/v1/whiteboards/board-sample", alice, in); r.Code != 409 {
		t.Fatal(r.Code)
	}
	for _, raw := range []string{`{"title":"bad","user_id":"bob"}`, `{"title":"bad"} {}`, `null`} {
		req := httptest.NewRequest("PUT", "/api/v1/whiteboards/board-reject", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 400 {
			t.Fatal(raw, rr.Code)
		}
	}
	for _, path := range []string{"/static/whiteboards.js", "/static/whiteboards-core.js", "/static/whiteboards.css"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		if rr.Code != 404 {
			t.Fatal(path, rr.Code)
		}
	}
}
