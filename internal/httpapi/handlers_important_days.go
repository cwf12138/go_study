package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listImportantDays(w http.ResponseWriter, r *http.Request) {
	rows, err := s.service.ListImportantDays(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": rows})
}
func (s *Server) saveImportantDay(w http.ResponseWriter, r *http.Request) {
	var in service.SaveImportantDayInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.SaveImportantDay(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": row})
}
