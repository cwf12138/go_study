package httpapi

import (
	"net/http"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) searchEBooks(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.service.SearchEBooks(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": catalog})
}
func (s *Server) listEBookShelf(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListEBookReadings(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}
func (s *Server) addEBookToShelf(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Book domain.EBookCatalogItem `json:"book"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.AddEBook(r.Context(), claimsFromContext(r.Context()).Subject, body.Book)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": reading})
}
func (s *Server) ebookContent(w http.ResponseWriter, r *http.Request) {
	content, err := s.service.EBookContent(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": content})
}
func (s *Server) updateEBookProgress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PageIndex           int    `json:"page_index"`
		TotalPages          int    `json:"total_pages"`
		ReadingSecondsDelta int    `json:"reading_seconds_delta"`
		Status              string `json:"status"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.UpdateEBookProgress(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), service.UpdateEBookProgressInput{PageIndex: body.PageIndex, TotalPages: body.TotalPages, ReadingSecondsDelta: body.ReadingSecondsDelta, Status: body.Status})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": reading})
}
func (s *Server) addEBookBookmark(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PageIndex int    `json:"page_index"`
		Label     string `json:"label"`
		Excerpt   string `json:"excerpt"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.AddEBookBookmark(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), body.PageIndex, body.Label, body.Excerpt)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": reading})
}
func (s *Server) deleteEBookBookmark(w http.ResponseWriter, r *http.Request) {
	reading, err := s.service.DeleteEBookBookmark(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), r.PathValue("bookmark_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": reading})
}
func (s *Server) addEBookNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PageIndex int    `json:"page_index"`
		Content   string `json:"content"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	reading, err := s.service.AddEBookNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), body.PageIndex, body.Content)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": reading})
}
func (s *Server) deleteEBookNote(w http.ResponseWriter, r *http.Request) {
	reading, err := s.service.DeleteEBookNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id"), r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": reading})
}
func (s *Server) deleteEBookFromShelf(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteEBookReading(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("reading_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listClassicalWorks(w http.ResponseWriter, r *http.Request) {
	items := s.service.ListClassicalWorks(r.URL.Query().Get("q"), r.URL.Query().Get("dynasty"), r.URL.Query().Get("genre"))
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items), "translation_source": "StudyFlow learning translation"}})
}
func (s *Server) classicalWork(w http.ResponseWriter, r *http.Request) {
	work, err := s.service.ClassicalWork(r.PathValue("work_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": work})
}
func (s *Server) listClassicalStudies(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListClassicalStudies(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}
func (s *Server) updateClassicalStudy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Favorite            *bool   `json:"favorite"`
		Status              *string `json:"status"`
		Notes               *string `json:"notes"`
		IncrementRecitation bool    `json:"increment_recitation"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	study, err := s.service.UpdateClassicalStudy(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("work_id"), service.UpdateClassicalStudyInput{Favorite: body.Favorite, Status: body.Status, Notes: body.Notes, IncrementRecitation: body.IncrementRecitation})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": study})
}
func (s *Server) literatureOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.service.LiteratureOverview(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": overview})
}
