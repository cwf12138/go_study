package httpapi

import (
	"net/http"
	"strings"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) upsertMoodEntry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mood       domain.Mood `json:"mood"`
		Note       string      `json:"note"`
		Activities []string    `json:"activities"`
		Tags       []string    `json:"tags"`
		Stress     int         `json:"stress"`
		Energy     int         `json:"energy"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	entry, err := s.service.SaveMoodEntry(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("date"), service.SaveMoodEntryInput{
		Mood: body.Mood, Note: body.Note, Activities: body.Activities, Tags: body.Tags, Stress: body.Stress, Energy: body.Energy,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": entry})
}

func (s *Server) listMoodEntries(w http.ResponseWriter, r *http.Request) {
	entries, err := s.service.ListMoodEntries(r.Context(), claimsFromContext(r.Context()).Subject, strings.TrimSpace(r.URL.Query().Get("month")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": entries, "meta": envelope{"count": len(entries)}})
}

func (s *Server) moodInsights(w http.ResponseWriter, r *http.Request) {
	insights, err := s.service.MoodInsights(r.Context(), claimsFromContext(r.Context()).Subject, strings.TrimSpace(r.URL.Query().Get("month")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": insights})
}

func (s *Server) deleteMoodEntry(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteMoodEntry(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("date")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
