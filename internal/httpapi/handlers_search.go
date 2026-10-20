package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) searchContent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var in service.SearchInput
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	result, e := s.service.Search(r.Context(), claimsFromContext(r.Context()).Subject, in)
	if e != nil {
		if errors.Is(e, domain.ErrInvalidInput) {
			writeError(w, e)
		} else if errors.Is(e, context.DeadlineExceeded) {
			writeJSON(w, 504, envelope{"error": envelope{"code": "search_timeout", "message": "搜索超时，请缩小来源或关键词后重试"}})
		} else if !errors.Is(e, context.Canceled) {
			writeJSON(w, 503, envelope{"error": envelope{"code": "search_unavailable", "message": "搜索来源暂不可用，请稍后重试"}})
		}
		return
	}
	writeJSON(w, 200, envelope{"data": result})
}
