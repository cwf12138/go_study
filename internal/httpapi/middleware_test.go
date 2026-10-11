package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeadersPreflight(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodPatch} {
		t.Run(method, func(t *testing.T) {
			called := false
			handler := securityHeaders(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			req := httptest.NewRequest(http.MethodOptions, "/api/v1/bookmarks/example", nil)
			req.Header.Set("Origin", "https://frontend.example")
			req.Header.Set("Access-Control-Request-Method", method)
			req.Header.Set("Access-Control-Request-Headers", "Authorization, Content-Type")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if called || res.Code != http.StatusNoContent || res.Body.Len() != 0 {
				t.Fatalf("preflight reached handler or invalid response: %d %q", res.Code, res.Body.String())
			}
			allowed := false
			for _, value := range strings.Split(res.Header().Get("Access-Control-Allow-Methods"), ",") {
				allowed = allowed || strings.TrimSpace(value) == method
			}
			if !allowed || res.Header().Get("Access-Control-Allow-Origin") != "*" || !strings.Contains(res.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
				t.Fatal("preflight does not permit authenticated method")
			}
		})
	}
}
