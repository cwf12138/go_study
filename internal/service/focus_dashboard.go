package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

const defaultBreakMinutes = 5

type StartFocusInput struct {
	TaskID         string
	PlannedMinutes int
	BreakEnabled   bool
}

func (s *Service) StartFocus(ctx context.Context, userID string, input StartFocusInput) (domain.FocusSession, error) {
	if input.PlannedMinutes < 1 || input.PlannedMinutes > 240 {
		return domain.FocusSession{}, fmt.Errorf("%w: planned_minutes must be between 1 and 240", domain.ErrInvalidInput)
	}
	if _, err := s.repo.ActiveFocusSession(ctx, userID); err == nil {
		return domain.FocusSession{}, fmt.Errorf("%w: finish or abandon the current focus session first", domain.ErrConflict)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.FocusSession{}, err
	}
	if input.TaskID != "" {
		task, err := s.repo.TaskByID(ctx, input.TaskID)
		if err != nil {
			return domain.FocusSession{}, err
		}
		if err := requireOwner(task.UserID, userID); err != nil {
			return domain.FocusSession{}, err
		}
	}
	now := s.now().UTC()
	session := domain.FocusSession{
		ID: platform.NewID(), UserID: userID, TaskID: input.TaskID,
		PlannedMinutes: input.PlannedMinutes, BreakEnabled: input.BreakEnabled,
		Phase: domain.FocusPhaseFocus, Status: domain.FocusRunning,
		PhaseStartedAt: now, PhaseRemainingSeconds: input.PlannedMinutes * 60, StartedAt: now,
	}
	if input.BreakEnabled {
		session.BreakMinutes = defaultBreakMinutes
		session.Phase = domain.FocusPhaseFocusFirst
		session.PhaseRemainingSeconds = firstFocusSeconds(input.PlannedMinutes)
	}
	if err := s.repo.CreateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.started", userID, session.ID, map[string]any{"planned_minutes": input.PlannedMinutes, "break_enabled": input.BreakEnabled})
	return session, nil
}

func (s *Service) ActiveFocus(ctx context.Context, userID string) (*domain.FocusSession, error) {
	session, err := s.repo.ActiveFocusSession(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Service) PauseFocus(ctx context.Context, userID, sessionID string) (domain.FocusSession, error) {
	session, err := s.focusSessionForUser(ctx, userID, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if session.Status != domain.FocusRunning {
		return domain.FocusSession{}, fmt.Errorf("%w: only a running focus session can be paused", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	session = consumeRunningPhase(session, now)
	session.Status = domain.FocusPaused
	session.PausedAt = &now
	if err := s.repo.UpdateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.paused", userID, session.ID, map[string]any{"phase": session.Phase, "remaining_seconds": session.PhaseRemainingSeconds})
	return session, nil
}

func (s *Service) ResumeFocus(ctx context.Context, userID, sessionID string) (domain.FocusSession, error) {
	session, err := s.focusSessionForUser(ctx, userID, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if session.Status != domain.FocusPaused {
		return domain.FocusSession{}, fmt.Errorf("%w: only a paused focus session can be resumed", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	session.Status = domain.FocusRunning
	session.PausedAt = nil
	session.PhaseStartedAt = now
	if err := s.repo.UpdateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.resumed", userID, session.ID, map[string]any{"phase": session.Phase, "remaining_seconds": session.PhaseRemainingSeconds})
	return session, nil
}

// AdvanceFocus moves from the first focus segment to the break, then from the
// break to the second focus segment. The client cannot skip an unfinished phase.
func (s *Service) AdvanceFocus(ctx context.Context, userID, sessionID string) (domain.FocusSession, error) {
	session, err := s.focusSessionForUser(ctx, userID, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if session.Status != domain.FocusRunning {
		return domain.FocusSession{}, fmt.Errorf("%w: only a running focus session can advance", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	session = consumeRunningPhase(session, now)
	if session.PhaseRemainingSeconds > 0 {
		return domain.FocusSession{}, fmt.Errorf("%w: current phase has not finished", domain.ErrInvalidState)
	}
	switch session.Phase {
	case domain.FocusPhaseFocusFirst:
		session.Phase = domain.FocusPhaseBreak
		session.PhaseRemainingSeconds = session.BreakMinutes * 60
	case domain.FocusPhaseBreak:
		session.Phase = domain.FocusPhaseFocusSecond
		session.PhaseRemainingSeconds = secondFocusSeconds(session.PlannedMinutes)
	default:
		return domain.FocusSession{}, fmt.Errorf("%w: this focus session has no next phase", domain.ErrInvalidState)
	}
	session.PhaseStartedAt = now
	if err := s.repo.UpdateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.phase_advanced", userID, session.ID, map[string]any{"phase": session.Phase, "remaining_seconds": session.PhaseRemainingSeconds})
	return session, nil
}

func (s *Service) FinishFocus(ctx context.Context, userID, sessionID string, abandoned bool) (domain.FocusSession, error) {
	session, err := s.focusSessionForUser(ctx, userID, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if session.Status != domain.FocusRunning && session.Status != domain.FocusPaused {
		return domain.FocusSession{}, fmt.Errorf("%w: focus session is already finished", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	if session.Status == domain.FocusRunning {
		session = consumeRunningPhase(session, now)
	}
	session.EndedAt = &now
	session.PausedAt = nil
	session.ActualMinutes = focusedMinutes(session.FocusedSeconds)
	if abandoned {
		session.Status = domain.FocusAbandoned
	} else {
		session.Status = domain.FocusCompleted
	}
	if err := s.repo.UpdateFocusSession(ctx, session); err != nil {
		return domain.FocusSession{}, err
	}
	s.publish("focus.finished", userID, session.ID, map[string]any{"status": session.Status, "actual_minutes": session.ActualMinutes, "focused_seconds": session.FocusedSeconds})
	return session, nil
}

func (s *Service) focusSessionForUser(ctx context.Context, userID, sessionID string) (domain.FocusSession, error) {
	session, err := s.repo.FocusSessionByID(ctx, sessionID)
	if err != nil {
		return domain.FocusSession{}, err
	}
	if err := requireOwner(session.UserID, userID); err != nil {
		return domain.FocusSession{}, err
	}
	return session, nil
}

func consumeRunningPhase(session domain.FocusSession, now time.Time) domain.FocusSession {
	if session.Status != domain.FocusRunning || session.PhaseRemainingSeconds <= 0 {
		return session
	}
	elapsed := max(0, int(now.Sub(session.PhaseStartedAt).Seconds()))
	consumed := min(session.PhaseRemainingSeconds, elapsed)
	session.PhaseRemainingSeconds -= consumed
	if session.Phase != domain.FocusPhaseBreak {
		session.FocusedSeconds += consumed
	}
	session.PhaseStartedAt = now
	return session
}

func focusedMinutes(seconds int) int {
	if seconds <= 0 {
		return 0
	}
	return int(math.Ceil(float64(seconds) / 60))
}

func firstFocusSeconds(plannedMinutes int) int {
	return (plannedMinutes*60 + 1) / 2
}

func secondFocusSeconds(plannedMinutes int) int {
	return plannedMinutes*60 - firstFocusSeconds(plannedMinutes)
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
			if task.CompletedAt != nil && !task.CompletedAt.Before(startOfDay.UTC()) {
				result.CompletedTasksToday++
			}
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
		if session.EndedAt != nil && !session.EndedAt.Before(startOfDay.UTC()) {
			result.FocusMinutesToday += session.ActualMinutes
			result.FocusSessionsToday++
		}
	}
	return result, nil
}
