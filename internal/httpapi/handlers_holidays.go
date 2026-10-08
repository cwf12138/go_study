package httpapi

import "net/http"

func (s *Server) nextHoliday(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, envelope{"data": s.service.NextHoliday()})
}
