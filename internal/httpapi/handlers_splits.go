package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listSplits(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	rows, e := s.service.ListSplits(r.Context(), claimsFromContext(r.Context()).Subject)
	if e != nil {
		writeError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": rows})
}
func (s *Server) saveSplit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var in service.SaveSplitInput
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	row, e := s.service.SaveSplit(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if e != nil {
		writeError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row})
}
