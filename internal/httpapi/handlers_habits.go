package httpapi

import (
	"fmt"
	"net/http"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) listHabits(w http.ResponseWriter, r *http.Request) {
	data, err := s.service.ListHabits(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": data})
}
func (s *Server) createHabit(w http.ResponseWriter, r *http.Request) {
	var in service.CreateHabitInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	data, err := s.service.CreateHabit(r.Context(), claimsFromContext(r.Context()).Subject, in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": data})
}
func (s *Server) checkHabit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Checked *bool `json:"checked"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	if in.Checked == nil {
		writeError(w, fmt.Errorf("%w: checked 必须为布尔值", domain.ErrInvalidInput))
		return
	}
	data, err := s.service.CheckHabit(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("habit_id"), r.PathValue("date"), *in.Checked)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": data})
}
func (s *Server) archiveHabit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Archived *bool `json:"archived"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	if in.Archived == nil {
		writeError(w, fmt.Errorf("%w: archived 必须为布尔值", domain.ErrInvalidInput))
		return
	}
	data, err := s.service.ArchiveHabit(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("habit_id"), *in.Archived)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": data})
}
