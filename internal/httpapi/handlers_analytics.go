package httpapi

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) learningInsights(w http.ResponseWriter, r *http.Request) {
	days := 30
	if value := r.URL.Query().Get("days"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(w, fmt.Errorf("%w: days must be an integer", domain.ErrInvalidInput))
			return
		}
		days = parsed
	}
	insights, err := s.service.LearningInsights(r.Context(), claimsFromContext(r.Context()).Subject, days, r.URL.Query().Get("time_zone"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": insights})
}

func (s *Server) weeklyReview(w http.ResponseWriter, r *http.Request) {
	review, err := s.service.WeeklyReview(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("week_start"), r.URL.Query().Get("time_zone"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": review})
}

func (s *Server) saveWeeklyReflection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WeekStart          string   `json:"week_start"`
		Satisfaction       int      `json:"satisfaction"`
		Wins               string   `json:"wins"`
		Challenges         string   `json:"challenges"`
		Lessons            string   `json:"lessons"`
		NextWeekPriorities []string `json:"next_week_priorities"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reflection, err := s.service.SaveWeeklyReflection(r.Context(), claimsFromContext(r.Context()).Subject, service.SaveWeeklyReflectionInput{
		WeekStart: body.WeekStart, Satisfaction: body.Satisfaction, Wins: body.Wins,
		Challenges: body.Challenges, Lessons: body.Lessons, NextWeekPriorities: body.NextWeekPriorities,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": reflection})
}

func (s *Server) listWeeklyReflections(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListWeeklyReflections(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}
