package httpapi

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) createDeck(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	deck, err := s.service.CreateDeck(r.Context(), claimsFromContext(r.Context()).Subject, body.Name, body.Description)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": deck})
}

func (s *Server) listDecks(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListDecks(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) createCard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Prompt string `json:"prompt"`
		Answer string `json:"answer"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	card, err := s.service.CreateCard(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("deck_id"), body.Prompt, body.Answer)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": card})
}

func (s *Server) dueCards(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 {
			writeError(w, fmt.Errorf("%w: limit must be a positive integer", domain.ErrInvalidInput))
			return
		}
		limit = parsed
	}
	items, err := s.service.DueCards(r.Context(), claimsFromContext(r.Context()).Subject, limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": items, "meta": envelope{"count": len(items)}})
}

func (s *Server) reviewCard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Rating domain.ReviewRating `json:"rating"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	card, review, err := s.service.ReviewCard(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("card_id"), body.Rating)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": envelope{"card": card, "review": review}})
}

func (s *Server) startFocus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TaskID         string `json:"task_id"`
		PlannedMinutes int    `json:"planned_minutes"`
		BreakEnabled   bool   `json:"break_enabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	session, err := s.service.StartFocus(r.Context(), claimsFromContext(r.Context()).Subject, service.StartFocusInput{
		TaskID: body.TaskID, PlannedMinutes: body.PlannedMinutes, BreakEnabled: body.BreakEnabled,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": session})
}

func (s *Server) pauseFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.PauseFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) resumeFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.ResumeFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) advanceFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.AdvanceFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) activeFocus(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.ActiveFocus(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) finishFocus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Abandoned bool `json:"abandoned"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	session, err := s.service.FinishFocus(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("session_id"), body.Abandoned)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": session})
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.Dashboard(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": result})
}
