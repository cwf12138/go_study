package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) createMemoAction(w http.ResponseWriter, r *http.Request) {
	var input service.CreateMemoActionInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	result, err := s.service.CreateMemoAction(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"), input)
	if err != nil {
		writeError(w, err)
		return
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, envelope{"data": result})
}
func (s *Server) memoActions(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.MemoActionLinks(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
func (s *Server) actionContext(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ActionContext(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("action_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
func (s *Server) todoContext(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.TodoContext(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
func (s *Server) todoFocusRequest(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.TodoFocusRequest(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("request_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
