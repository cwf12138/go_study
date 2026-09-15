package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
)

// Atomic partial updates prevent a favorite toggle from overwriting a reflection.
func (m *Memory) SaveDailyCard(_ context.Context, e domain.Exploration, favorite *bool, reflection *string) (domain.Exploration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if old, ok := m.explorations[e.ID]; ok {
		if old.UserID != e.UserID || old.Kind != "daily" {
			return domain.Exploration{}, domain.ErrNotFound
		}
		e = old
	} else {
		count := 0
		for _, item := range m.explorations {
			if item.UserID == e.UserID {
				count++
			}
		}
		if count >= 500 {
			return domain.Exploration{}, fmt.Errorf("%w: 探索记录最多保留 500 条", domain.ErrInvalidInput)
		}
	}
	if favorite != nil {
		e.Favorite = *favorite
	}
	if reflection != nil {
		e.Reflection = *reflection
	}
	m.explorations[e.ID] = e
	return cloneExploration(e), nil
}
