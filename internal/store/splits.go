package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func cloneSplit(r domain.SplitGroup) domain.SplitGroup {
	r.Members = append([]domain.SplitMember{}, r.Members...)
	r.Expenses = append([]domain.SplitExpense{}, r.Expenses...)
	for i := range r.Expenses {
		r.Expenses[i].Shares = append([]domain.SplitShare{}, r.Expenses[i].Shares...)
	}
	return r
}
func (m *Memory) ListSplits(ctx context.Context, user string) ([]domain.SplitGroup, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.SplitGroup{}
	for _, r := range m.splits {
		if r.UserID == user {
			rows = append(rows, cloneSplit(r))
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
func (m *Memory) SplitByID(ctx context.Context, user, id string) (domain.SplitGroup, error) {
	if e := ctx.Err(); e != nil {
		return domain.SplitGroup{}, e
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.splits[user+":"+id]
	if !ok {
		return domain.SplitGroup{}, domain.ErrNotFound
	}
	return cloneSplit(r), nil
}
func (m *Memory) SaveSplit(ctx context.Context, r domain.SplitGroup, expected int) (domain.SplitGroup, error) {
	if e := ctx.Err(); e != nil {
		return domain.SplitGroup{}, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r = cloneSplit(r)
	key := r.UserID + ":" + r.ID
	if old, ok := m.splits[key]; ok {
		r.CreatedAt = old.CreatedAt
		r.Revision = old.Revision
		compare := r
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneSplit(old), nil
		}
		if old.Revision != expected {
			return domain.SplitGroup{}, fmt.Errorf("%w: 账单已在其他窗口更新，请先核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.SplitGroup{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.splits {
			if row.UserID == r.UserID {
				count++
			}
		}
		if count >= 100 {
			return domain.SplitGroup{}, fmt.Errorf("%w: 最多保存 100 个账单（含回收站）", domain.ErrInvalidInput)
		}
	}
	r.Revision = expected + 1
	m.splits[key] = cloneSplit(r)
	return cloneSplit(r), nil
}
