package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func cloneTravel(p domain.TravelPlan) domain.TravelPlan {
	p.Stops = append([]domain.TravelStop{}, p.Stops...)
	p.Packing = append([]domain.TravelPack{}, p.Packing...)
	return p
}

func (m *Memory) ListTravelPlans(_ context.Context, user string) ([]domain.TravelPlan, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.TravelPlan{}
	for _, p := range m.travelPlans {
		if p.UserID == user {
			rows = append(rows, cloneTravel(p))
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].UpdatedAt.Equal(rows[j].UpdatedAt) {
			return rows[i].ID < rows[j].ID
		}
		return rows[i].UpdatedAt.After(rows[j].UpdatedAt)
	})
	return rows, nil
}

func (m *Memory) SaveTravelPlan(_ context.Context, p domain.TravelPlan, expected int) (domain.TravelPlan, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p = cloneTravel(p)
	key := p.UserID + ":" + p.ID
	if old, ok := m.travelPlans[key]; ok {
		p.CreatedAt, p.Revision = old.CreatedAt, old.Revision
		compare := p
		compare.UpdatedAt = old.UpdatedAt
		// Repeating an uncertain request must not duplicate a trip or advance its revision.
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneTravel(old), nil
		}
		if old.Revision != expected {
			return domain.TravelPlan{}, fmt.Errorf("%w: 旅行计划已在其他页面更新，请先导出草稿再重新载入", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.TravelPlan{}, domain.ErrNotFound
		}
		count := 0
		for _, item := range m.travelPlans {
			if item.UserID == p.UserID {
				count++
			}
		}
		if count >= 50 {
			return domain.TravelPlan{}, fmt.Errorf("%w: 每账号最多 50 个旅行计划（含归档）", domain.ErrInvalidInput)
		}
	}
	p.Revision = expected + 1
	m.travelPlans[key] = cloneTravel(p)
	return cloneTravel(p), nil
}
