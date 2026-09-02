package httpapi

import (
	"net/http"
	"strconv"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) englishArticles(w http.ResponseWriter, r *http.Request) {
	refresh, _ := strconv.ParseBool(r.URL.Query().Get("refresh"))
	feed, err := s.service.EnglishFeed(r.Context(), refresh)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": feed})
}

func (s *Server) listEnglishReadings(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListEnglishReadings(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) saveEnglishReading(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Article  domain.EnglishArticle `json:"article"`
		Notes    string                `json:"notes"`
		NewWords []string              `json:"new_words"`
		Status   string                `json:"status"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.SaveEnglishReading(r.Context(), claimsFromContext(r.Context()).Subject, service.SaveEnglishReadingInput{Article: body.Article, Notes: body.Notes, NewWords: body.NewWords, Status: body.Status})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": reading})
}

func (s *Server) updateEnglishReading(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Notes    *string   `json:"notes"`
		NewWords *[]string `json:"new_words"`
		Status   *string   `json:"status"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.UpdateEnglishReading(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), service.UpdateEnglishReadingInput{Notes: body.Notes, NewWords: body.NewWords, Status: body.Status})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": reading})
}

func (s *Server) deleteEnglishReading(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteEnglishReading(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) englishOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.service.EnglishOverview(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": overview})
}
