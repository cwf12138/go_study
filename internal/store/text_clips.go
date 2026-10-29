package store

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func (m *Memory) ListTextClips(_ context.Context, user string) ([]domain.TextClip, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.TextClip{}
	for _, row := range m.textClips {
		if row.UserID == user {
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return rows, nil
}
func (m *Memory) SaveTextClip(_ context.Context, row domain.TextClip, expected int, renew bool) (domain.TextClip, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := row.UserID + ":" + row.ID
	if old, ok := m.textClips[key]; ok {
		row.CreatedAt = old.CreatedAt
		row.Revision = old.Revision
		if row.TTLHours == old.TTLHours && !renew {
			row.ExpiresAt = old.ExpiresAt
		}
		compare := row
		compare.UpdatedAt = old.UpdatedAt
		if renew {
			compare.ExpiresAt = old.ExpiresAt
		}
		if old.Revision == expected+1 && compare == old {
			return old, nil
		}
		if old.Revision != expected {
			return domain.TextClip{}, fmt.Errorf("%w: 文字已在其他设备更新，请先核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.TextClip{}, domain.ErrNotFound
		}
		count := 0
		for _, item := range m.textClips {
			if item.UserID == row.UserID {
				count++
			}
		}
		if count >= 100 {
			return domain.TextClip{}, fmt.Errorf("%w: 每账号最多 100 条文字（含过期与回收站），请清理后再添加", domain.ErrInvalidInput)
		}
	}
	row.Revision = expected + 1
	m.textClips[key] = row
	return row, nil
}
func (m *Memory) PurgeTextClip(_ context.Context, user, id string, revision int, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := user + ":" + id
	row, ok := m.textClips[key]
	if !ok {
		return domain.ErrNotFound
	}
	if row.Revision != revision {
		return domain.ErrConflict
	}
	if !row.Deleted && (row.ExpiresAt.IsZero() || now.Before(row.ExpiresAt)) {
		return fmt.Errorf("%w: 请先移入回收站，或等待文字过期", domain.ErrInvalidInput)
	}
	delete(m.textClips, key)
	return nil
}
