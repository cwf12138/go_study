package service

import (
	"context"
	"fmt"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

func (s *Service) StartFocus(ctx context.Context, userID, taskID string, plannedMinutes int) (domain.FocusSession, error) {
	if plannedMinutes < 1 || plannedMinutes > 240 {
		return domain.FocusSession{}, fmt.Errorf("%w: planned_minutes must be between 1 and 240", domain.ErrInvalidInput)
	}
	if taskID != "" {
		task, err := s.repo.TaskByID(ctx, taskID)
		if err != nil {
			return domain.FocusSession{}, err
		}
		if err := requireOwner(task.UserID, userID); err != nil {
			return domain.FocusSession{}, err
		}
	}
	session := domain.FocusSession{
		ID: platform.NewID(), UserID: userID, TaskID: taskID,
		PlannedMinutes: plannedMinutes, Status: domain.FocusRunning, StartedAt: s.now().UTC(),
	}
	if err := s.repo.CreateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.started", userID, session.ID, map[string]any{"planned_minutes": plannedMinutes})
	return session, nil
}

func (s *Service) FinishFocus(ctx context.Context, userID, sessionID string, abandoned bool) (domain.FocusSession, error) {
	session, err := s.repo.FocusSessionByID(ctx, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if err := requireOwner(session.UserID, userID); err != nil {
		return domain.FocusSession{}, err
	}
	if session.Status != domain.FocusRunning {
		return domain.FocusSession{}, fmt.Errorf("%w: focus session is already finished", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	session.EndedAt = &now
	session.ActualMinutes = max(1, int(now.Sub(session.StartedAt).Minutes()))
	if abandoned {
		session.Status = domain.FocusAbandoned
	} else {
		session.Status = domain.FocusCompleted
	}
	if err := s.repo.UpdateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.finished", userID, session.ID, map[string]any{"status": session.Status, "actual_minutes": session.ActualMinutes})
	return session, nil
}

func (s *Service) Dashboard(ctx context.Context, userID string) (domain.Dashboard, error) {
	now := s.now()
	goals, err := s.repo.ListGoals(ctx, userID)
	if err != nil {
		return domain.Dashboard{}, err
	}
	tasks, err := s.repo.ListTasks(ctx, userID, store.TaskFilter{})
	if err != nil {
		return domain.Dashboard{}, err
	}
	dueCards, err := s.repo.ListDueCards(ctx, userID, now.UTC(), 0)
	if err != nil {
		return domain.Dashboard{}, err
	}
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekday := (int(startOfDay.Weekday()) + 6) % 7
	startOfWeek := startOfDay.AddDate(0, 0, -weekday)
	sessions, err := s.repo.ListFocusSessions(ctx, userID, startOfWeek.UTC())
	if err != nil {
		return domain.Dashboard{}, err
	}

	result := domain.Dashboard{DueCards: len(dueCards), TasksByPriority: make(map[string]int)}
	for _, goal := range goals {
		if goal.Status == domain.GoalActive {
			result.ActiveGoals++
		}
	}
	for _, task := range tasks {
		if task.Status == domain.TaskDone {
			result.CompletedTasks++
		} else if task.Status != domain.TaskCancelled {
			result.PendingTasks++
			result.TasksByPriority[string(task.Priority)]++
		}
	}
	for _, session := range sessions {
		if session.Status != domain.FocusCompleted {
			continue
		}
		result.FocusMinutesWeek += session.ActualMinutes
		if !session.StartedAt.Before(startOfDay.UTC()) {
			result.FocusMinutesToday += session.ActualMinutes
		}
	}
	return result, nil
}
