package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
)

func (m *Memory) ListImportantDays(_ context.Context, user string) ([]domain.ImportantDay, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.ImportantDay{}
	for _, r := range m.importantDays {
		if r.UserID == user {
			rows = append(rows, r)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return rows, nil
}
func (m *Memory) SaveImportantDay(_ context.Context, r domain.ImportantDay, expected int) (domain.ImportantDay, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := r.UserID + ":" + r.ID
	if old, ok := m.importantDays[key]; ok {
		r.CreatedAt = old.CreatedAt
		r.Revision = old.Revision
		compare := r
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && compare == old {
			return old, nil
		}
		if old.Revision != expected {
			return domain.ImportantDay{}, fmt.Errorf("%w: 重要日子已在其他窗口修改，请重新载入后再编辑", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.ImportantDay{}, domain.ErrNotFound
		}
		count := 0
		for _, item := range m.importantDays {
			if item.UserID == r.UserID {
				count++
			}
		}
		if count >= 500 {
			return domain.ImportantDay{}, fmt.Errorf("%w: 最多保存 500 个日子（含回收站）", domain.ErrInvalidInput)
		}
	}
	r.Revision = expected + 1
	m.importantDays[key] = r
	return r, nil
}
