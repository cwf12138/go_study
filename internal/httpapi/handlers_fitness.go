package httpapi

import (
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
	"net/http"
	"time"
)

func fitnessError(w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrConflict) {
		writeJSON(w, 409, envelope{"error": envelope{"code": "fitness_conflict", "message": err.Error()}})
		return
	}
	writeError(w, err)
}
func (s *Server) fitnessResult(w http.ResponseWriter, r *http.Request, row domain.FitnessEntry) {
	result := envelope{"data": row, "server_time": time.Now().UTC()}
	if row.PlanID != "" {
		if plan, err := s.service.FitnessEntry(r.Context(), claimsFromContext(r.Context()).Subject, row.PlanID); err == nil {
			result["related_plan"] = plan
		}
	}
	writeJSON(w, 200, result)
}
func (s *Server) listFitness(w http.ResponseWriter, r *http.Request) {
	rows, err := s.service.ListFitness(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		fitnessError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": rows, "server_time": time.Now().UTC()})
}
func (s *Server) saveFitness(w http.ResponseWriter, r *http.Request) {
	var in service.SaveFitnessInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.SaveFitness(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		fitnessError(w, err)
		return
	}
	s.fitnessResult(w, r, row)
}
func (s *Server) startFitness(w http.ResponseWriter, r *http.Request) {
	var in service.StartFitnessInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.StartFitness(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		fitnessError(w, err)
		return
	}
	s.fitnessResult(w, r, row)
}
func (s *Server) fitnessAction(w http.ResponseWriter, r *http.Request) {
	var in service.FitnessActionInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.FitnessAction(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		fitnessError(w, err)
		return
	}
	s.fitnessResult(w, r, row)
}
