package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) createTodoList(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	list, err := s.service.CreateTodoList(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateTodoListInput{Name: body.Name, Color: body.Color})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": list})
}

func (s *Server) listTodoLists(w http.ResponseWriter, r *http.Request) {
	lists, err := s.service.ListTodoLists(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": lists, "meta": envelope{"count": len(lists)}})
}

func (s *Server) deleteTodoList(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteTodoList(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("list_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createTodo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ListID     string                `json:"list_id"`
		Title      string                `json:"title"`
		Notes      string                `json:"notes"`
		Priority   domain.TaskPriority   `json:"priority"`
		DueAt      *time.Time            `json:"due_at"`
		MyDayDate  string                `json:"my_day_date"`
		RepeatRule domain.TodoRepeatRule `json:"repeat_rule"`
		Tags       []string              `json:"tags"`
		Steps      []string              `json:"steps"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	todo, err := s.service.CreateTodo(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateTodoInput{
		ListID: body.ListID, Title: body.Title, Notes: body.Notes, Priority: body.Priority, DueAt: body.DueAt,
		MyDayDate: body.MyDayDate, RepeatRule: body.RepeatRule, Tags: body.Tags, Steps: body.Steps,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": todo})
}

func (s *Server) listTodos(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	items, err := s.service.ListTodos(r.Context(), claimsFromContext(r.Context()).Subject, service.ListTodosInput{
		View: query.Get("view"), ListID: query.Get("list_id"), Status: domain.TodoStatus(query.Get("status")),
		Priority: domain.TaskPriority(query.Get("priority")), Tag: query.Get("tag"), Query: query.Get("q"), Date: query.Get("date"),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) changeTodoStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Completed bool `json:"completed"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	todo, next, err := s.service.CompleteTodo(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"), body.Completed)
	if err != nil {
		writeError(w, err)
		return
	}
	response := envelope{"data": todo}
	if next != nil {
		response["next"] = next
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) addTodoToMyDay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Date string `json:"date"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	todo, err := s.service.SetTodoMyDay(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"), strings.TrimSpace(body.Date))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": todo})
}

func (s *Server) removeTodoFromMyDay(w http.ResponseWriter, r *http.Request) {
	todo, err := s.service.RemoveTodoMyDay(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": todo})
}

func (s *Server) toggleTodoStep(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Completed bool `json:"completed"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	todo, err := s.service.ToggleTodoStep(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id"), r.PathValue("step_id"), body.Completed)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": todo})
}

func (s *Server) deleteTodo(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteTodo(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("todo_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
