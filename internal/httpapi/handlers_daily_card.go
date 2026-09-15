package httpapi

import "net/http"

func (s *Server) drawDailyCard(w http.ResponseWriter, r *http.Request) {
	card, err := s.service.DrawDailyCard(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": card})
}

func (s *Server) dailyCard(w http.ResponseWriter, r *http.Request) {
	card, err := s.service.DailyCard(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("date"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": card})
}
func (s *Server) saveDailyCard(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Favorite   *bool   `json:"favorite"`
		Reflection *string `json:"reflection"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	card, err := s.service.SaveDailyCard(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("date"), in.Favorite, in.Reflection)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": card})
}
