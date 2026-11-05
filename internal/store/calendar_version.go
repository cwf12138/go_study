package store

import (
	"context"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func cloneCalendarEvent(event domain.CalendarEvent) domain.CalendarEvent {
	if event.RepeatUntil != nil {
		value := *event.RepeatUntil
		event.RepeatUntil = &value
	}
	return event
}

func (m *Memory) UpdateCalendarEventIfUnchanged(ctx context.Context, event domain.CalendarEvent, expected time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	old, ok := m.calendarEvents[event.ID]
	if !ok {
		return domain.ErrNotFound
	}
	if old.UserID != event.UserID {
		return domain.ErrForbidden
	}
	if !old.UpdatedAt.Equal(expected) {
		return domain.ErrConflict
	}
	if !event.UpdatedAt.After(old.UpdatedAt) {
		return domain.ErrInvalidInput
	}
	m.calendarEvents[event.ID] = cloneCalendarEvent(event)
	return nil
}

func (m *Memory) DeleteCalendarEventIfUnchanged(ctx context.Context, userID, id string, expected time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	old, ok := m.calendarEvents[id]
	if !ok {
		return domain.ErrNotFound
	}
	if old.UserID != userID {
		return domain.ErrForbidden
	}
	if !old.UpdatedAt.Equal(expected) {
		return domain.ErrConflict
	}
	delete(m.calendarEvents, id)
	return nil
}

func (m *Memory) CreateCalendarCommand(ctx context.Context, receipt domain.CalendarCommandReceipt, event domain.CalendarEvent) (domain.CalendarCommandReceipt, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return receipt, false, err
	}
	if _, ok := m.users[receipt.UserID]; !ok {
		return receipt, false, domain.ErrNotFound
	}
	if old, ok := m.calendarCommands[receipt.ID]; ok {
		if old.UserID != receipt.UserID || old.Fingerprint != receipt.Fingerprint {
			return old, false, domain.ErrConflict
		}
		return old, false, nil
	}
	if _, exists := m.calendarEvents[event.ID]; exists {
		return receipt, false, domain.ErrConflict
	}
	if event.ID != receipt.EventID || event.UserID != receipt.UserID {
		return receipt, false, domain.ErrInvalidInput
	}
	m.calendarCommands[receipt.ID] = receipt
	m.calendarEvents[event.ID] = cloneCalendarEvent(event)
	return receipt, true, nil
}

func (m *Memory) CalendarCommandByID(_ context.Context, id string) (domain.CalendarCommandReceipt, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.calendarCommands[id]
	if !ok {
		return row, domain.ErrNotFound
	}
	return row, nil
}
func (m *Memory) ListCalendarCommands(_ context.Context, userID string) ([]domain.CalendarCommandReceipt, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.CalendarCommandReceipt{}
	for _, row := range m.calendarCommands {
		if row.UserID == userID {
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt.After(rows[j].CreatedAt) })
	return rows, nil
}
