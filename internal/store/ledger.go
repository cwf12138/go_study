package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"reflect"
	"sort"
)

func (m *Memory) ListLedger(_ context.Context, user string) ([]domain.LedgerEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.LedgerEntry{}
	for _, e := range m.ledger {
		if e.UserID == user {
			items = append(items, e)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Date == items[j].Date {
			return items[i].ID < items[j].ID
		}
		return items[i].Date > items[j].Date
	})
	return items, nil
}

func (m *Memory) SaveLedger(_ context.Context, e domain.LedgerEntry, expected int) (domain.LedgerEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Scope keys by owner, including predictable monthly budget IDs.
	key := e.UserID + ":" + e.ID
	if old, ok := m.ledger[key]; ok {
		if old.Kind == "budget" && (e.Kind != "budget" || e.Date != old.Date) {
			return domain.LedgerEntry{}, domain.ErrInvalidInput
		}
		e.CreatedAt = old.CreatedAt
		e.Revision = old.Revision
		compare := e
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return old, nil
		}
		if old.Revision != expected {
			return domain.LedgerEntry{}, fmt.Errorf("%w: 账目已更新，请重新载入后编辑", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.LedgerEntry{}, domain.ErrNotFound
		}
		count := 0
		for _, v := range m.ledger {
			if v.UserID == e.UserID {
				count++
			}
		}
		if count >= 10000 {
			return domain.LedgerEntry{}, fmt.Errorf("%w: 每账号最多保存 10000 条账目与预算（含回收站）", domain.ErrInvalidInput)
		}
	}
	e.Revision = expected + 1
	m.ledger[key] = e
	return e, nil
}
