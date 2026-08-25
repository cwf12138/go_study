package httpapi

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func (s *Server) createGoal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title         string     `json:"title"`
		Description   string     `json:"description"`
		TargetMinutes int        `json:"target_minutes"`
		Deadline      *time.Time `json:"deadline"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	goal, err := s.service.CreateGoal(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateGoalInput{
		Title: body.Title, Description: body.Description, TargetMinutes: body.TargetMinutes, Deadline: body.Deadline,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": goal})
}

func (s *Server) listGoals(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListGoals(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) changeGoalStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status domain.GoalStatus `json:"status"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	goal, err := s.service.ChangeGoalStatus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("goal_id"), body.Status)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": goal})
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GoalID           string              `json:"goal_id"`
		Title            string              `json:"title"`
		Description      string              `json:"description"`
		EstimatedMinutes int                 `json:"estimated_minutes"`
		Priority         domain.TaskPriority `json:"priority"`
		DueAt            *time.Time          `json:"due_at"`
		Tags             []string            `json:"tags"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	task, err := s.service.CreateTask(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateTaskInput{
		GoalID: body.GoalID, Title: body.Title, Description: body.Description,
		EstimatedMinutes: body.EstimatedMinutes, Priority: body.Priority, DueAt: body.DueAt, Tags: body.Tags,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": task})
}

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	filter := store.TaskFilter{GoalID: strings.TrimSpace(r.URL.Query().Get("goal_id"))}
	if value := r.URL.Query().Get("status"); value != "" {
		filter.Status = domain.TaskStatus(value)
		if filter.Status != domain.TaskTodo && filter.Status != domain.TaskInProgress && filter.Status != domain.TaskDone && filter.Status != domain.TaskCancelled {
			writeError(w, fmt.Errorf("%w: unknown task status", domain.ErrInvalidInput))
			return
		}
	}
	if value := r.URL.Query().Get("due_before"); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			writeError(w, fmt.Errorf("%w: due_before must be RFC3339", domain.ErrInvalidInput))
			return
		}
		filter.DueUntil = &parsed
	}
	items, err := s.service.ListTasks(r.Context(), claimsFromContext(r.Context()).Subject, filter)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) changeTaskStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status domain.TaskStatus `json:"status"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	task, err := s.service.ChangeTaskStatus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("task_id"), body.Status)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": task})
}
