package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"reflect"
	"sort"
)

func cloneFitness(row domain.FitnessEntry) domain.FitnessEntry {
	row.Moves = append([]domain.FitnessMove{}, row.Moves...)
	return row
}
func (m *Memory) ListFitness(_ context.Context, user string) ([]domain.FitnessEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.FitnessEntry{}
	for _, row := range m.fitness {
		if row.UserID == user {
			rows = append(rows, cloneFitness(row))
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
func (m *Memory) FitnessByID(_ context.Context, user, id string) (domain.FitnessEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.fitness[user+":"+id]
	if !ok {
		return row, domain.ErrNotFound
	}
	return cloneFitness(row), nil
}
func (m *Memory) SaveFitness(_ context.Context, item domain.FitnessEntry, expected int) (domain.FitnessEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	old, exists := m.fitness[key]
	item = cloneFitness(item)
	if exists {
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneFitness(old), nil
		}
		if old.Revision != expected || old.Kind != item.Kind {
			return domain.FitnessEntry{}, fmt.Errorf("%w: 运动记录已在其他窗口更新，请先保留请求再核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.FitnessEntry{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.fitness {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 5000 {
			return domain.FitnessEntry{}, fmt.Errorf("%w: 每个账号最多保存 5000 条运动记录（含软删除）", domain.ErrInvalidInput)
		}
	}
	active := func(row domain.FitnessEntry) bool {
		return row.Kind == "session" && !row.Deleted && (row.State == "active" || row.State == "paused")
	}
	for _, row := range m.fitness {
		if row.UserID != item.UserID || row.ID == item.ID {
			continue
		}
		if active(item) && active(row) {
			return domain.FitnessEntry{}, fmt.Errorf("%w: 请先结束当前训练；同一账号只能有一场进行中的训练", domain.ErrConflict)
		}
		if active(row) && row.PlanID == item.ID && (item.Deleted || item.Date != old.Date || item.State != "scheduled") {
			return domain.FitnessEntry{}, fmt.Errorf("%w: 请先结束关联训练，再修改这项安排", domain.ErrConflict)
		}
	}
	if !exists && item.Kind == "session" && item.PlanID != "" {
		plan, ok := m.fitness[item.UserID+":"+item.PlanID]
		if !ok || plan.Deleted || plan.Kind != "plan" || plan.State != "scheduled" {
			return domain.FitnessEntry{}, fmt.Errorf("%w: 安排已取消或完成，请重新选择", domain.ErrConflict)
		}
	}
	if item.Kind == "session" && item.State == "completed" && item.PlanID != "" {
		pkey := item.UserID + ":" + item.PlanID
		if plan, ok := m.fitness[pkey]; ok && !plan.Deleted && plan.Kind == "plan" && plan.State == "scheduled" {
			plan.State = "completed"
			plan.Revision++
			plan.UpdatedAt = item.UpdatedAt
			m.fitness[pkey] = plan
		}
	}
	item.Revision = expected + 1
	m.fitness[key] = cloneFitness(item)
	return cloneFitness(item), nil
}
