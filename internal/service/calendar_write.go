package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/example/studyflow/internal/domain"
)

type calendarVersionRepository interface {
	UpdateCalendarEventIfUnchanged(context.Context, domain.CalendarEvent, time.Time) error
	DeleteCalendarEventIfUnchanged(context.Context, string, string, time.Time) error
}
type calendarCommandRepository interface {
	CreateCalendarCommand(context.Context, domain.CalendarCommandReceipt, domain.CalendarEvent) (domain.CalendarCommandReceipt, bool, error)
	CalendarCommandByID(context.Context, string) (domain.CalendarCommandReceipt, error)
	ListCalendarCommands(context.Context, string) ([]domain.CalendarCommandReceipt, error)
}

func CalendarVersion(event domain.CalendarEvent) string {
	return event.ID + "@" + event.UpdatedAt.Format(time.RFC3339Nano)
}
func (s *Service) CalendarEvent(ctx context.Context, userID, id string) (domain.CalendarEvent, error) {
	event, err := s.repo.CalendarEventByID(ctx, id)
	if err != nil {
		return event, err
	}
	return event, requireOwner(event.UserID, userID)
}
func (s *Service) calendarForChange(ctx context.Context, userID, id string, expected []string) (domain.CalendarEvent, error) {
	event, err := s.CalendarEvent(ctx, userID, id)
	if err != nil {
		return event, err
	}
	if len(expected) > 1 {
		return event, domain.ErrInvalidInput
	}
	if len(expected) == 1 && expected[0] != CalendarVersion(event) {
		return event, domain.ErrConflict
	}
	return event, nil
}
func (s *Service) calendarWriter() (calendarVersionRepository, error) {
	r, ok := s.repo.(calendarVersionRepository)
	if !ok {
		return nil, fmt.Errorf("%w: calendar versions unavailable", domain.ErrInvalidState)
	}
	return r, nil
}
func trimCalendar(value string) string {
	return strings.TrimFunc(value, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' })
}

var calendarWallLocation = time.FixedZone("Beijing", 8*60*60)

func normalizeAllDay(event *domain.CalendarEvent) {
	start, end := event.StartAt.In(calendarWallLocation), event.EndAt.In(calendarWallLocation)
	first := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, calendarWallLocation)
	last := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, calendarWallLocation)
	if end.After(last) {
		last = last.AddDate(0, 0, 1)
	}
	if !last.After(first) {
		last = first.AddDate(0, 0, 1)
	}
	event.StartAt, event.EndAt = first.UTC(), last.UTC()
}
func newCalendarEvent(input CreateCalendarEventInput) (domain.CalendarEvent, error) {
	event := domain.CalendarEvent{Title: trimCalendar(input.Title), Description: trimCalendar(input.Description), Location: trimCalendar(input.Location), Category: trimCalendar(input.Category), Color: strings.ToLower(trimCalendar(input.Color)), StartAt: input.StartAt.UTC(), EndAt: input.EndAt.UTC(), AllDay: input.AllDay, RepeatRule: input.RepeatRule, RepeatUntil: input.RepeatUntil, ReminderMinutes: input.ReminderMinutes}
	if event.AllDay && !event.StartAt.IsZero() && event.EndAt.After(event.StartAt) {
		normalizeAllDay(&event)
	}
	if event.RepeatUntil != nil {
		until := event.RepeatUntil.UTC()
		event.RepeatUntil = &until
	}
	err := validateCalendarEvent(&event)
	return event, err
}

type CreateCalendarCommandInput struct {
	SchemaVersion int    `json:"schema_version"`
	RequestID     string `json:"request_id"`
	CreateCalendarEventInput
}
type CalendarCommandResult struct {
	Created bool                          `json:"created"`
	Receipt domain.CalendarCommandReceipt `json:"receipt"`
	Event   *domain.CalendarEvent         `json:"event"`
}

var calendarCommandID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,100}$`)

func calendarFingerprint(event domain.CalendarEvent) string {
	until := ""
	if event.RepeatUntil != nil {
		until = event.RepeatUntil.UTC().Format(time.RFC3339Nano)
	}
	h := sha256.New()
	for _, part := range []string{"daynest.calendar-create.v1", event.Title, event.Description, event.Location, event.Category, event.Color, event.StartAt.UTC().Format(time.RFC3339Nano), event.EndAt.UTC().Format(time.RFC3339Nano), strconv.FormatBool(event.AllDay), string(event.RepeatRule), until, strconv.Itoa(event.ReminderMinutes)} {
		fmt.Fprintf(h, "%d:", len(part))
		h.Write([]byte(part))
	}
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Service) CreateCalendarCommand(ctx context.Context, userID string, in CreateCalendarCommandInput) (CalendarCommandResult, error) {
	var out CalendarCommandResult
	if in.SchemaVersion != 1 || !calendarCommandID.MatchString(in.RequestID) {
		return out, domain.ErrInvalidInput
	}
	event, err := newCalendarEvent(in.CreateCalendarEventInput)
	if err != nil {
		return out, err
	}
	repo, ok := s.repo.(calendarCommandRepository)
	if !ok {
		return out, domain.ErrInvalidState
	}
	id, now := actionHash(userID, in.RequestID), s.now().UTC()
	event.ID, event.UserID, event.CreatedAt, event.UpdatedAt = "calendar-create-"+id, userID, now, now
	receipt := domain.CalendarCommandReceipt{ID: "calendar-command-" + id, UserID: userID, RequestID: in.RequestID, EventID: event.ID, SchemaVersion: 1, Fingerprint: calendarFingerprint(event), CreatedAt: now}
	actual, created, err := repo.CreateCalendarCommand(ctx, receipt, event)
	if err != nil {
		return out, err
	}
	out, err = s.calendarCommandResult(ctx, userID, actual)
	out.Created = created
	if created {
		s.publish("calendar_event.created", userID, event.ID, nil)
	}
	return out, err
}
func (s *Service) CalendarCommand(ctx context.Context, userID, requestID string) (CalendarCommandResult, error) {
	if !calendarCommandID.MatchString(requestID) {
		return CalendarCommandResult{}, domain.ErrInvalidInput
	}
	repo, ok := s.repo.(calendarCommandRepository)
	if !ok {
		return CalendarCommandResult{}, domain.ErrInvalidState
	}
	receipt, err := repo.CalendarCommandByID(ctx, "calendar-command-"+actionHash(userID, requestID))
	if err != nil {
		return CalendarCommandResult{}, err
	}
	return s.calendarCommandResult(ctx, userID, receipt)
}
func (s *Service) calendarCommandResult(ctx context.Context, userID string, receipt domain.CalendarCommandReceipt) (CalendarCommandResult, error) {
	out := CalendarCommandResult{Receipt: receipt}
	if receipt.UserID != userID {
		return out, domain.ErrForbidden
	}
	event, err := s.CalendarEvent(ctx, userID, receipt.EventID)
	if err == nil {
		out.Event = &event
	} else if !errors.Is(err, domain.ErrNotFound) {
		return out, err
	}
	return out, nil
}
