package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONRoutesAndPrivateCachePolicy(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/examples/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, envelope{"data": r.PathValue("id")})
	})
	mux.HandleFunc("POST /api/v1/examples", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	handler := securityHeaders(requestContext(jsonRoutes(mux)))
	for _, tc := range []struct {
		method, path, code string
		status             int
	}{
		{http.MethodGet, "/api/v1/unknown", "route_not_found", http.StatusNotFound},
		{http.MethodPut, "/api/v1/examples/123", "method_not_allowed", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v1/examples", "method_not_allowed", http.StatusMethodNotAllowed},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("X-Request-ID", "routing-test")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			var body struct {
				RequestID string `json:"request_id"`
				Error     struct{ Code string }
			}
			if res.Code != tc.status || json.Unmarshal(res.Body.Bytes(), &body) != nil || body.Error.Code != tc.code || body.RequestID != "routing-test" {
				t.Fatal(res.Code, res.Body.String())
			}
			if res.Header().Get("Cache-Control") != "no-store" || !strings.Contains(res.Header().Get("Content-Type"), "application/json") {
				t.Fatal("private routing response must be uncached JSON", res.Header())
			}
			if tc.status == http.StatusMethodNotAllowed && res.Header().Get("Allow") == "" {
				t.Fatal("missing Allow header")
			}
		})
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/examples/actual-id", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "actual-id") {
		t.Fatal("path values were not retained", res.Body.String())
	}
}

func TestJSONRoutesDoesNotBufferStreaming(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/stream", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte("data: hello\n\n"))
	})
	res := httptest.NewRecorder()
	jsonRoutes(mux).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/stream", nil))
	if !res.Flushed || res.Body.String() != "data: hello\n\n" {
		t.Fatal("stream was buffered or lost")
	}
}

func TestResponseRecorderRetainsFirstStatus(t *testing.T) {
	res := httptest.NewRecorder()
	recorder := &responseRecorder{ResponseWriter: res}
	recorder.Flush()
	recorder.WriteHeader(http.StatusInternalServerError)
	if recorder.status != http.StatusOK || res.Code != http.StatusOK {
		t.Fatal("logged status diverged from committed status", recorder.status, res.Code)
	}
}
