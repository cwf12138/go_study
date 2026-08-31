package httpapi

import (
	"net/http"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) calendarOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.service.CalendarOverview(r.Context(), claimsFromContext(r.Context()).Subject, r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": overview})
}

func (s *Server) calendarDay(w http.ResponseWriter, r *http.Request) {
	detail, err := s.service.CalendarDay(r.Context(), r.PathValue("date"), r.URL.Query().Get("history") == "true")
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": detail})
}

func (s *Server) createCalendarEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title           string                    `json:"title"`
		Description     string                    `json:"description"`
		Location        string                    `json:"location"`
		Category        string                    `json:"category"`
		Color           string                    `json:"color"`
		StartAt         time.Time                 `json:"start_at"`
		EndAt           time.Time                 `json:"end_at"`
		AllDay          bool                      `json:"all_day"`
		RepeatRule      domain.CalendarRepeatRule `json:"repeat_rule"`
		RepeatUntil     *time.Time                `json:"repeat_until"`
		ReminderMinutes int                       `json:"reminder_minutes"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	event, err := s.service.CreateCalendarEvent(r.Context(), claimsFromContext(r.Context()).Subject, service.CreateCalendarEventInput{
		Title: body.Title, Description: body.Description, Location: body.Location, Category: body.Category, Color: body.Color,
		StartAt: body.StartAt, EndAt: body.EndAt, AllDay: body.AllDay, RepeatRule: body.RepeatRule, RepeatUntil: body.RepeatUntil, ReminderMinutes: body.ReminderMinutes,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, envelope{"data": event})
}

func (s *Server) updateCalendarEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title            *string                    `json:"title"`
		Description      *string                    `json:"description"`
		Location         *string                    `json:"location"`
		Category         *string                    `json:"category"`
		Color            *string                    `json:"color"`
		StartAt          *time.Time                 `json:"start_at"`
		EndAt            *time.Time                 `json:"end_at"`
		AllDay           *bool                      `json:"all_day"`
		RepeatRule       *domain.CalendarRepeatRule `json:"repeat_rule"`
		RepeatUntil      *time.Time                 `json:"repeat_until"`
		ClearRepeatUntil bool                       `json:"clear_repeat_until"`
		ReminderMinutes  *int                       `json:"reminder_minutes"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	event, err := s.service.UpdateCalendarEvent(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("event_id"), service.UpdateCalendarEventInput{
		Title: body.Title, Description: body.Description, Location: body.Location, Category: body.Category, Color: body.Color,
		StartAt: body.StartAt, EndAt: body.EndAt, AllDay: body.AllDay, RepeatRule: body.RepeatRule, RepeatUntil: body.RepeatUntil,
		ClearRepeatUntil: body.ClearRepeatUntil, ReminderMinutes: body.ReminderMinutes,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": event})
}

func (s *Server) deleteCalendarEvent(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteCalendarEvent(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("event_id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
