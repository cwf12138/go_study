package service

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
)

const maxCalendarOccurrences = 5000
const maxOccurrenceOverrides = 100

func recurrenceBase(event domain.CalendarEvent) time.Time {
	if event.AllDay {
		return event.StartAt.In(calendarWallLocation)
	}
	return event.StartAt.In(calendarLocation)
}

func hasCalendarSlot(event domain.CalendarEvent, slot time.Time) bool {
	switch event.RepeatRule {
	case domain.CalendarRepeatDaily, domain.CalendarRepeatWeekly, domain.CalendarRepeatMonthly, domain.CalendarRepeatYearly:
	default:
		return false
	}
	if slot.IsZero() || slot.Before(event.StartAt) || event.RepeatUntil != nil && slot.After(*event.RepeatUntil) {
		return false
	}
	base := recurrenceBase(event)
	index := sort.Search(maxCalendarOccurrences, func(i int) bool {
		return !recurrenceAt(base, event.RepeatRule, i).Before(slot)
	})
	return index < maxCalendarOccurrences && recurrenceAt(base, event.RepeatRule, index).Equal(slot)
}

func occurrenceOverrideIndex(series domain.CalendarEvent, slot time.Time) int {
	for i, override := range series.OccurrenceOverrides {
		if override.OriginalStart.Equal(slot) {
			return i
		}
	}
	return -1
}

func applyOccurrenceOverride(series domain.CalendarEvent, override domain.CalendarOccurrenceOverride) domain.CalendarEvent {
	series.Title, series.Description, series.Location = override.Title, override.Description, override.Location
	series.Category, series.Color = override.Category, override.Color
	series.StartAt, series.EndAt = override.StartAt, override.EndAt
	series.AllDay, series.ReminderMinutes = override.AllDay, override.ReminderMinutes
	return series
}

func calendarSlot(series domain.CalendarEvent, slot time.Time) domain.CalendarOccurrence {
	event := series
	event.StartAt, event.EndAt = slot, slot.Add(series.EndAt.Sub(series.StartAt))
	index := occurrenceOverrideIndex(series, slot)
	if index >= 0 {
		event = applyOccurrenceOverride(series, series.OccurrenceOverrides[index])
	}
	event.RepeatRule, event.RepeatUntil = domain.CalendarRepeatNone, nil
	return makeRecurringOccurrence(event, slot, event.StartAt, event.EndAt, index >= 0)
}

func (s *Service) CalendarSlot(ctx context.Context, userID, id string, slot time.Time) (domain.CalendarOccurrence, error) {
	series, err := s.CalendarEvent(ctx, userID, id)
	if err != nil {
		return domain.CalendarOccurrence{}, err
	}
	if !hasCalendarSlot(series, slot) {
		return domain.CalendarOccurrence{}, domain.ErrNotFound
	}
	return calendarSlot(series, slot.UTC()), nil
}

// A nil replacement restores the generated occurrence. Both operations share
// the series version so that series edits and single-slot writes cannot race.
func (s *Service) SetCalendarSlot(ctx context.Context, userID, id string, slot time.Time, replacement *CreateCalendarEventInput, expected string) (domain.CalendarOccurrence, error) {
	series, err := s.calendarForChange(ctx, userID, id, []string{expected})
	if err != nil {
		return domain.CalendarOccurrence{}, err
	}
	if !hasCalendarSlot(series, slot) {
		return domain.CalendarOccurrence{}, domain.ErrNotFound
	}
	slot = slot.UTC()
	index := occurrenceOverrideIndex(series, slot)
	if replacement == nil {
		if index >= 0 {
			series.OccurrenceOverrides = append(series.OccurrenceOverrides[:index], series.OccurrenceOverrides[index+1:]...)
		}
	} else {
		if (replacement.RepeatRule != "" && replacement.RepeatRule != domain.CalendarRepeatNone) || replacement.RepeatUntil != nil {
			return domain.CalendarOccurrence{}, fmt.Errorf("%w: a single occurrence cannot repeat", domain.ErrInvalidInput)
		}
		event, err := newCalendarEvent(*replacement)
		if err != nil {
			return domain.CalendarOccurrence{}, err
		}
		override := domain.CalendarOccurrenceOverride{OriginalStart: slot, StartAt: event.StartAt, EndAt: event.EndAt,
			Title: event.Title, Description: event.Description, Location: event.Location, Category: event.Category,
			Color: event.Color, AllDay: event.AllDay, ReminderMinutes: event.ReminderMinutes}
		if index >= 0 {
			series.OccurrenceOverrides[index] = override
		} else {
			if len(series.OccurrenceOverrides) >= maxOccurrenceOverrides {
				return domain.CalendarOccurrence{}, fmt.Errorf("%w: series already has %d adjusted occurrences", domain.ErrInvalidInput, maxOccurrenceOverrides)
			}
			series.OccurrenceOverrides = append(series.OccurrenceOverrides, override)
		}
	}
	previous := series.UpdatedAt
	series.UpdatedAt = s.nextRecordTime(previous)
	writer, err := s.calendarWriter()
	if err != nil {
		return domain.CalendarOccurrence{}, err
	}
	if err := writer.UpdateCalendarEventIfUnchanged(ctx, series, previous); err != nil {
		return domain.CalendarOccurrence{}, err
	}
	s.publish("calendar_event.updated", userID, series.ID, nil)
	return calendarSlot(series, slot), nil
}
