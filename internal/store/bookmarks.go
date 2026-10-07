package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"sort"
)

func (m *Memory) ListBookmarks(_ context.Context, user string) ([]domain.Bookmark, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.Bookmark{}
	for _, row := range m.bookmarks {
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

func (m *Memory) SaveBookmark(_ context.Context, item domain.Bookmark, expected int) (domain.Bookmark, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	if old, ok := m.bookmarks[key]; ok {
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && old == compare {
			return old, nil
		}
		if old.Revision != expected {
			return domain.Bookmark{}, fmt.Errorf("%w: 收藏已在其他窗口修改，请保留草稿后重新加载", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.Bookmark{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.bookmarks {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 3000 {
			return domain.Bookmark{}, fmt.Errorf("%w: 每账号最多保存 3000 条收藏（含回收站）", domain.ErrInvalidInput)
		}
	}
	if !item.Deleted {
		for _, row := range m.bookmarks {
			if row.UserID == item.UserID && row.ID != item.ID && !row.Deleted && row.URL == item.URL {
				return domain.Bookmark{}, fmt.Errorf("%w: 该网址已收藏，请搜索并编辑原条目", domain.ErrConflict)
			}
		}
	}
	item.Revision = expected + 1
	m.bookmarks[key] = item
	return item, nil
}
