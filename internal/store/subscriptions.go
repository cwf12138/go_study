package store

import (
	"context"
	"fmt"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func (m *Memory) ListSubscriptions(_ context.Context, user string) ([]domain.Subscription, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.Subscription{}
	for _, row := range m.subscriptions {
		if row.UserID == user {
			rows = append(rows, row)
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

func (m *Memory) SaveSubscription(_ context.Context, item domain.Subscription, expected int) (domain.Subscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	if old, ok := m.subscriptions[key]; ok {
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && old == compare {
			return old, nil
		}
		if old.Revision != expected {
			return domain.Subscription{}, fmt.Errorf("%w: 订阅已在其他窗口修改，请保留草稿后重新加载", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.Subscription{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.subscriptions {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 500 {
			return domain.Subscription{}, fmt.Errorf("%w: 每账号最多保存 500 条订阅（含回收站）", domain.ErrInvalidInput)
		}
	}
	item.Revision = expected + 1
	m.subscriptions[key] = item
	return item, nil
}
