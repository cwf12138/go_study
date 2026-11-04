package httpapi

import (
	"net/http"

	"github.com/example/studyflow/internal/service"
)

func (s *Server) createTodoImport(w http.ResponseWriter, r *http.Request) {
	var in service.CreateTodoImportInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	out, err := s.service.CreateTodoImport(r.Context(), claimsFromContext(r.Context()).Subject, in)
	if err != nil {
		writeError(w, err)
		return
	}
	status := http.StatusOK
	if out.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, envelope{"data": out})
}
func (s *Server) todoImport(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.TodoImport(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("request_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": out})
}
