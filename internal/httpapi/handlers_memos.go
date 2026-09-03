package httpapi

import (
	"net/http"

	"github.com/example/studyflow/internal/service"
)

func (s *Server) createMemoFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		Color     string `json:"color"`
		SortOrder int    `json:"sort_order"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	folder, err := s.service.CreateMemoFolder(r.Context(), claimsFromContext(r.Context()).Subject, service.SaveMemoFolderInput{Name: body.Name, Color: body.Color, SortOrder: body.SortOrder})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": folder})
}

func (s *Server) listMemoFolders(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListMemoFolders(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) updateMemoFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      *string `json:"name"`
		Color     *string `json:"color"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	folder, err := s.service.UpdateMemoFolder(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("folder_id"), service.UpdateMemoFolderInput{Name: body.Name, Color: body.Color, SortOrder: body.SortOrder})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": folder})
}

func (s *Server) deleteMemoFolder(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteMemoFolder(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("folder_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createMemoNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FolderID string   `json:"folder_id"`
		Title    string   `json:"title"`
		Content  string   `json:"content"`
		Tags     []string `json:"tags"`
		Color    string   `json:"color"`
		Pinned   bool     `json:"pinned"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	note, err := s.service.CreateMemoNote(r.Context(), claimsFromContext(r.Context()).Subject, service.SaveMemoNoteInput{FolderID: body.FolderID, Title: body.Title, Content: body.Content, Tags: body.Tags, Color: body.Color, Pinned: body.Pinned})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": note})
}

func (s *Server) listMemoNotes(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	items, err := s.service.ListMemoNotes(r.Context(), claimsFromContext(r.Context()).Subject, service.ListMemoNotesInput{Query: query.Get("q"), FolderID: query.Get("folder_id"), Tag: query.Get("tag"), View: query.Get("view"), Sort: query.Get("sort"), Order: query.Get("order")})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) memoOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.service.MemoOverview(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": overview})
}

func (s *Server) memoNote(w http.ResponseWriter, r *http.Request) {
	note, err := s.service.MemoNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": note})
}

func (s *Server) updateMemoNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FolderID *string   `json:"folder_id"`
		Title    *string   `json:"title"`
		Content  *string   `json:"content"`
		Tags     *[]string `json:"tags"`
		Color    *string   `json:"color"`
		Pinned   *bool     `json:"pinned"`
		Archived *bool     `json:"archived"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	note, err := s.service.UpdateMemoNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"), service.UpdateMemoNoteInput{FolderID: body.FolderID, Title: body.Title, Content: body.Content, Tags: body.Tags, Color: body.Color, Pinned: body.Pinned, Archived: body.Archived})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": note})
}

func (s *Server) trashMemoNote(w http.ResponseWriter, r *http.Request) {
	if err := s.service.TrashMemoNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restoreMemoNote(w http.ResponseWriter, r *http.Request) {
	note, err := s.service.RestoreMemoNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": note})
}

func (s *Server) deleteMemoNotePermanently(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteMemoNotePermanently(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) duplicateMemoNote(w http.ResponseWriter, r *http.Request) {
	note, err := s.service.DuplicateMemoNote(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("note_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": note})
}
