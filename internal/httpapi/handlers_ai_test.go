package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
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
