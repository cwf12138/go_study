package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listWhiteboards(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	rows, e := s.service.ListWhiteboards(r.Context(), claimsFromContext(r.Context()).Subject)
	if e != nil {
		writeError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": rows})
}
func (s *Server) saveWhiteboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var in service.SaveWhiteboardInput
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	row, e := s.service.SaveWhiteboard(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if e != nil {
		writeError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row})
}
