package service

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/example/studyflow/internal/domain"
)

type SaveNutritionInput struct {
	Kind        string                       `json:"kind"`
	CardID      string                       `json:"card_id"`
	Preferences *domain.NutritionPreferences `json:"preferences"`
	Date        string                       `json:"date"`
	Slot        string                       `json:"slot"`
	State       string                       `json:"state"`
	Note        string                       `json:"note"`
	Deleted     bool                         `json:"deleted"`
	Revision    int                          `json:"revision"`
}

func nutritionOne(value string, options ...string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}
func (s *Service) ListNutrition(ctx context.Context, user string) ([]domain.NutritionEntry, error) {
	return s.repo.ListNutrition(ctx, user)
}
func (s *Service) SaveNutrition(ctx context.Context, user, id string, in SaveNutritionInput) (domain.NutritionEntry, error) {
	var zero domain.NutritionEntry
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 || !fitnessText(in.Note, 500, false) {
		return zero, fitnessBad("无效标识、版本或备注（最多 500 字）")
	}
	now := s.now().UTC()
	row := domain.NutritionEntry{ID: id, UserID: user, Kind: in.Kind, CardID: in.CardID, Date: in.Date, Slot: in.Slot, State: in.State, Note: strings.TrimSpace(in.Note), Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}
	old, err := s.repo.NutritionByID(ctx, user, id)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return zero, err
	}
	if err == nil && (old.Kind != in.Kind || old.CardID != in.CardID) {
		return zero, domain.ErrConflict
	}
	if in.Kind == "preference" {
		if id != "nutrition-preferences" || in.Preferences == nil || in.Deleted || in.CardID != "" {
			return zero, fitnessBad("饮食偏好须使用固定标识及有效偏好")
		}
		p := *in.Preferences
		if !nutritionOne(p.Goal, "balanced", "training", "lighter") || !nutritionOne(p.Channel, "any", "canteen", "delivery", "convenience", "home") || !nutritionOne(p.Slot, "breakfast", "lunch", "dinner", "snack") || len(p.Avoid) > 9 || !fitnessText(p.Exclude, 120, false) {
			return zero, fitnessBad("请检查目标、用餐方式、餐次与排除关键词")
		}
		unique := map[string]bool{}
		for _, key := range p.Avoid {
			if !nutritionOne(key, "milk", "egg", "soy", "wheat", "peanut", "nuts", "fish", "shellfish", "sesame") {
				return zero, fitnessBad("不支持的常见过敏原选项")
			}
			unique[key] = true
		}
		p.Avoid = []string{}
		for key := range unique {
			p.Avoid = append(p.Avoid, key)
		}
		sort.Strings(p.Avoid)
		p.Exclude = strings.TrimSpace(p.Exclude)
		row.Preferences = &p
		row.Date, row.Slot, row.State, row.Note = "", "", "", ""
	} else if in.Kind == "favorite" || in.Kind == "plan" {
		// Updates retain the original food snapshot, even if the catalogue changes.
		if err == nil {
			row.Card = old.Card
		} else {
			for _, card := range NutritionCatalog() {
				if card.ID == in.CardID {
					copy := card
					row.Card = &copy
					break
				}
			}
		}
		if row.Card == nil {
			return zero, fitnessBad("请选择当前可用的饮食组合")
		}
		if in.Kind == "favorite" {
			if id != "nutrition-favorite-"+in.CardID {
				return zero, fitnessBad("收藏须使用对应组合的固定标识")
			}
			row.Date, row.Slot, row.State, row.Note = "", "", "", ""
		} else {
			if _, err := subscriptionDate(in.Date); err != nil || !nutritionOne(in.Slot, row.Card.Slots...) || !nutritionOne(in.State, "planned", "eaten") {
				return zero, fitnessBad("请选择有效日期、适用餐次与安排状态")
			}
			if in.State == "eaten" && in.Date > now.In(calendarLocation).Format("2006-01-02") {
				return zero, fitnessBad("未来的用餐安排不能标记已吃")
			}
		}
	} else {
		return zero, fitnessBad("不支持的饮食记录类型")
	}
	return s.repo.SaveNutrition(ctx, row, in.Revision)
}
