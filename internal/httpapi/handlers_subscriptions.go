package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listSubscriptions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.service.ListSubscriptions(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": rows})
}
func (s *Server) saveSubscription(w http.ResponseWriter, r *http.Request) {
	var in service.SaveSubscriptionInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.SaveSubscription(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": row})
}
