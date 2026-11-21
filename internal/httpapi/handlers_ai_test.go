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
	t.Setenv("BIGMODEL_API_KEY", "")
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

func TestFoodAIStatusUsesServerConfiguration(t *testing.T) {
	const fixtureKey = "fixture-credential.status-test"
	t.Setenv("BIGMODEL_API_KEY", fixtureKey)
	t.Setenv("BIGMODEL_MODEL", "")

	tokens := security.NewTokenManager("food-decision-secret-long-enough", "test", time.Hour)
	token, err := tokens.Issue("test-food-user", "user")
	if err != nil {
		t.Fatal(err)
	}
	bus := event.NewBus()
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, test := range []struct {
		remote, auth string
		status       int
	}{
		{"127.0.0.1:1234", "", 401},
		{"192.168.1.10:1234", token, 403},
		{"127.0.0.1:1234", token, 200},
	} {
		r := httptest.NewRequest("GET", "http://localhost:8080/api/v1/ai/meals/status", nil)
		r.RemoteAddr = test.remote
		if test.auth != "" {
			r.Header.Set("Authorization", "Bearer "+test.auth)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		body := w.Body.String()
		if w.Code != test.status || strings.Contains(body, fixtureKey) {
			t.Fatal("unexpected status response or credential disclosure", w.Code)
		}
		if w.Code == 200 && (!strings.Contains(body, `"provider":"bigmodel"`) || !strings.Contains(body, `"model":"glm-4.5-flash"`)) {
			t.Fatal("configured model missing from public status", body)
		}
	}
	body := `{"model":"wrong-model","prompt":"推荐晚餐","meal":"dinner","channel":"any","flavor":"any","hunger":"any"}`
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/ai/meals/recommend", strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "本机智谱配置") {
		t.Fatal("configured BigModel must handle the recommendation route", w.Code)
	}
}

func TestHostedMealAIRestrictsInferenceToConfiguredAccount(t *testing.T) {
	t.Setenv("BIGMODEL_API_KEY", "fixture-key")
	t.Setenv("BIGMODEL_REMOTE_OWNER_ID", "owner-id")
	tokens := security.NewTokenManager("hosted-test-secret-long-enough", "test", time.Hour)
	bus := event.NewBus()
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, tc := range []struct {
		user, method, path, body, contains string
		status                             int
	}{
		{"", "GET", "status", "", "", 401},
		{"anyone-else", "GET", "status", "", `"connected":false`, 200},
		{"owner-id", "GET", "status", "", `"connected":true`, 200},
		{"anyone-else", "POST", "recommend", `{}`, "尚未启用", 403},
		{"owner-id", "POST", "recommend", `{}`, "", 400},
		{"owner-id", "POST", "recommend", `{"model":"unconfigured","prompt":"吃什么","meal":"dinner","channel":"any","flavor":"any","hunger":"any"}`, "本机智谱配置", 502},
	} {
		request := httptest.NewRequest(tc.method, "https://daynest.example.test/api/v1/meals/ai/"+tc.path, strings.NewReader(tc.body))
		if tc.user != "" {
			token, err := tokens.Issue(tc.user, "student")
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.contains) || strings.Contains(response.Body.String(), "fixture-key") {
			t.Fatalf("unexpected response for %s %s (%s): %d", tc.method, tc.path, tc.user, response.Code)
		}
	}
}
