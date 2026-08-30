package httpapi

import (
	"net/http"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) plannerPreferences(w http.ResponseWriter, r *http.Request) {
	preferences, err := s.service.PlannerPreferences(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": preferences})
}

func (s *Server) savePlannerPreferences(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TimeZone        string                      `json:"time_zone"`
		SessionMinutes  int                         `json:"session_minutes"`
		BreakMinutes    int                         `json:"break_minutes"`
		DailyMaxMinutes int                         `json:"daily_max_minutes"`
		Windows         []domain.AvailabilityWindow `json:"windows"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	preferences, err := s.service.SavePlannerPreferences(r.Context(), claimsFromContext(r.Context()).Subject, service.SavePlannerPreferencesInput{
		TimeZone: body.TimeZone, SessionMinutes: body.SessionMinutes, BreakMinutes: body.BreakMinutes,
		DailyMaxMinutes: body.DailyMaxMinutes, Windows: body.Windows,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": preferences})
}

func (s *Server) planWeek(w http.ResponseWriter, r *http.Request) {
	week, err := s.service.PlanWeek(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("week_start"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": week})
}

func (s *Server) generatePlanWeek(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WeekStart string `json:"week_start"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	week, err := s.service.GeneratePlanWeek(r.Context(), claimsFromContext(r.Context()).Subject, body.WeekStart)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": week})
}

func (s *Server) createPlanBlock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind     domain.PlanBlockKind `json:"kind"`
		SourceID string               `json:"source_id"`
		Title    string               `json:"title"`
		Notes    string               `json:"notes"`
		StartAt  time.Time            `json:"start_at"`
		EndAt    time.Time            `json:"end_at"`
		Priority domain.TaskPriority  `json:"priority"`
		Locked   bool                 `json:"locked"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	block, err := s.service.CreatePlanBlock(r.Context(), claimsFromContext(r.Context()).Subject, service.CreatePlanBlockInput{
		Kind: body.Kind, SourceID: body.SourceID, Title: body.Title, Notes: body.Notes,
		StartAt: body.StartAt, EndAt: body.EndAt, Priority: body.Priority, Locked: body.Locked,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": block})
}

func (s *Server) updatePlanBlock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title    *string              `json:"title"`
		Notes    *string              `json:"notes"`
		StartAt  *time.Time           `json:"start_at"`
		EndAt    *time.Time           `json:"end_at"`
		Priority *domain.TaskPriority `json:"priority"`
		Locked   *bool                `json:"locked"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	block, err := s.service.UpdatePlanBlock(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("block_id"), service.UpdatePlanBlockInput{
		Title: body.Title, Notes: body.Notes, StartAt: body.StartAt, EndAt: body.EndAt, Priority: body.Priority, Locked: body.Locked,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": block})
}

func (s *Server) changePlanBlockStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status         domain.PlanBlockStatus `json:"status"`
		CompleteSource bool                   `json:"complete_source"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	block, err := s.service.ChangePlanBlockStatus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("block_id"), body.Status, body.CompleteSource)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": block})
}

func (s *Server) deletePlanBlock(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeletePlanBlock(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("block_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
