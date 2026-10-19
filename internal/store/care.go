package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func cloneCare(row domain.CareItem) domain.CareItem {
	row.History = append([]domain.CareCompletion{}, row.History...)
	if row.Undo != nil {
		u := *row.Undo
		if u.Dropped != nil {
			d := *u.Dropped
			u.Dropped = &d
		}
		row.Undo = &u
	}
	return row
}
func (m *Memory) ListCare(_ context.Context, user string) ([]domain.CareItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.CareItem{}
	for _, r := range m.care {
		if r.UserID == user {
			rows = append(rows, cloneCare(r))
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
func (m *Memory) CareByID(_ context.Context, user, id string) (domain.CareItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.care[user+":"+id]
	if !ok {
		return domain.CareItem{}, domain.ErrNotFound
	}
	return cloneCare(row), nil
}
func (m *Memory) SaveCare(_ context.Context, row domain.CareItem, expected int) (domain.CareItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row = cloneCare(row)
	key := row.UserID + ":" + row.ID
	if old, ok := m.care[key]; ok {
		row.CreatedAt = old.CreatedAt
		row.Revision = old.Revision
		compare := row
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneCare(old), nil
		}
		if old.Revision != expected {
			return domain.CareItem{}, fmt.Errorf("%w: 保养事项已在其他窗口更新，请先核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.CareItem{}, domain.ErrNotFound
		}
		count := 0
		for _, r := range m.care {
			if r.UserID == row.UserID {
				count++
			}
		}
		if count >= 500 {
			return domain.CareItem{}, fmt.Errorf("%w: 最多保存 500 项（含回收站）", domain.ErrInvalidInput)
		}
	}
	row.Revision = expected + 1
	m.care[key] = cloneCare(row)
	return cloneCare(row), nil
}
