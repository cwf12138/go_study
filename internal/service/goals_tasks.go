package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

type CreateGoalInput struct {
	Title         string
	Description   string
	TargetMinutes int
	Deadline      *time.Time
}

func (s *Service) CreateGoal(ctx context.Context, userID string, input CreateGoalInput) (domain.Goal, error) {
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || len(input.Title) > 160 || input.TargetMinutes < 0 {
		return domain.Goal{}, fmt.Errorf("%w: title is required and target_minutes cannot be negative", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	if input.Deadline != nil && input.Deadline.Before(now) {
		return domain.Goal{}, fmt.Errorf("%w: deadline must be in the future", domain.ErrInvalidInput)
	}
	goal := domain.Goal{
		ID: platform.NewID(), UserID: userID, Title: input.Title,
		Description: strings.TrimSpace(input.Description), TargetMinutes: input.TargetMinutes,
		Deadline: input.Deadline, Status: domain.GoalActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateGoal(ctx, goal); err != nil {
		return domain.Goal{}, err
	}
	s.publish("goal.created", userID, goal.ID, map[string]any{"title": goal.Title})
	return goal, nil
}

func (s *Service) ListGoals(ctx context.Context, userID string) ([]domain.Goal, error) {
	return s.repo.ListGoals(ctx, userID)
}

func (s *Service) ChangeGoalStatus(ctx context.Context, userID, goalID string, status domain.GoalStatus) (domain.Goal, error) {
	goal, err := s.repo.GoalByID(ctx, goalID)
	if err != nil {
		return domain.Goal{}, err
	}
	if err := requireOwner(goal.UserID, userID); err != nil {
		return domain.Goal{}, err
	}
	if !allowedGoalTransition(goal.Status, status) {
		return domain.Goal{}, fmt.Errorf("%w: cannot change goal from %s to %s", domain.ErrInvalidState, goal.Status, status)
	}
	goal.Status = status
	goal.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateGoal(ctx, goal); err != nil {
		return domain.Goal{}, err
	}
	s.publish("goal.status_changed", userID, goal.ID, map[string]any{"status": status})
	return goal, nil
}

func allowedGoalTransition(from, to domain.GoalStatus) bool {
	if from == to {
		return true
	}
	switch from {
	case domain.GoalActive:
		return to == domain.GoalCompleted || to == domain.GoalArchived
	case domain.GoalCompleted, domain.GoalArchived:
		return to == domain.GoalActive
	default:
		return false
	}
}

type CreateTaskInput struct {
	GoalID           string
	Title            string
	Description      string
	EstimatedMinutes int
	Priority         domain.TaskPriority
	DueAt            *time.Time
	Tags             []string
}

func (s *Service) CreateTask(ctx context.Context, userID string, input CreateTaskInput) (domain.StudyTask, error) {
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || len(input.Title) > 200 || input.EstimatedMinutes < 0 || input.EstimatedMinutes > 24*60 {
		return domain.StudyTask{}, fmt.Errorf("%w: invalid title or estimated_minutes", domain.ErrInvalidInput)
	}
	if input.Priority == "" {
		input.Priority = domain.PriorityMedium
	}
	if input.Priority != domain.PriorityLow && input.Priority != domain.PriorityMedium && input.Priority != domain.PriorityHigh {
		return domain.StudyTask{}, fmt.Errorf("%w: priority must be low, medium, or high", domain.ErrInvalidInput)
	}
	if input.GoalID != "" {
		goal, err := s.repo.GoalByID(ctx, input.GoalID)
		if err != nil {
			return domain.StudyTask{}, err
		}
		if err := requireOwner(goal.UserID, userID); err != nil {
			return domain.StudyTask{}, err
		}
	}
	now := s.now().UTC()
	task := domain.StudyTask{
		ID: platform.NewID(), UserID: userID, GoalID: input.GoalID,
		Title: input.Title, Description: strings.TrimSpace(input.Description),
		EstimatedMinutes: input.EstimatedMinutes, Priority: input.Priority,
		Status: domain.TaskTodo, DueAt: input.DueAt, Tags: cleanTags(input.Tags),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateTask(ctx, task); err != nil {
		return domain.StudyTask{}, err
	}
	s.publish("task.created", userID, task.ID, map[string]any{"priority": task.Priority})
	return task, nil
}

func (s *Service) ListTasks(ctx context.Context, userID string, filter store.TaskFilter) ([]domain.StudyTask, error) {
	return s.repo.ListTasks(ctx, userID, filter)
}

func (s *Service) ChangeTaskStatus(ctx context.Context, userID, taskID string, status domain.TaskStatus) (domain.StudyTask, error) {
	task, err := s.repo.TaskByID(ctx, taskID)
	if err != nil {
		return domain.StudyTask{}, err
	}
	if err := requireOwner(task.UserID, userID); err != nil {
		return domain.StudyTask{}, err
	}
	if !allowedTaskTransition(task.Status, status) {
		return domain.StudyTask{}, fmt.Errorf("%w: cannot change task from %s to %s", domain.ErrInvalidState, task.Status, status)
	}
	now := s.now().UTC()
	task.Status = status
	task.UpdatedAt = now
	if status == domain.TaskDone {
		task.CompletedAt = &now
	} else {
		task.CompletedAt = nil
	}
	if err := s.repo.UpdateTask(ctx, task); err != nil {
		return domain.StudyTask{}, err
	}
	s.publish("task.status_changed", userID, task.ID, map[string]any{"status": status})
	return task, nil
}

func allowedTaskTransition(from, to domain.TaskStatus) bool {
	if from == to {
		return true
	}
	switch from {
	case domain.TaskTodo:
		return to == domain.TaskInProgress || to == domain.TaskDone || to == domain.TaskCancelled
	case domain.TaskInProgress:
		return to == domain.TaskTodo || to == domain.TaskDone || to == domain.TaskCancelled
	case domain.TaskDone:
		return to == domain.TaskTodo
	case domain.TaskCancelled:
		return to == domain.TaskTodo
	default:
		return false
	}
}
