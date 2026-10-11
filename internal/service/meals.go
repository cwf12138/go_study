package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveMealInput struct {
	Kind        string                  `json:"kind"`
	Title       string                  `json:"title"`
	Category    string                  `json:"category"`
	Minutes     int                     `json:"minutes"`
	Servings    int                     `json:"servings"`
	Ingredients []domain.MealIngredient `json:"ingredients"`
	Steps       []string                `json:"steps"`
	Note        string                  `json:"note"`
	Favorite    bool                    `json:"favorite"`
	RecipeID    string                  `json:"recipe_id"`
	Date        string                  `json:"date"`
	Slot        string                  `json:"slot"`
	Cooked      bool                    `json:"cooked"`
	Deleted     bool                    `json:"deleted"`
	Revision    int                     `json:"revision"`
}

func (s *Service) ListMeals(ctx context.Context, user string) ([]domain.MealEntry, error) {
	return s.repo.ListMeals(ctx, user)
}
func (s *Service) SaveMeal(ctx context.Context, user, id string, in SaveMealInput) (domain.MealEntry, error) {
	bad := func(text string) (domain.MealEntry, error) {
		return domain.MealEntry{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, text)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("无效的标识或版本")
	}
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Note) > 500 {
		return bad("备注最多 500 字")
	}
	now := s.now().UTC()
	row := domain.MealEntry{ID: id, UserID: user, Kind: in.Kind, Note: in.Note, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}
	switch in.Kind {
	case "recipe":
		row.Title = strings.TrimSpace(in.Title)
		row.Category = strings.TrimSpace(in.Category)
		row.Minutes = in.Minutes
		row.Servings = in.Servings
		row.Favorite = in.Favorite
		if row.Title == "" || utf8.RuneCountInString(row.Title) > 80 || strings.ContainsAny(row.Title, "\r\n") || utf8.RuneCountInString(row.Category) > 20 {
			return bad("菜名必填且最多 80 字；分类最多 20 字")
		}
		if row.Category == "" {
			row.Category = "家常菜"
		}
		if row.Minutes < 1 || row.Minutes > 600 || row.Servings < 1 || row.Servings > 20 {
			return bad("耗时范围 1–600 分钟，份数范围 1–20 人")
		}
		if len(in.Ingredients) < 1 || len(in.Ingredients) > 40 || len(in.Steps) < 1 || len(in.Steps) > 30 {
			return bad("请填写 1–40 项食材和 1–30 个步骤")
		}
		seen := map[string]bool{}
		for _, ingredient := range in.Ingredients {
			ingredient.Name = strings.TrimSpace(ingredient.Name)
			ingredient.Quantity = strings.TrimSpace(ingredient.Quantity)
			key := strings.ToLower(strings.Join(strings.Fields(ingredient.Name), " "))
			if ingredient.Name == "" || utf8.RuneCountInString(ingredient.Name) > 80 || utf8.RuneCountInString(ingredient.Quantity) > 30 || strings.ContainsAny(ingredient.Name+ingredient.Quantity, "\r\n") || seen[key] {
				return bad("食材名称须唯一且最多 80 字，用量最多 30 字；每项单独一行")
			}
			seen[key] = true
			if ingredient.Quantity == "" {
				ingredient.Quantity = "适量"
			}
			row.Ingredients = append(row.Ingredients, ingredient)
		}
		for _, step := range in.Steps {
			step = strings.TrimSpace(step)
			if step == "" || utf8.RuneCountInString(step) > 500 {
				return bad("每个步骤必填且最多 500 字")
			}
			row.Steps = append(row.Steps, step)
		}
	case "plan":
		date, err := time.Parse("2006-01-02", in.Date)
		if err != nil || date.Year() < 2000 || date.Year() > 2100 {
			return bad("请选择 2000–2100 年内的有效日期")
		}
		if !ledgerID.MatchString(in.RecipeID) || (in.Slot != "breakfast" && in.Slot != "lunch" && in.Slot != "dinner") {
			return bad("请选择菜谱与早 / 午 / 晚餐")
		}
		row.Date = in.Date
		row.Slot = in.Slot
		row.RecipeID = in.RecipeID
		row.Cooked = in.Cooked
	default:
		return bad("无效的菜谱或菜单类型")
	}
	return s.repo.SaveMeal(ctx, row, in.Revision)
}

type MealShoppingInput struct {
	IDs  []string `json:"ids"`
	Have []string `json:"have"`
}

func (s *Service) CollectMealShopping(ctx context.Context, user string, in MealShoppingInput) (domain.MealShoppingResult, error) {
	bad := func(text string) (domain.MealShoppingResult, error) {
		return domain.MealShoppingResult{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, text)
	}
	if len(in.IDs) < 1 || len(in.IDs) > 21 || len(in.Have) > 840 {
		return bad("请选择 1–21 道菜，排除食材最多 840 项")
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range in.IDs {
		if !ledgerID.MatchString(id) {
			return bad("无效的菜谱标识")
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	for _, name := range in.Have {
		if utf8.RuneCountInString(name) > 80 {
			return bad("已有食材名称最多 80 字")
		}
	}
	return s.repo.CollectMealShopping(ctx, user, ids, in.Have, s.now().UTC())
}
