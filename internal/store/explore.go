package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
	"time"
)

func cloneExploration(e domain.Exploration) domain.Exploration {
	if e.CompletedAt != nil {
		t := *e.CompletedAt
		e.CompletedAt = &t
	}
	return e
}
func (m *Memory) CreateExploration(_ context.Context, e domain.Exploration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if old, ok := m.explorations[e.ID]; ok {
		if old.UserID == e.UserID {
			return domain.ErrConflict
		}
		return domain.ErrNotFound
	}
	count := 0
	for _, v := range m.explorations {
		if v.UserID == e.UserID {
			count++
		}
	}
	if count >= 500 {
		return fmt.Errorf("%w: 探索记录上限为 500 条", domain.ErrInvalidInput)
	}
	m.explorations[e.ID] = cloneExploration(e)
	return nil
}
func (m *Memory) ListExplorations(_ context.Context, user string) ([]domain.Exploration, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.Exploration{}
	for _, e := range m.explorations {
		if e.UserID == user {
			items = append(items, cloneExploration(e))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items, nil
}
func (m *Memory) CompleteExploration(_ context.Context, user, id, reflection string, now time.Time) (domain.Exploration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.explorations[id]
	if !ok || e.UserID != user {
		return e, domain.ErrNotFound
	}
	if e.Kind != "challenge" {
		return domain.Exploration{}, domain.ErrInvalidState
	}
	if e.CompletedAt == nil {
		e.CompletedAt = &now
	}
	e.Reflection = reflection
	m.explorations[id] = e
	return cloneExploration(e), nil
}
