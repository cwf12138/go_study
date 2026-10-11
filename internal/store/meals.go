package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

func cloneMeal(row domain.MealEntry) domain.MealEntry {
	row.Ingredients = append([]domain.MealIngredient{}, row.Ingredients...)
	row.Steps = append([]string{}, row.Steps...)
	return row
}
func (m *Memory) ListMeals(_ context.Context, user string) ([]domain.MealEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.MealEntry{}
	for _, row := range m.meals {
		if row.UserID == user {
			rows = append(rows, cloneMeal(row))
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
func (m *Memory) SaveMeal(_ context.Context, item domain.MealEntry, expected int) (domain.MealEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := item.UserID + ":" + item.ID
	item = cloneMeal(item)
	if old, ok := m.meals[key]; ok {
		if item.Kind == "plan" {
			item.Title = old.Title
		}
		item.CreatedAt = old.CreatedAt
		item.Revision = old.Revision
		compare := item
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneMeal(old), nil
		}
		if old.Kind != item.Kind || old.Revision != expected {
			return domain.MealEntry{}, fmt.Errorf("%w: 内容已更新，请保留草稿后重新加载", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.MealEntry{}, domain.ErrNotFound
		}
		count := 0
		for _, row := range m.meals {
			if row.UserID == item.UserID {
				count++
			}
		}
		if count >= 3500 {
			return domain.MealEntry{}, fmt.Errorf("%w: 菜谱与菜单最多保存 3500 条（含已删除）", domain.ErrInvalidInput)
		}
	}
	if item.Kind == "plan" && !item.Deleted {
		recipe, ok := m.meals[item.UserID+":"+item.RecipeID]
		if !ok || recipe.Kind != "recipe" || recipe.Deleted {
			return domain.MealEntry{}, fmt.Errorf("%w: 菜谱已删除或不存在", domain.ErrInvalidInput)
		}
		item.Title = recipe.Title
		// Multiple dishes are allowed, but not the same dish twice in one meal.
		for _, row := range m.meals {
			if row.UserID == item.UserID && row.ID != item.ID && row.Kind == "plan" && !row.Deleted && row.Date == item.Date && row.Slot == item.Slot && row.RecipeID == item.RecipeID {
				return domain.MealEntry{}, fmt.Errorf("%w: 这一餐已经安排了这道菜", domain.ErrConflict)
			}
		}
	}
	if item.Kind == "recipe" && item.Deleted {
		for _, row := range m.meals {
			if row.UserID == item.UserID && row.Kind == "plan" && !row.Deleted && row.RecipeID == item.ID {
				return domain.MealEntry{}, fmt.Errorf("%w: 请先移除引用这道菜的菜单记录，再删除菜谱", domain.ErrConflict)
			}
		}
	}
	item.Revision = expected + 1
	m.meals[key] = cloneMeal(item)
	return cloneMeal(item), nil
}

// CollectMealShopping validates and commits the whole batch under one lock.
// Repeating a request adds no duplicate pending names; existing quantities are not overwritten.
func (m *Memory) CollectMealShopping(_ context.Context, user string, ids, have []string, now time.Time) (domain.MealShoppingResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := domain.MealShoppingResult{}
	owned := map[string]bool{}
	for _, name := range have {
		owned[shoppingName(name)] = true
	}
	needed := map[string]domain.ShoppingItem{}
	for _, id := range ids {
		row, ok := m.meals[user+":"+id]
		if !ok || row.Deleted {
			return result, domain.ErrNotFound
		}
		if row.Kind == "plan" {
			row, ok = m.meals[user+":"+row.RecipeID]
			if !ok || row.Deleted {
				return result, fmt.Errorf("%w: 菜单引用的菜谱已删除，请先调整菜单", domain.ErrInvalidInput)
			}
		}
		for _, ingredient := range row.Ingredients {
			key := shoppingName(ingredient.Name)
			if owned[key] {
				continue
			}
			item := needed[key]
			item.Name = ingredient.Name
			item.Quantity = "按菜谱"
			if item.Note != "" {
				item.Note += "；"
			}
			item.Note += row.Title + "：" + ingredient.Quantity
			// Shopping notes are bounded independently from recipe sizes.
			runes := []rune(item.Note)
			if len(runes) > 450 {
				item.Note = string(runes[:450]) + "…"
			}
			needed[key] = item
		}
	}
	count := 0
	for _, row := range m.shopping {
		if row.UserID == user {
			count++
			if !row.Deleted && !row.Purchased {
				key := shoppingName(row.Name)
				if _, ok := needed[key]; ok {
					delete(needed, key)
					result.Existing++
				}
			}
		}
	}
	if count+len(needed) > 2000 {
		return domain.MealShoppingResult{}, fmt.Errorf("%w: 购物清单容量不足，本次未添加任何食材", domain.ErrInvalidInput)
	}
	keys := make([]string, 0, len(needed))
	for key := range needed {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		item := needed[key]
		item.ID = platform.NewID()
		item.UserID = user
		item.Revision = 1
		item.CreatedAt = now
		item.UpdatedAt = now
		item.Note = "菜谱参考用量（请按人数调整）：" + strings.TrimSpace(item.Note)
		m.shopping[user+":"+item.ID] = item
		result.Added++
	}
	return result, nil
}
