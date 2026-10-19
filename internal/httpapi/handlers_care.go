package httpapi

import (
	"net/http"
	"time"

	"github.com/example/studyflow/internal/service"
)

func (s *Server) listCare(w http.ResponseWriter, r *http.Request) {
	rows, e := s.service.ListCare(r.Context(), claimsFromContext(r.Context()).Subject)
	if e != nil {
		fitnessError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": rows, "server_time": time.Now().UTC()})
}
func (s *Server) saveCare(w http.ResponseWriter, r *http.Request) {
	var in service.SaveCareInput
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	row, e := s.service.SaveCare(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if e != nil {
		fitnessError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row, "server_time": time.Now().UTC()})
}
func (s *Server) careAction(w http.ResponseWriter, r *http.Request) {
	var in service.CareActionInput
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	row, e := s.service.CareAction(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if e != nil {
		fitnessError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row, "server_time": time.Now().UTC()})
}
