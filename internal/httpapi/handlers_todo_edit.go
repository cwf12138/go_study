package httpapi

import (
	"net/http"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func todoCondition(r *http.Request, required bool) ([]string, error) {
	return recordCondition(r, "todo_id", required)
}

func todoETag(w http.ResponseWriter, todo domain.TodoItem) {
	w.Header().Set("ETag", "\""+service.TodoVersion(todo)+"\"")
}

func (s *Server) getTodo(w http.ResponseWriter, r *http.Request) {
	todo, err := s.service.Todo(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	todoETag(w, todo)
	writeJSON(w, http.StatusOK, envelope{"data": todo, "meta": envelope{"write_contract": "todo-if-match-v1"}})
}

func (s *Server) updateTodo(w http.ResponseWriter, r *http.Request) {
	expected, err := todoCondition(r, true)
	if err != nil {
		writeError(w, err)
		return
	}
	var input service.UpdateTodoInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	todo, err := s.service.UpdateTodo(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"), expected[0], input)
	if err != nil {
		writeError(w, err)
		return
	}
	todoETag(w, todo)
	writeJSON(w, http.StatusOK, envelope{"data": todo})
}
