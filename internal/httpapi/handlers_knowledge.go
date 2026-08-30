package httpapi

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) createKnowledgeNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Tags    []string `json:"tags"`
		Pinned  bool     `json:"pinned"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	detail, err := s.service.CreateKnowledgeNote(r.Context(), claimsFromContext(r.Context()).Subject, service.SaveKnowledgeNoteInput{Title: body.Title, Content: body.Content, Tags: body.Tags, Pinned: body.Pinned})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": detail})
}

func (s *Server) listKnowledgeNotes(w http.ResponseWriter, r *http.Request) {
	var pinned *bool
	if value := r.URL.Query().Get("pinned"); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			writeError(w, fmt.Errorf("%w: pinned must be true or false", domain.ErrInvalidInput))
			return
		}
		pinned = &parsed
	}
	items, err := s.service.ListKnowledgeNotes(r.Context(), claimsFromContext(r.Context()).Subject, service.ListKnowledgeNotesInput{Query: r.URL.Query().Get("q"), Tag: r.URL.Query().Get("tag"), Pinned: pinned})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) knowledgeNote(w http.ResponseWriter, r *http.Request) {
	detail, err := s.service.KnowledgeNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": detail})
}

func (s *Server) updateKnowledgeNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title   *string   `json:"title"`
		Content *string   `json:"content"`
		Tags    *[]string `json:"tags"`
		Pinned  *bool     `json:"pinned"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	detail, err := s.service.UpdateKnowledgeNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"), service.UpdateKnowledgeNoteInput{Title: body.Title, Content: body.Content, Tags: body.Tags, Pinned: body.Pinned})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": detail})
}

func (s *Server) deleteKnowledgeNote(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteKnowledgeNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) knowledgeGraph(w http.ResponseWriter, r *http.Request) {
	graph, err := s.service.KnowledgeGraph(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": graph})
}
