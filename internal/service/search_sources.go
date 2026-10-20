package service

import (
	"context"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func (s *Service) searchSource(ctx context.Context, user, source string, emit func(string, searchDocument) bool) error {
	add := func(owner, id, title, body, state, date string, tags []string, archived bool, updated, created time.Time) bool {
		if title == "" {
			title = "无标题记录"
		}
		return emit(owner, searchDocument{SearchHit: domain.SearchHit{Source: source, ID: id, Title: title, State: state, Date: date, Tags: append([]string{}, tags...), Archived: archived, UpdatedAt: searchStamp(updated, created)}, body: body})
	}
	switch source {
	case "memos":
		rows, e := s.repo.ListMemoNotes(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if r.DeletedAt == nil && !add(r.UserID, r.ID, r.Title, r.Content, "备忘录", "", r.Tags, r.Archived, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "todos":
		rows, e := s.repo.ListTodos(ctx, user, store.TodoFilter{})
		if e != nil {
			return e
		}
		for _, r := range rows {
			body := r.Notes
			for _, step := range r.Steps {
				body += "\n" + step.Title
			}
			if !add(r.UserID, r.ID, r.Title, body, string(r.Status), "", r.Tags, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "tasks":
		rows, e := s.repo.ListTasks(ctx, user, store.TaskFilter{})
		if e != nil {
			return e
		}
		for _, r := range rows {
			if !add(r.UserID, r.ID, r.Title, r.Description, string(r.Status), "", r.Tags, r.Status == domain.TaskCancelled, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "goals":
		rows, e := s.repo.ListGoals(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if !add(r.UserID, r.ID, r.Title, r.Description, string(r.Status), "", nil, r.Status == domain.GoalArchived, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "calendar":
		rows, e := s.repo.ListCalendarEvents(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			date := r.StartAt.In(calendarLocation).Format(calendarDateLayout)
			if !add(r.UserID, r.ID, r.Title, r.Description+"\n"+r.Location+"\n"+date, "日程", date, []string{r.Category}, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "moods":
		rows, e := s.repo.ListAllMoodEntries(ctx, user)
		if e != nil {
			return e
		}
		labels := map[domain.Mood]string{domain.MoodAwful: "很糟", domain.MoodLow: "低落", domain.MoodNeutral: "平静", domain.MoodGood: "不错", domain.MoodGreat: "很好"}
		for _, r := range rows {
			if !add(r.UserID, r.ID, r.Date+" · "+labels[r.Mood], r.Note+"\n"+strings.Join(r.Activities, " "), labels[r.Mood], r.Date, r.Tags, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "inventory":
		rows, e := s.repo.ListInventory(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if !add(r.UserID, r.ID, r.Name, r.Note+"\n"+r.Location+"\n"+r.Borrower, "物品", "", []string{r.Category}, r.Archived, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "bookmarks":
		rows, e := s.repo.ListBookmarks(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if !r.Deleted && !add(r.UserID, r.ID, r.Title, r.Note+"\n"+r.URL, "收藏", "", []string{r.Folder}, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "care":
		rows, e := s.repo.ListCare(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if r.Deleted {
				continue
			}
			body := r.Note
			for _, h := range r.History {
				body += "\n" + h.Date + " " + h.Note
			}
			if !add(r.UserID, r.ID, r.Title, body, r.State, careEffective(r), []string{r.Category}, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	case "fitness":
		rows, e := s.repo.ListFitness(ctx, user)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if r.Deleted || r.Kind == "settings" {
				continue
			}
			body := r.Note + "\n" + r.Date
			for _, m := range r.Moves {
				body += "\n" + m.Name + " " + m.Instruction
			}
			if !add(r.UserID, r.ID, r.Title, body, r.State, r.Date, []string{r.Kind, r.Category}, false, r.UpdatedAt, r.CreatedAt) {
				break
			}
		}
	}
	return ctx.Err()
}
