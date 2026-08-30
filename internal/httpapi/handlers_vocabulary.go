package httpapi

import (
	"net/http"
	"strconv"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) createWordBook(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		Language      string `json:"language"`
		DailyNewLimit int    `json:"daily_new_limit"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	book, err := s.service.CreateWordBook(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateWordBookInput{Name: body.Name, Description: body.Description, Language: body.Language, DailyNewLimit: body.DailyNewLimit})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": book})
}

func (s *Server) listWordBooks(w http.ResponseWriter, r *http.Request) {
	books, err := s.service.ListWordBooks(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": books, "meta": envelope{"count": len(books)}})
}

func (s *Server) createVocabularyWord(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Term               string   `json:"term"`
		Phonetic           string   `json:"phonetic"`
		Definition         string   `json:"definition"`
		Example            string   `json:"example"`
		ExampleTranslation string   `json:"example_translation"`
		Notes              string   `json:"notes"`
		Tags               []string `json:"tags"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	word, err := s.service.CreateVocabularyWord(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("book_id"), service.CreateVocabularyWordInput{
		Term: body.Term, Phonetic: body.Phonetic, Definition: body.Definition, Example: body.Example,
		ExampleTranslation: body.ExampleTranslation, Notes: body.Notes, Tags: body.Tags,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": word})
}

func (s *Server) listVocabularyWords(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListVocabularyWords(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("book_id"), r.URL.Query().Get("q"), domain.VocabularyStage(r.URL.Query().Get("stage")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) vocabularyQueue(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.service.VocabularyQueue(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("book_id"), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) vocabularyOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.service.VocabularyOverview(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("book_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": overview})
}

func (s *Server) reviewVocabularyWord(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Rating domain.ReviewRating `json:"rating"`
		Mode   string              `json:"mode"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	word, review, err := s.service.ReviewVocabularyWord(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("word_id"), body.Rating, body.Mode)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": envelope{"word": word, "review": review}})
}

func (s *Server) deleteVocabularyWord(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteVocabularyWord(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("word_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
