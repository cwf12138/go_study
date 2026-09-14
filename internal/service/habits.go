package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

type CreateHabitInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	TimeZone    string `json:"time_zone"`
}
type HabitView struct {
	domain.Habit
	Today         string `json:"today"`
	CurrentStreak int    `json:"current_streak"`
	LongestStreak int    `json:"longest_streak"`
	Total         int    `json:"total"`
}

func (s *Service) CreateHabit(ctx context.Context, user string, in CreateHabitInput) (HabitView, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 80 || utf8.RuneCountInString(in.Description) > 300 {
		return HabitView{}, fmt.Errorf("%w: 名称须为 1–80 字，说明不超过 300 字", domain.ErrInvalidInput)
	}
	if in.TimeZone == "" {
		in.TimeZone = "Asia/Shanghai"
	}
	zone, err := time.LoadLocation(in.TimeZone)
	if err != nil || in.TimeZone == "Local" {
		return HabitView{}, fmt.Errorf("%w: 无效时区", domain.ErrInvalidInput)
	}
	if in.Icon == "" {
		in.Icon = "read"
	}
	switch in.Icon {
	case "read", "move", "listen", "write", "water":
	default:
		return HabitView{}, fmt.Errorf("%w: 无效图标", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	h := domain.Habit{ID: platform.NewID(), UserID: user, Title: in.Title, Description: in.Description, Icon: in.Icon, TimeZone: in.TimeZone, StartDate: now.In(zone).Format("2006-01-02"), Checkins: []string{}, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateHabit(ctx, h); err != nil {
		return HabitView{}, err
	}
	return habitView(h, now), nil
}
func (s *Service) ListHabits(ctx context.Context, user string) ([]HabitView, error) {
	items, err := s.repo.ListHabits(ctx, user)
	if err != nil {
		return nil, err
	}
	result := make([]HabitView, 0, len(items))
	for _, h := range items {
		result = append(result, habitView(h, s.now()))
	}
	return result, nil
}
func (s *Service) CheckHabit(ctx context.Context, user, id, date string, checked bool) (HabitView, error) {
	h, err := s.repo.HabitByID(ctx, id)
	if err != nil {
		return HabitView{}, err
	}
	if h.UserID != user {
		return HabitView{}, domain.ErrNotFound
	}
	zone, err := time.LoadLocation(h.TimeZone)
	if err != nil {
		return HabitView{}, fmt.Errorf("%w: 习惯时区无效", domain.ErrInvalidInput)
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Format("2006-01-02") != date || date < h.StartDate || date > s.now().In(zone).Format("2006-01-02") {
		return HabitView{}, fmt.Errorf("%w: 只能记录创建日起至今天的日期", domain.ErrInvalidInput)
	}
	h, err = s.repo.SetHabitCheck(ctx, user, id, date, checked, s.now().UTC())
	if err != nil {
		return HabitView{}, err
	}
	return habitView(h, s.now()), nil
}
func (s *Service) ArchiveHabit(ctx context.Context, user, id string, archived bool) (HabitView, error) {
	h, err := s.repo.SetHabitArchived(ctx, user, id, archived, s.now().UTC())
	if err != nil {
		return HabitView{}, err
	}
	return habitView(h, s.now()), nil
}
func habitView(h domain.Habit, now time.Time) HabitView {
	zone, err := time.LoadLocation(h.TimeZone)
	if err != nil {
		zone = time.UTC
	}
	today := now.In(zone).Format("2006-01-02")
	v := HabitView{Habit: h, Today: today}
	dates := append([]string{}, h.Checkins...)
	sort.Strings(dates)
	seen := map[string]bool{}
	run := 0
	previous := ""
	for _, key := range dates {
		d, err := time.Parse("2006-01-02", key)
		if err != nil || key > today || seen[key] {
			continue
		}
		seen[key] = true
		v.Total++
		if previous == d.AddDate(0, 0, -1).Format("2006-01-02") {
			run++
		} else {
			run = 1
		}
		if run > v.LongestStreak {
			v.LongestStreak = run
		}
		previous = key
	}
	d, _ := time.Parse("2006-01-02", today)
	if !seen[today] {
		d = d.AddDate(0, 0, -1)
	}
	for seen[d.Format("2006-01-02")] {
		v.CurrentStreak++
		d = d.AddDate(0, 0, -1)
	}
	return v
}
