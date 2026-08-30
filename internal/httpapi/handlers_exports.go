package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func (s *Server) exportUserData(w http.ResponseWriter, r *http.Request) {
	bundle, err := s.service.ExportUserData(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="studyflow-backup-`+time.Now().Format("2006-01-02")+`.json"`)
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(bundle); err != nil {
		return
	}
}

func (s *Server) exportLearningCSV(w http.ResponseWriter, r *http.Request) {
	days := 30
	if value := r.URL.Query().Get("days"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(w, fmt.Errorf("%w: days must be an integer", domain.ErrInvalidInput))
			return
		}
		days = parsed
	}
	data, err := s.service.ExportLearningCSV(r.Context(), claimsFromContext(r.Context()).Subject, days, r.URL.Query().Get("time_zone"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="studyflow-learning-%dd.csv"`, days))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) exportPlanCalendar(w http.ResponseWriter, r *http.Request) {
	data, filename, err := s.service.ExportPlanCalendar(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("week_start"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
