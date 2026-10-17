package httpapi

import (
	"net/http"
	"time"

	"github.com/example/studyflow/internal/service"
)

func (s *Server) listNutrition(w http.ResponseWriter, r *http.Request) {
	rows, err := s.service.ListNutrition(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		fitnessError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": envelope{"catalog": service.NutritionCatalog(), "entries": rows}, "server_time": time.Now().UTC()})
}
func (s *Server) saveNutrition(w http.ResponseWriter, r *http.Request) {
	var in service.SaveNutritionInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	row, err := s.service.SaveNutrition(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		fitnessError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": row, "server_time": time.Now().UTC()})
}
