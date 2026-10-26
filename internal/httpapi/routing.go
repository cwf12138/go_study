package httpapi

import (
	"net/http"
	"strings"
)

// jsonRoutes keeps API routing errors parseable without buffering responses.
// Matched handlers (including downloads and SSE) retain their streaming behavior.
func jsonRoutes(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := mux.Handler(r); pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}
		allowed := []string{}
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			probe := r.Clone(r.Context())
			probe.Method = method
			if _, pattern := mux.Handler(probe); pattern != "" {
				allowed = append(allowed, method)
			}
		}
		if len(allowed) > 0 {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
			writeJSON(w, http.StatusMethodNotAllowed, envelope{"error": envelope{"code": "method_not_allowed", "message": "此接口不支持当前操作，请刷新页面并核对服务版本。"}})
			return
		}
		writeJSON(w, http.StatusNotFound, envelope{"error": envelope{"code": "route_not_found", "message": "此接口不存在，请确认访问地址并重启当前版本的 Go 服务。"}})
	})
}
