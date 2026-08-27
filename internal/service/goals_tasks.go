package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

type CreateGoalInput struct {
	Title       string
	Description string
	Deadline    *time.Time
}

func (s *Service) CreateGoal(ctx context.Context, userID string, input CreateGoalInput) (domain.Goal, error) {
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || len(input.Title) > 160 {
		return domain.Goal{}, fmt.Errorf("%w: title is required", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	if input.Deadline != nil && input.Deadline.Before(now) {
		return domain.Goal{}, fmt.Errorf("%w: deadline must be in the future", domain.ErrInvalidInput)
	}
	goal := domain.Goal{
		ID: platform.NewID(), UserID: userID, Title: input.Title,
		Description: strings.TrimSpace(input.Description),
		Deadline:    input.Deadline, Status: domain.GoalActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateGoal(ctx, goal); err != nil {
		return domain.Goal{}, err
	}
	s.publish("goal.created", userID, goal.ID, map[string]any{"title": goal.Title})
	return goal, nil
}

type GoalSort string

const (
	GoalSortCreatedAt GoalSort = "created_at"
	GoalSortUpdatedAt GoalSort = "updated_at"
	GoalSortDeadline  GoalSort = "deadline"
	GoalSortTitle     GoalSort = "title"
)

type SortOrder string

const (
	SortAscending  SortOrder = "asc"
	SortDescending SortOrder = "desc"
)

type ListGoalsInput struct {
	Status   domain.GoalStatus
	SortBy   GoalSort
	Order    SortOrder
	Page     int
	PageSize int
}

type GoalListPage struct {
	Items      []domain.Goal
	Count      int
	Total      int
	Page       int
	PageSize   int
	TotalPages int
}

func (s *Service) ListGoals(ctx context.Context, userID string, input ListGoalsInput) (GoalListPage, error) {
	input, err := normalizeGoalListInput(input)
	if err != nil {
		return GoalListPage{}, err
	}
	items, err := s.repo.ListGoals(ctx, userID)
	if err != nil {
		return GoalListPage{}, err
	}
	if input.Status != "" {
		filtered := items[:0]
		for _, goal := range items {
			if goal.Status == input.Status {
				filtered = append(filtered, goal)
			}
		}
		items = filtered
	}
	sort.Slice(items, func(i, j int) bool { return lessGoal(items[i], items[j], input.SortBy, input.Order) })

	total := len(items)
	totalPages := (total + input.PageSize - 1) / input.PageSize
	if totalPages > 0 && input.Page > totalPages {
		input.Page = totalPages
	}
	start := (input.Page - 1) * input.PageSize
	if start > total {
		start = total
	}
	end := min(start+input.PageSize, total)
	pageItems := items[start:end]
	return GoalListPage{
		Items: pageItems, Count: len(pageItems), Total: total,
		Page: input.Page, PageSize: input.PageSize, TotalPages: totalPages,
	}, nil
}

func normalizeGoalListInput(input ListGoalsInput) (ListGoalsInput, error) {
	if input.Status != "" && input.Status != domain.GoalActive && input.Status != domain.GoalCompleted && input.Status != domain.GoalArchived {
		return ListGoalsInput{}, fmt.Errorf("%w: status must be active, completed, or archived", domain.ErrInvalidInput)
	}
	if input.SortBy == "" {
		input.SortBy = GoalSortCreatedAt
	}
	if input.SortBy != GoalSortCreatedAt && input.SortBy != GoalSortUpdatedAt && input.SortBy != GoalSortDeadline && input.SortBy != GoalSortTitle {
		return ListGoalsInput{}, fmt.Errorf("%w: unsupported sort field", domain.ErrInvalidInput)
	}
	if input.Order == "" {
		input.Order = SortDescending
	}
	if input.Order != SortAscending && input.Order != SortDescending {
		return ListGoalsInput{}, fmt.Errorf("%w: order must be asc or desc", domain.ErrInvalidInput)
	}
	if input.Page == 0 {
		input.Page = 1
	}
	if input.Page < 1 {
		return ListGoalsInput{}, fmt.Errorf("%w: page must be at least 1", domain.ErrInvalidInput)
	}
	if input.PageSize == 0 {
		input.PageSize = 8
	}
	if input.PageSize < 1 || input.PageSize > 50 {
		return ListGoalsInput{}, fmt.Errorf("%w: page_size must be between 1 and 50", domain.ErrInvalidInput)
	}
	return input, nil
}

func lessGoal(left, right domain.Goal, sortBy GoalSort, order SortOrder) bool {
	if sortBy == GoalSortDeadline && left.Deadline == nil && right.Deadline != nil {
		return false
	}
	if sortBy == GoalSortDeadline && left.Deadline != nil && right.Deadline == nil {
		return true
	}
	var comparison int
	switch sortBy {
	case GoalSortUpdatedAt:
		comparison = left.UpdatedAt.Compare(right.UpdatedAt)
	case GoalSortDeadline:
		if left.Deadline != nil && right.Deadline != nil {
			comparison = left.Deadline.Compare(*right.Deadline)
		}
	case GoalSortTitle:
		comparison = strings.Compare(strings.ToLower(left.Title), strings.ToLower(right.Title))
	default:
		comparison = left.CreatedAt.Compare(right.CreatedAt)
	}
	if comparison == 0 {
		comparison = strings.Compare(left.ID, right.ID)
	}
	if order == SortAscending {
		return comparison < 0
	}
	return comparison > 0
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
