package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"reflect"
	"sort"
)

func cloneWhiteboard(row domain.Whiteboard) domain.Whiteboard {
	row.Nodes = append([]domain.BoardNode{}, row.Nodes...)
	for i := range row.Nodes {
		row.Nodes[i].Points = append([]domain.BoardPoint{}, row.Nodes[i].Points...)
	}
	return row
}
func (m *Memory) ListWhiteboards(ctx context.Context, user string) ([]domain.Whiteboard, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []domain.Whiteboard{}
	for _, r := range m.whiteboards {
		if r.UserID == user {
			out = append(out, cloneWhiteboard(r))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}
func (m *Memory) SaveWhiteboard(ctx context.Context, row domain.Whiteboard, expected int) (domain.Whiteboard, error) {
	if e := ctx.Err(); e != nil {
		return domain.Whiteboard{}, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	row = cloneWhiteboard(row)
	key := row.UserID + ":" + row.ID
	if old, ok := m.whiteboards[key]; ok {
		row.CreatedAt = old.CreatedAt
		row.Revision = old.Revision
		compare := row
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneWhiteboard(old), nil
		}
		if old.Revision != expected {
			return domain.Whiteboard{}, fmt.Errorf("%w: 白板已在其他窗口更新，请先导出草稿并核对", domain.ErrConflict)
		}
		if old.Deleted && (!reflect.DeepEqual(row.Nodes, old.Nodes) || row.Title != old.Title) {
			return domain.Whiteboard{}, fmt.Errorf("%w: 请先恢复白板再编辑", domain.ErrInvalidInput)
		}
	} else {
		if expected != 0 {
			return domain.Whiteboard{}, domain.ErrNotFound
		}
		if row.Deleted {
			return domain.Whiteboard{}, domain.ErrInvalidInput
		}
		count := 0
		for _, r := range m.whiteboards {
			if r.UserID == row.UserID {
				count++
			}
		}
		if count >= 60 {
			return domain.Whiteboard{}, fmt.Errorf("%w: 每账号最多 60 张白板（含回收站）", domain.ErrInvalidInput)
		}
	}
	row.Revision = expected + 1
	m.whiteboards[key] = cloneWhiteboard(row)
	return cloneWhiteboard(row), nil
}
