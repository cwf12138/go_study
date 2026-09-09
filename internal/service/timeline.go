package service

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

type TimelineItem struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`
	Title   string    `json:"title"`
	At      time.Time `json:"at"`
	Minutes int       `json:"minutes,omitempty"`
}
type TimelineResult struct {
	Items        []TimelineItem `json:"items"`
	Total        int            `json:"total"`
	Page         int            `json:"page"`
	Pages        int            `json:"pages"`
	ActiveDays   int            `json:"active_days"`
	FocusMinutes int            `json:"focus_minutes"`
}

// Timeline is a projection of current records, not an immutable audit log.
func (s *Service) Timeline(ctx context.Context, userID, month, kind string, offset, page int) (TimelineResult, error) {
	result := TimelineResult{Items: []TimelineItem{}, Page: page}
	if offset < -840 || offset > 840 || page < 1 || page > 100000 {
		return result, fmt.Errorf("%w: invalid timeline parameters", domain.ErrInvalidInput)
	}
	valid := map[string]bool{"": true, "task": true, "todo": true, "focus": true, "book": true, "memo": true}
	if !valid[kind] {
		return result, fmt.Errorf("%w: invalid activity type", domain.ErrInvalidInput)
	}
	zone := time.FixedZone("timeline", offset*60)
	start, err := time.ParseInLocation("2006-01", month, zone)
	if err != nil {
		return result, fmt.Errorf("%w: month must be YYYY-MM", domain.ErrInvalidInput)
	}
	end := start.AddDate(0, 1, 0)
	items := []TimelineItem{}
	add := func(id, k, title string, at time.Time, minutes int) {
		if (kind == "" || kind == k) && !at.Before(start) && at.Before(end) {
			items = append(items, TimelineItem{ID: k + ":" + id, Kind: k, Title: title, At: at, Minutes: minutes})
		}
	}
	tasks, err := s.repo.ListTasks(ctx, userID, store.TaskFilter{})
	if err != nil {
		return result, err
	}
	for _, item := range tasks {
		if item.CompletedAt != nil && item.Status == domain.TaskDone {
			add(item.ID, "task", item.Title, *item.CompletedAt, 0)
		}
	}
	todos, err := s.repo.ListTodos(ctx, userID, store.TodoFilter{})
	if err != nil {
		return result, err
	}
	for _, item := range todos {
		if item.CompletedAt != nil && item.Status == domain.TodoCompleted {
			add(item.ID, "todo", item.Title, *item.CompletedAt, 0)
		}
	}
	sessions, err := s.repo.ListFocusSessions(ctx, userID, time.Time{})
	if err != nil {
		return result, err
	}
	for _, item := range sessions {
		if item.EndedAt != nil && item.Status == domain.FocusCompleted {
			add(item.ID, "focus", "完成一次专注", *item.EndedAt, item.ActualMinutes)
		}
	}
	books, err := s.repo.ListEBookReadings(ctx, userID)
	if err != nil {
		return result, err
	}
	for _, item := range books {
		if item.CompletedAt != nil && item.Status == "completed" {
			add(item.ID, "book", item.Book.Title, *item.CompletedAt, 0)
		}
	}
	memos, err := s.repo.ListMemoNotes(ctx, userID)
	if err != nil {
		return result, err
	}
	for _, item := range memos {
		if item.DeletedAt == nil {
			add(item.ID, "memo", item.Title, item.CreatedAt, 0)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].At.Equal(items[j].At) {
			return items[i].ID < items[j].ID
		}
		return items[i].At.After(items[j].At)
	})
	days := map[string]bool{}
	for _, item := range items {
		days[item.At.In(zone).Format("2006-01-02")] = true
		result.FocusMinutes += item.Minutes
	}
	result.Total = len(items)
	result.ActiveDays = len(days)
	result.Pages = (len(items) + 19) / 20
	begin := (page - 1) * 20
	if begin < len(items) {
		result.Items = items[begin:min(begin+20, len(items))]
	}
	return result, nil
}
