package httpapi

import (
	"net/http"

	"github.com/example/studyflow/internal/service"
)

func (s *Server) startFocus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TaskID         string `json:"task_id"`
		PlanBlockID    string `json:"plan_block_id"`
		PlannedMinutes int    `json:"planned_minutes"`
		BreakEnabled   bool   `json:"break_enabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	session, err := s.service.StartFocus(r.Context(), claimsFromContext(r.Context()).Subject, service.StartFocusInput{
		TaskID: body.TaskID, PlanBlockID: body.PlanBlockID, PlannedMinutes: body.PlannedMinutes, BreakEnabled: body.BreakEnabled,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": session})
}

func (s *Server) pauseFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.PauseFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) resumeFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.ResumeFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) advanceFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.AdvanceFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) activeFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.ActiveFocus(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) finishFocus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Abandoned bool `json:"abandoned"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	session, err := s.service.FinishFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"), body.Abandoned)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.Dashboard(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
