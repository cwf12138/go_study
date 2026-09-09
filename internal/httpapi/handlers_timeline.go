package httpapi

import (
	"net/http"
	"strconv"
)

func (s *Server) timeline(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := 1
	offset := 0
	var err error
	if q.Has("page") {
		page, err = strconv.Atoi(q.Get("page"))
		if err != nil {
			writeJSON(w, 400, envelope{"error": envelope{"message": "页码无效"}})
			return
		}
	}
	if q.Has("offset") {
		offset, err = strconv.Atoi(q.Get("offset"))
		if err != nil {
			writeJSON(w, 400, envelope{"error": envelope{"message": "时区偏移无效"}})
			return
		}
	}
	result, err := s.service.Timeline(r.Context(), claimsFromContext(r.Context()).Subject, q.Get("month"), q.Get("kind"), offset, page)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": result})
}
