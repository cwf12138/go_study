package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listExplorations(w http.ResponseWriter, r *http.Request) {
	data, err := s.service.ListExplorations(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": data})
}
func (s *Server) createExploration(w http.ResponseWriter, r *http.Request) {
	var in service.ExploreInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	data, err := s.service.CreateExploration(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("kind"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, envelope{"data": data})
}
func (s *Server) completeExploration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reflection string `json:"reflection"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	data, err := s.service.CompleteExploration(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in.Reflection)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": data})
}
