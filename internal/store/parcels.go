package store

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func (m *Memory) ListParcels(_ context.Context, user string) ([]domain.Parcel, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.Parcel{}
	for _, r := range m.parcels {
		if r.UserID == user {
			rows = append(rows, r)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return rows, nil
}
func (m *Memory) SaveParcel(_ context.Context, r domain.Parcel, expected int) (domain.Parcel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := r.UserID + ":" + r.ID
	if r.Status == "picked" {
		r.PickedAt = r.UpdatedAt
	} else {
		r.PickedAt = time.Time{}
	}
	if old, ok := m.parcels[key]; ok {
		r.CreatedAt = old.CreatedAt
		r.Revision = old.Revision
		if r.Status == "picked" && old.Status == "picked" {
			r.PickedAt = old.PickedAt
		}
		compare := r
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && compare == old {
			return old, nil
		}
		if old.Revision != expected {
			return domain.Parcel{}, fmt.Errorf("%w: 包裹已在其他窗口修改，请先重新核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.Parcel{}, domain.ErrNotFound
		}
		count := 0
		for _, item := range m.parcels {
			if item.UserID == r.UserID {
				count++
			}
		}
		if count >= 2000 {
			return domain.Parcel{}, fmt.Errorf("%w: 每账号最多 2000 条包裹（含回收站）", domain.ErrInvalidInput)
		}
	}
	r.Revision = expected + 1
	m.parcels[key] = r
	return r, nil
}
