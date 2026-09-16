package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listKeepsakes(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListKeepsakes(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": items})
}
func (s *Server) saveKeepsake(w http.ResponseWriter, r *http.Request) {
	var in service.SaveKeepsakeInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	item, err := s.service.SaveKeepsake(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": item})
}
