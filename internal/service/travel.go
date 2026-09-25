package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

type SaveTravelPlanInput struct {
	Title       string              `json:"title"`
	Destination string              `json:"destination"`
	StartDate   string              `json:"start_date"`
	EndDate     string              `json:"end_date"`
	Notes       string              `json:"notes"`
	BudgetCents int64               `json:"budget_cents"`
	Archived    bool                `json:"archived"`
	Stops       []domain.TravelStop `json:"stops"`
	Packing     []domain.TravelPack `json:"packing"`
	Revision    int                 `json:"revision"`
}

const travelMoneyLimit int64 = 100000000 // 1 million CNY per field

func (s *Service) ListTravelPlans(ctx context.Context, user string) ([]domain.TravelPlan, error) {
	return s.repo.ListTravelPlans(ctx, user)
}

func (s *Service) SaveTravelPlan(ctx context.Context, user, id string, in SaveTravelPlanInput) (domain.TravelPlan, error) {
	bad := func(message string) (domain.TravelPlan, error) {
		return domain.TravelPlan{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	validText := func(v string, max int, required bool) bool {
		return (!required || v != "") && utf8.RuneCountInString(v) <= max
	}
	date := func(v string) (time.Time, error) {
		d, e := time.Parse("2006-01-02", v)
		if e != nil || d.Format("2006-01-02") != v || d.Year() < 2000 || d.Year() > 2100 {
			return time.Time{}, domain.ErrInvalidInput
		}
		return d, nil
	}
	money := func(v int64) bool { return v >= 0 && v <= travelMoneyLimit }
	in.Title, in.Destination, in.Notes = strings.TrimSpace(in.Title), strings.TrimSpace(in.Destination), strings.TrimSpace(in.Notes)
	if !projectID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("旅行标识或版本无效")
	}
	if !validText(in.Title, 80, true) || !validText(in.Destination, 120, true) || !validText(in.Notes, 4000, false) {
		return bad("名称 1–80 字，目的地 1–120 字，备注最多 4000 字")
	}
	start, e1 := date(in.StartDate)
	end, e2 := date(in.EndDate)
	if e1 != nil || e2 != nil || end.Before(start) || end.Sub(start) > 30*24*time.Hour {
		return bad("旅行日期须在 2000–2100 年内，连续 1–31 天")
	}
	if !money(in.BudgetCents) {
		return bad("预算须在 0–100 万元之间")
	}
	if len(in.Stops) > 200 || len(in.Packing) > 100 {
		return bad("每趟旅行最多 200 个行程与 100 个行李项")
	}
	ids := map[string]bool{}
	in.Stops = append([]domain.TravelStop{}, in.Stops...)
	in.Packing = append([]domain.TravelPack{}, in.Packing...)
	for i := range in.Stops {
		v := &in.Stops[i]
		v.Title, v.Location, v.Notes = strings.TrimSpace(v.Title), strings.TrimSpace(v.Location), strings.TrimSpace(v.Notes)
		if !projectID.MatchString(v.ID) || ids[v.ID] {
			return bad("行程标识无效或重复")
		}
		ids[v.ID] = true
		d, e := date(v.Date)
		if e != nil || d.Before(start) || d.After(end) {
			return bad("行程日期必须在旅行日期范围内")
		}
		if !validText(v.Title, 120, true) || !validText(v.Location, 180, false) || !validText(v.Notes, 2000, false) {
			return bad("行程名称 1–120 字，地点最多 180 字，备注最多 2000 字")
		}
		if v.Category != "sight" && v.Category != "food" && v.Category != "transport" && v.Category != "stay" && v.Category != "other" {
			return bad("行程分类无效")
		}
		if v.Minutes < 1 || v.Minutes > 1440 {
			return bad("时长须为 1–1440 分钟")
		}
		if v.Time != "" {
			t, e := time.Parse("15:04", v.Time)
			if e != nil || t.Format("15:04") != v.Time || t.Hour()*60+t.Minute()+v.Minutes > 1440 {
				return bad("开始时间须为 HH:MM，跨日行程请分天记录")
			}
		}
		if !money(v.EstimatedCents) || !money(v.SpentCents) {
			return bad("行程金额须在 0–100 万元之间")
		}
	}
	for i := range in.Packing {
		v := &in.Packing[i]
		v.Title = strings.TrimSpace(v.Title)
		if !projectID.MatchString(v.ID) || ids[v.ID] {
			return bad("行李标识无效或重复")
		}
		ids[v.ID] = true
		if !validText(v.Title, 100, true) || v.Quantity < 1 || v.Quantity > 99 {
			return bad("行李名称 1–100 字，数量 1–99")
		}
		if v.Category != "essentials" && v.Category != "clothes" && v.Category != "electronics" && v.Category != "care" && v.Category != "other" {
			return bad("行李分类无效")
		}
	}
	now := s.now().UTC()
	return s.repo.SaveTravelPlan(ctx, domain.TravelPlan{ID: id, UserID: user, Title: in.Title, Destination: in.Destination, StartDate: in.StartDate, EndDate: in.EndDate, Notes: in.Notes, BudgetCents: in.BudgetCents, Archived: in.Archived, Stops: in.Stops, Packing: in.Packing, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
