package httpapi

import (
	"github.com/example/studyflow/internal/service"
	"net/http"
)

func (s *Server) listLedger(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListLedger(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": items})
}
func (s *Server) saveLedger(w http.ResponseWriter, r *http.Request) {
	var in service.SaveLedgerInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	item, err := s.service.SaveLedger(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": item})
}
