package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
	"time"
)

func cloneHabit(h domain.Habit) domain.Habit {
	h.Checkins = append([]string{}, h.Checkins...)
	return h
}
func (m *Memory) CreateHabit(_ context.Context, h domain.Habit) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.habits[h.ID]; ok {
		return domain.ErrConflict
	}
	count := 0
	for _, item := range m.habits {
		if item.UserID == h.UserID {
			count++
		}
	}
	if count >= 200 {
		return fmt.Errorf("%w: 最多保留 200 个习惯", domain.ErrInvalidInput)
	}
	m.habits[h.ID] = cloneHabit(h)
	return nil
}
func (m *Memory) HabitByID(_ context.Context, id string) (domain.Habit, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	h, ok := m.habits[id]
	if !ok {
		return domain.Habit{}, domain.ErrNotFound
	}
	return cloneHabit(h), nil
}
func (m *Memory) ListHabits(_ context.Context, user string) ([]domain.Habit, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.Habit{}
	for _, h := range m.habits {
		if h.UserID == user {
			items = append(items, cloneHabit(h))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	return items, nil
}
func (m *Memory) SetHabitArchived(_ context.Context, user, id string, archived bool, now time.Time) (domain.Habit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	h, ok := m.habits[id]
	if !ok || h.UserID != user {
		return domain.Habit{}, domain.ErrNotFound
	}
	h.Archived = archived
	h.UpdatedAt = now
	m.habits[id] = h
	return cloneHabit(h), nil
}

// Read/modify/write is atomic, including the archive check; concurrent days cannot overwrite one another.
func (m *Memory) SetHabitCheck(_ context.Context, user, id, date string, checked bool, now time.Time) (domain.Habit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	h, ok := m.habits[id]
	if !ok || h.UserID != user {
		return domain.Habit{}, domain.ErrNotFound
	}
	if h.Archived {
		return domain.Habit{}, fmt.Errorf("%w: 请先恢复已归档习惯", domain.ErrInvalidState)
	}
	h = cloneHabit(h)
	found := -1
	for i, d := range h.Checkins {
		if d == date {
			found = i
			break
		}
	}
	if checked && found < 0 {
		h.Checkins = append(h.Checkins, date)
	}
	if !checked && found >= 0 {
		h.Checkins = append(h.Checkins[:found], h.Checkins[found+1:]...)
	}
	sort.Strings(h.Checkins)
	h.UpdatedAt = now
	m.habits[id] = h
	return cloneHabit(h), nil
}
