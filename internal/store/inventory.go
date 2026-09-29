package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
)

func (m *Memory) ListInventory(_ context.Context, user string) ([]domain.InventoryItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.InventoryItem{}
	for _, item := range m.inventory {
		if item.UserID == user {
			rows = append(rows, item)
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

func (m *Memory) SaveInventory(_ context.Context, item domain.InventoryItem, expected int) (domain.InventoryItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	if old, ok := m.inventory[key]; ok {
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		// Idempotent retry of a write whose response was lost.
		if old.Revision == expected+1 && old == compare {
			return old, nil
		}
		if old.Revision != expected {
			return domain.InventoryItem{}, fmt.Errorf("%w: 物品已在其他页面更新，请保留草稿并重新载入", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.InventoryItem{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.inventory {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 1000 {
			return domain.InventoryItem{}, fmt.Errorf("%w: 每账号最多保存 1000 条物品记录（含归档）", domain.ErrInvalidInput)
		}
	}
	item.Revision = expected + 1
	m.inventory[key] = item
	return item, nil
}
