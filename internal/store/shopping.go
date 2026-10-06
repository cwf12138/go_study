package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
	"strings"
)

func (m *Memory) ListShopping(_ context.Context, user string) ([]domain.ShoppingItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.ShoppingItem{}
	for _, row := range m.shopping {
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
func shoppingName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}
func (m *Memory) SaveShopping(_ context.Context, item domain.ShoppingItem, expected int) (domain.ShoppingItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	if old, ok := m.shopping[key]; ok {
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && old == compare {
			return old, nil
		}
		if old.Revision != expected {
			return domain.ShoppingItem{}, fmt.Errorf("%w: 清单已在其他页面更新，请保留输入并刷新", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.ShoppingItem{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.shopping {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 2000 {
			return domain.ShoppingItem{}, fmt.Errorf("%w: 最多保存 2000 条购物记录，请复用已买到的条目", domain.ErrInvalidInput)
		}
	}
	// Validate under the write lock, so two simultaneous adds cannot create twins.
	if !item.Deleted && !item.Purchased {
		for _, row := range m.shopping {
			if row.UserID == item.UserID && row.ID != item.ID && !row.Deleted && !row.Purchased && shoppingName(row.Name) == shoppingName(item.Name) {
				return domain.ShoppingItem{}, fmt.Errorf("%w: 待购买清单中已有“%s”，请修改现有条目的数量", domain.ErrConflict, item.Name)
			}
		}
	}
	item.Revision = expected + 1
	m.shopping[key] = item
	return item, nil
}
