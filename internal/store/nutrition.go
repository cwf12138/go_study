package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func cloneNutrition(row domain.NutritionEntry) domain.NutritionEntry {
	if row.Card != nil {
		card := *row.Card
		card.Slots = append([]string{}, card.Slots...)
		card.Channels = append([]string{}, card.Channels...)
		card.Goals = append([]string{}, card.Goals...)
		card.Allergens = append([]string{}, card.Allergens...)
		card.Parts = append([]domain.NutritionPart{}, card.Parts...)
		row.Card = &card
	}
	if row.Preferences != nil {
		prefs := *row.Preferences
		prefs.Avoid = append([]string{}, prefs.Avoid...)
		row.Preferences = &prefs
	}
	return row
}
func (m *Memory) ListNutrition(_ context.Context, user string) ([]domain.NutritionEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.NutritionEntry{}
	for _, row := range m.nutrition {
		if row.UserID == user {
			rows = append(rows, cloneNutrition(row))
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
func (m *Memory) NutritionByID(_ context.Context, user, id string) (domain.NutritionEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.nutrition[user+":"+id]
	if !ok {
		return domain.NutritionEntry{}, domain.ErrNotFound
	}
	return cloneNutrition(row), nil
}
func (m *Memory) SaveNutrition(_ context.Context, row domain.NutritionEntry, expected int) (domain.NutritionEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := row.UserID + ":" + row.ID
	old, exists := m.nutrition[key]
	row = cloneNutrition(row)
	if exists {
		row.CreatedAt, row.Revision = old.CreatedAt, old.Revision
		compare := row
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneNutrition(old), nil
		}
		if old.Revision != expected || old.Kind != row.Kind || old.CardID != row.CardID {
			return domain.NutritionEntry{}, fmt.Errorf("%w: 饮食记录已更新，请先核对服务端记录", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.NutritionEntry{}, domain.ErrNotFound
		}
		count := 0
		for _, item := range m.nutrition {
			if item.UserID == row.UserID {
				count++
			}
		}
		if count >= 5000 {
			return domain.NutritionEntry{}, fmt.Errorf("%w: 饮食记录最多 5000 条（含回收站）", domain.ErrInvalidInput)
		}
	}
	row.Revision = expected + 1
	if row.Kind == "plan" && !row.Deleted {
		for _, item := range m.nutrition {
			if item.UserID == row.UserID && item.ID != row.ID && item.Kind == "plan" && !item.Deleted && item.CardID == row.CardID && item.Date == row.Date && item.Slot == row.Slot {
				return domain.NutritionEntry{}, fmt.Errorf("%w: 这一天的该餐次已安排相同组合，请核对现有安排", domain.ErrConflict)
			}
		}
	}
	m.nutrition[key] = cloneNutrition(row)
	return cloneNutrition(row), nil
}
