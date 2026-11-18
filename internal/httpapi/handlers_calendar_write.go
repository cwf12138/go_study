package httpapi

import (
	"net/http"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func calendarETag(w http.ResponseWriter, event domain.CalendarEvent) {
	w.Header().Set("ETag", "\""+service.CalendarVersion(event)+"\"")
}
func (s *Server) getCalendarEvent(w http.ResponseWriter, r *http.Request) {
	event, err := s.service.CalendarEvent(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("event_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	calendarETag(w, event)
	writeJSON(w, http.StatusOK, envelope{"data": event, "meta": envelope{"write_contract": "calendar-if-match-v1"}})
}

func (s *Server) calendarOccurrence(w http.ResponseWriter, r *http.Request) {
	slot, err := time.Parse(time.RFC3339Nano, r.PathValue("original_start"))
	if err != nil {
		writeError(w, domain.ErrInvalidInput)
		return
	}
	ctx, userID, id := r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("event_id")
	var occurrence domain.CalendarOccurrence
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		occurrence, err = s.service.CalendarSlot(ctx, userID, id, slot)
	} else {
		expected, conditionErr := recordCondition(r, "event_id", true)
		if conditionErr != nil {
			writeError(w, conditionErr)
			return
		}
		var replacement *service.CreateCalendarEventInput
		if r.Method == http.MethodPut {
			replacement = &service.CreateCalendarEventInput{}
			if decodeErr := decodeJSON(w, r, replacement); decodeErr != nil {
				writeError(w, invalidJSON(decodeErr))
				return
			}
		}
		occurrence, err = s.service.SetCalendarSlot(ctx, userID, id, slot, replacement, expected[0])
	}
	if err != nil {
		writeError(w, err)
		return
	}
	calendarETag(w, occurrence.CalendarEvent)
	writeJSON(w, http.StatusOK, envelope{"data": occurrence, "meta": envelope{"write_contract": "calendar-occurrence-if-match-v1"}})
}
func (s *Server) createCalendarCommand(w http.ResponseWriter, r *http.Request) {
	var in service.CreateCalendarCommandInput
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	out, err := s.service.CreateCalendarCommand(r.Context(), claimsFromContext(r.Context()).Subject, in)
	if err != nil {
		writeError(w, err)
		return
	}
	status := http.StatusOK
	if out.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, envelope{"data": out})
}
func (s *Server) calendarCommand(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.CalendarCommand(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("request_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": out})
}
