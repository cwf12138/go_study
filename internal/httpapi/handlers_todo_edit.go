package httpapi

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func todoCondition(r *http.Request, required bool) ([]string, error) {
	values := r.Header.Values("If-Match")
	if len(values) == 0 && !required {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("%w: one strong If-Match is required", domain.ErrInvalidInput)
	}
	value := strings.TrimSpace(values[0])
	if len(value) < 4 || len(value) > 500 || value[0] != '"' || value[len(value)-1] != '"' || strings.ContainsAny(value[1:len(value)-1], "\"\\,") {
		return nil, domain.ErrInvalidInput
	}
	version := value[1 : len(value)-1]
	index := strings.LastIndex(version, "@")
	if index < 1 || version[:index] != r.PathValue("todo_id") {
		return nil, domain.ErrInvalidInput
	}
	if _, err := time.Parse(time.RFC3339Nano, version[index+1:]); err != nil {
		return nil, domain.ErrInvalidInput
	}
	return []string{version}, nil
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
