package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListProjects(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": items})
}
func (s *Server) saveProject(w http.ResponseWriter, r *http.Request) {
	var in service.SaveProjectInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	item, err := s.service.SaveProject(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": item})
}
