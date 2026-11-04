package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type todoChangeRepository interface {
	CommitTodoChange(context.Context, domain.TodoItem, time.Time, *domain.TodoItem) error
	DeleteTodoIfUnchanged(context.Context, string, string, time.Time) error
	DeleteTodoListAndMove(context.Context, string, string, string, time.Time) error
}

// TodoVersion is an opaque value for If-Match. Clients preserve all fractional
// digits instead of round-tripping the timestamp through a millisecond Date.
func TodoVersion(todo domain.TodoItem) string {
	return todo.ID + "@" + todo.UpdatedAt.Format(time.RFC3339Nano)
}

func (s *Service) todoChanges() (todoChangeRepository, error) {
	repo, ok := s.repo.(todoChangeRepository)
	if !ok {
		return nil, fmt.Errorf("%w: repository cannot protect todo versions", domain.ErrInvalidState)
	}
	return repo, nil
}

func (s *Service) Todo(ctx context.Context, userID, id string) (domain.TodoItem, error) {
	todo, err := s.repo.TodoByID(ctx, id)
	if err != nil {
		return todo, err
	}
	return todo, requireOwner(todo.UserID, userID)
}

func (s *Service) todoForChange(ctx context.Context, userID, id string, expected []string) (domain.TodoItem, error) {
	todo, err := s.Todo(ctx, userID, id)
	if err != nil {
		return todo, err
	}
	if len(expected) > 1 {
		return todo, domain.ErrInvalidInput
	}
	if len(expected) == 1 && expected[0] != TodoVersion(todo) {
		return todo, domain.ErrConflict
	}
	return todo, nil
}

func (s *Service) commitTodo(ctx context.Context, todo domain.TodoItem, previous time.Time, next *domain.TodoItem) error {
	repo, err := s.todoChanges()
	if err != nil {
		return err
	}
	return repo.CommitTodoChange(ctx, todo, previous, next)
}

type EditTodoStep struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
}

// This replaces only editable fields. Status, source receipts, occurrence links
// and creation metadata can never be supplied or overwritten by an editor.
type UpdateTodoInput struct {
	ListID     string                `json:"list_id"`
	Title      string                `json:"title"`
	Notes      string                `json:"notes"`
	Priority   domain.TaskPriority   `json:"priority"`
	DueAt      *time.Time            `json:"due_at"`
	MyDayDate  string                `json:"my_day_date"`
	RepeatRule domain.TodoRepeatRule `json:"repeat_rule"`
	Tags       []string              `json:"tags"`
	Steps      []EditTodoStep        `json:"steps"`
}

func (s *Service) UpdateTodo(ctx context.Context, userID, id, version string, in UpdateTodoInput) (domain.TodoItem, error) {
	if version == "" {
		return domain.TodoItem{}, fmt.Errorf("%w: If-Match is required", domain.ErrInvalidInput)
	}
	todo, err := s.todoForChange(ctx, userID, id, []string{version})
	if err != nil {
		return domain.TodoItem{}, err
	}
	in.Title, in.Notes = strings.TrimSpace(in.Title), strings.TrimSpace(in.Notes)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 200 || utf8.RuneCountInString(in.Notes) > 6000 {
		return todo, domain.ErrInvalidInput
	}
	if in.Priority != domain.PriorityLow && in.Priority != domain.PriorityMedium && in.Priority != domain.PriorityHigh {
		return todo, domain.ErrInvalidInput
	}
	if in.RepeatRule != domain.TodoRepeatNone && in.RepeatRule != domain.TodoRepeatDaily && in.RepeatRule != domain.TodoRepeatWeekly && in.RepeatRule != domain.TodoRepeatMonthly {
		return todo, domain.ErrInvalidInput
	}
	if in.RepeatRule != domain.TodoRepeatNone && in.DueAt == nil {
		return todo, fmt.Errorf("%w: recurring todos require a due date", domain.ErrInvalidInput)
	}
	date, err := normalizeTodoDate(in.MyDayDate, false)
	if err != nil {
		return todo, err
	}
	if todo.Status == domain.TodoCompleted && date != "" {
		return todo, fmt.Errorf("%w: completed todo cannot be added to My Day", domain.ErrInvalidState)
	}
	list, err := s.repo.TodoListByID(ctx, strings.TrimSpace(in.ListID))
	if errors.Is(err, domain.ErrNotFound) {
		return todo, domain.ErrConflict
	}
	if err != nil {
		return todo, err
	}
	if err := requireOwner(list.UserID, userID); err != nil {
		return todo, err
	}
	if len(in.Steps) > 30 {
		return todo, domain.ErrInvalidInput
	}
	oldSteps, seen := map[string]domain.TodoStep{}, map[string]bool{}
	for _, step := range todo.Steps {
		oldSteps[step.ID] = step
	}
	now := s.nextRecordTime(todo.UpdatedAt)
	steps := make([]domain.TodoStep, 0, len(in.Steps))
	for _, edit := range in.Steps {
		title := strings.TrimSpace(edit.Title)
		if title == "" || utf8.RuneCountInString(title) > 200 {
			return todo, domain.ErrInvalidInput
		}
		step := domain.TodoStep{ID: platform.NewID(), CreatedAt: now}
		if edit.ID != "" {
			var exists bool
			step, exists = oldSteps[edit.ID]
			if !exists || seen[edit.ID] {
				return todo, fmt.Errorf("%w: invalid or duplicate step ID", domain.ErrInvalidInput)
			}
			seen[edit.ID] = true
		}
		step.Title, step.Completed = title, edit.Completed
		steps = append(steps, step)
	}
	previous := todo.UpdatedAt
	todo.Title, todo.Notes, todo.ListID, todo.Priority = in.Title, in.Notes, list.ID, in.Priority
	todo.DueAt, todo.MyDayDate, todo.RepeatRule, todo.Tags, todo.Steps, todo.UpdatedAt = in.DueAt, date, in.RepeatRule, cleanTags(in.Tags), steps, now
	if err := s.commitTodo(ctx, todo, previous, nil); err != nil {
		return domain.TodoItem{}, err
	}
	s.publish("todo.updated", userID, id, nil)
	return todo, nil
}
