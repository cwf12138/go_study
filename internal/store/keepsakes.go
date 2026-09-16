package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"reflect"
	"sort"
)

func cloneKeepsake(e domain.Keepsake) domain.Keepsake {
	if e.Latitude != nil {
		v := *e.Latitude
		e.Latitude = &v
	}
	if e.Longitude != nil {
		v := *e.Longitude
		e.Longitude = &v
	}
	return e
}
func (m *Memory) ListKeepsakes(_ context.Context, user string) ([]domain.Keepsake, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.Keepsake{}
	for _, e := range m.keepsakes {
		if e.UserID == user {
			items = append(items, cloneKeepsake(e))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items, nil
}
func (m *Memory) SaveKeepsake(_ context.Context, e domain.Keepsake, expected int) (domain.Keepsake, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if old, ok := m.keepsakes[e.ID]; ok {
		if old.UserID != e.UserID {
			return domain.Keepsake{}, domain.ErrNotFound
		}
		if old.Kind != e.Kind {
			return domain.Keepsake{}, domain.ErrInvalidInput
		}
		e.CreatedAt = old.CreatedAt
		e.Revision = old.Revision
		compare := e
		compare.UpdatedAt = old.UpdatedAt
		// A retry after a lost response must not create another record or overwrite newer work.
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneKeepsake(old), nil
		}
		if old.Revision != expected {
			return domain.Keepsake{}, fmt.Errorf("%w: 记录已在其他页面更新，请刷新核对后再编辑", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.Keepsake{}, domain.ErrNotFound
		}
		count := 0
		for _, v := range m.keepsakes {
			if v.UserID == e.UserID {
				count++
			}
		}
		if count >= 200 {
			return domain.Keepsake{}, fmt.Errorf("%w: 人生地图与博物馆合计最多保留 200 条记录（含归档）", domain.ErrInvalidInput)
		}
	}
	e.Revision = expected + 1
	m.keepsakes[e.ID] = cloneKeepsake(e)
	return cloneKeepsake(e), nil
}
