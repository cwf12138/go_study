package httpapi

import (
	"bytes"
	"github.com/example/studyflow/internal/chatgpt"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAIRequiresLoopbackHostAndOrigin(t *testing.T) {
	s := &Server{}
	next := s.localAI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, row := range []struct {
		remote, host, origin string
		status               int
	}{
		{"127.0.0.1:1234", "localhost:8080", "http://localhost:8080", 204},
		{"[::1]:1234", "127.0.0.1:8080", "", 204},
		{"192.168.1.10:1234", "localhost:8080", "", 403},
		{"127.0.0.1:1234", "evil.test:8080", "", 403},
		{"127.0.0.1:1234", "localhost:8080", "http://evil.test", 403},
		{"127.0.0.1:1234", "localhost:8080", "null", 403},
		{"127.0.0.1:1234", "localhost:8080", "http://localhost:9999", 403},
	} {
		r := httptest.NewRequest("GET", "http://"+row.host+"/api/v1/ai/chatgpt", nil)
		r.RemoteAddr = row.remote
		r.Header.Set("Origin", row.origin)
		r.Header.Set("X-Forwarded-For", "127.0.0.1")
		w := httptest.NewRecorder()
		w.Header().Set("Access-Control-Allow-Origin", "*")
		next.ServeHTTP(w, r)
		if w.Code != row.status || w.Header().Get("Access-Control-Allow-Origin") != "" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%+v -> %d", row, w.Code)
		}
	}
}

func TestAIErrorExposesSafeDiagnostic(t *testing.T) {
	w := httptest.NewRecorder()
	aiError(w, &chatgpt.RequestFailure{Stage: "token_exchange", HTTPStatus: 403, Format: "json_error", Code: "invalid_scope", RequestID: "req_test-123", Hint: "需要核对授权范围"})
	if w.Code != 502 || !strings.Contains(w.Body.String(), `"http_status":403`) || !strings.Contains(w.Body.String(), `"stage":"token_exchange"`) || !strings.Contains(w.Body.String(), `"provider_request_id":"req_test-123"`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestFoodDecisionHTTPContract(t *testing.T) {
	tokens := security.NewTokenManager("food-decision-secret-long-enough", "test", time.Hour)
	token, err := tokens.Issue("test-food-user", "user")
	if err != nil {
		t.Fatal(err)
	}
	bus := event.NewBus()
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	send := func(body, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/ai/meals/recommend", bytes.NewBufferString(body))
		r.RemoteAddr = "127.0.0.1:50000"
		if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	valid := `{"model":"test","prompt":"很饿想点外卖","meal":"dinner","channel":"delivery","budget":40,"flavor":"mild","hunger":"hearty","exclude":["牛肉"]}`
	if w := send(valid, ""); w.Code != 401 {
		t.Fatal("missing authentication", w.Code)
	}
	for _, body := range []string{`{"model":"test","prompt":"晚餐","people":2,"minutes":30}`, strings.Replace(valid, `"budget":40`, `"budget":501`, 1), strings.Replace(valid, `"channel":"delivery"`, `"channel":"cooking"`, 1), valid + ` {}`} {
		if w := send(body, token); w.Code != 400 {
			t.Fatalf("invalid request accepted: %d %s", w.Code, w.Body.String())
		}
	}
	if w := send(valid, token); w.Code != 502 || !strings.Contains(w.Body.String(), "请先连接") {
		t.Fatal("unconnected request should not infer", w.Code, w.Body.String())
	}
	r := httptest.NewRequest("GET", "http://localhost:8080/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if !strings.Contains(w.Body.String(), "food-form") || !strings.Contains(w.Body.String(), "meal-legacy-template") {
		t.Fatal("new page not embedded")
	}
}
