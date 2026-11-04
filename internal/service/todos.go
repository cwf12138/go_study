package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

const todoInboxName = "收集箱"

type CreateTodoListInput struct {
	Name  string
	Color string
}

func (s *Service) EnsureTodoInbox(ctx context.Context, userID string) (domain.TodoList, error) {
	lists, err := s.repo.ListTodoLists(ctx, userID)
	if err != nil {
		return domain.TodoList{}, err
	}
	for _, list := range lists {
		if list.Kind == domain.TodoListInbox {
			return list, nil
		}
	}
	now := s.now().UTC()
	inbox := domain.TodoList{
		ID: platform.NewID(), UserID: userID, Name: todoInboxName, Color: "#5b81ff",
		Kind: domain.TodoListInbox, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateTodoList(ctx, inbox); err != nil {
		if !errors.Is(err, domain.ErrConflict) {
			return domain.TodoList{}, err
		}
		lists, listErr := s.repo.ListTodoLists(ctx, userID)
		if listErr != nil {
			return domain.TodoList{}, listErr
		}
		for _, list := range lists {
			if list.Kind == domain.TodoListInbox {
				return list, nil
			}
		}
		return domain.TodoList{}, err
	}
	return inbox, nil
}

func (s *Service) ListTodoLists(ctx context.Context, userID string) ([]domain.TodoList, error) {
	if _, err := s.EnsureTodoInbox(ctx, userID); err != nil {
		return nil, err
	}
	return s.repo.ListTodoLists(ctx, userID)
}

func (s *Service) CreateTodoList(ctx context.Context, userID string, input CreateTodoListInput) (domain.TodoList, error) {
	if _, err := s.EnsureTodoInbox(ctx, userID); err != nil {
		return domain.TodoList{}, err
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Color = strings.TrimSpace(input.Color)
	if input.Name == "" || len(input.Name) > 80 || (input.Color != "" && !isTodoColor(input.Color)) {
		return domain.TodoList{}, fmt.Errorf("%w: list name or color is invalid", domain.ErrInvalidInput)
	}
	lists, err := s.repo.ListTodoLists(ctx, userID)
	if err != nil {
		return domain.TodoList{}, err
	}
	for _, list := range lists {
		if strings.EqualFold(list.Name, input.Name) {
			return domain.TodoList{}, fmt.Errorf("%w: a list with this name already exists", domain.ErrConflict)
		}
	}
	now := s.now().UTC()
	list := domain.TodoList{
		ID: platform.NewID(), UserID: userID, Name: input.Name, Color: input.Color,
		Kind: domain.TodoListCustom, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateTodoList(ctx, list); err != nil {
		return domain.TodoList{}, err
	}
	s.publish("todo_list.created", userID, list.ID, nil)
	return list, nil
}

func (s *Service) DeleteTodoList(ctx context.Context, userID, listID string) error {
	list, err := s.repo.TodoListByID(ctx, listID)
	if err != nil {
		return err
	}
	if err := requireOwner(list.UserID, userID); err != nil {
		return err
	}
	if list.Kind == domain.TodoListInbox {
		return fmt.Errorf("%w: inbox cannot be deleted", domain.ErrInvalidState)
	}
	inbox, err := s.EnsureTodoInbox(ctx, userID)
	if err != nil {
		return err
	}
	writer, err := s.todoChanges()
	if err != nil {
		return err
	}
	if err := writer.DeleteTodoListAndMove(ctx, userID, list.ID, inbox.ID, s.now().UTC()); err != nil {
		return err
	}
	s.publish("todo_list.deleted", userID, list.ID, nil)
	return nil
}

type CreateTodoInput struct {
	ListID     string
	Title      string
	Notes      string
	Priority   domain.TaskPriority
	DueAt      *time.Time
	MyDayDate  string
	RepeatRule domain.TodoRepeatRule
	Tags       []string
	Steps      []string
}

func (s *Service) CreateTodo(ctx context.Context, userID string, input CreateTodoInput) (domain.TodoItem, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 200 || utf8.RuneCountInString(input.Notes) > 6000 {
		return domain.TodoItem{}, fmt.Errorf("%w: title or notes are invalid", domain.ErrInvalidInput)
	}
	if input.Priority == "" {
		input.Priority = domain.PriorityMedium
	}
	if input.Priority != domain.PriorityLow && input.Priority != domain.PriorityMedium && input.Priority != domain.PriorityHigh {
		return domain.TodoItem{}, fmt.Errorf("%w: priority must be low, medium, or high", domain.ErrInvalidInput)
	}
	if input.RepeatRule == "" {
		input.RepeatRule = domain.TodoRepeatNone
	}
	if input.RepeatRule != domain.TodoRepeatNone && input.RepeatRule != domain.TodoRepeatDaily && input.RepeatRule != domain.TodoRepeatWeekly && input.RepeatRule != domain.TodoRepeatMonthly {
		return domain.TodoItem{}, fmt.Errorf("%w: unsupported repeat rule", domain.ErrInvalidInput)
	}
	if input.RepeatRule != domain.TodoRepeatNone && input.DueAt == nil {
		return domain.TodoItem{}, fmt.Errorf("%w: recurring todos require a due date", domain.ErrInvalidInput)
	}
	myDayDate, err := normalizeTodoDate(input.MyDayDate, false)
	if err != nil {
		return domain.TodoItem{}, err
	}
	listID := strings.TrimSpace(input.ListID)
	if listID == "" {
		inbox, err := s.EnsureTodoInbox(ctx, userID)
		if err != nil {
			return domain.TodoItem{}, err
		}
		listID = inbox.ID
	}
	list, err := s.repo.TodoListByID(ctx, listID)
	if err != nil {
		return domain.TodoItem{}, err
	}
	if err := requireOwner(list.UserID, userID); err != nil {
		return domain.TodoItem{}, err
	}
	now := s.now().UTC()
	steps, err := makeTodoSteps(input.Steps, now)
	if err != nil {
		return domain.TodoItem{}, err
	}
	todo := domain.TodoItem{
		ID: platform.NewID(), UserID: userID, ListID: list.ID, Title: input.Title, Notes: input.Notes,
		Priority: input.Priority, Status: domain.TodoOpen, DueAt: input.DueAt, MyDayDate: myDayDate,
		RepeatRule: input.RepeatRule, Tags: cleanTags(input.Tags), Steps: steps, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateTodo(ctx, todo); err != nil {
		return domain.TodoItem{}, err
	}
	s.publish("todo.created", userID, todo.ID, map[string]any{"list_id": todo.ListID})
	return todo, nil
}

type ListTodosInput struct {
	View     string
	ListID   string
	Status   domain.TodoStatus
	Priority domain.TaskPriority
	Tag      string
	Query    string
	Date     string
}

func (s *Service) ListTodos(ctx context.Context, userID string, input ListTodosInput) ([]domain.TodoItem, error) {
	inbox, err := s.EnsureTodoInbox(ctx, userID)
	if err != nil {
		return nil, err
	}
	input.View = strings.TrimSpace(input.View)
	if input.View == "" {
		input.View = "all"
	}
	if input.View != "all" && input.View != "inbox" && input.View != "today" && input.View != "upcoming" && input.View != "completed" {
		return nil, fmt.Errorf("%w: view must be all, inbox, today, upcoming, or completed", domain.ErrInvalidInput)
	}
	if input.Status != "" && input.Status != domain.TodoOpen && input.Status != domain.TodoCompleted {
		return nil, fmt.Errorf("%w: status must be open or completed", domain.ErrInvalidInput)
	}
	if input.Priority != "" && input.Priority != domain.PriorityLow && input.Priority != domain.PriorityMedium && input.Priority != domain.PriorityHigh {
		return nil, fmt.Errorf("%w: priority must be low, medium, or high", domain.ErrInvalidInput)
	}
	date, err := normalizeTodoDate(input.Date, true)
	if err != nil {
		return nil, err
	}
	filter := store.TodoFilter{ListID: strings.TrimSpace(input.ListID), Status: input.Status}
	items, err := s.repo.ListTodos(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	startOfToday, _ := time.Parse("2006-01-02", date)
	query := strings.ToLower(strings.TrimSpace(input.Query))
	tag := strings.ToLower(strings.TrimSpace(input.Tag))
	result := make([]domain.TodoItem, 0, len(items))
	for _, todo := range items {
		if !todoMatchesView(todo, input.View, inbox.ID, date, startOfToday) || (input.Priority != "" && todo.Priority != input.Priority) || !todoMatchesText(todo, query, tag) {
			continue
		}
		result = append(result, todo)
	}
	sort.SliceStable(result, func(i, j int) bool { return lessTodo(result[i], result[j]) })
	return result, nil
}

func todoMatchesView(todo domain.TodoItem, view, inboxID, date string, startOfToday time.Time) bool {
	switch view {
	case "inbox":
		return todo.ListID == inboxID && todo.Status == domain.TodoOpen
	case "today":
		return todo.MyDayDate == date && todo.Status == domain.TodoOpen
	case "upcoming":
		return todo.Status == domain.TodoOpen && todo.DueAt != nil && !todo.DueAt.Before(startOfToday)
	case "completed":
		return todo.Status == domain.TodoCompleted
	default:
		return true
	}
}

func todoMatchesText(todo domain.TodoItem, query, tag string) bool {
	if query != "" && !strings.Contains(strings.ToLower(todo.Title), query) && !strings.Contains(strings.ToLower(todo.Notes), query) {
		return false
	}
	if tag == "" {
		return true
	}
	for _, value := range todo.Tags {
		if strings.EqualFold(value, tag) {
			return true
		}
	}
	return false
}

func lessTodo(left, right domain.TodoItem) bool {
	if left.Status != right.Status {
		return left.Status == domain.TodoOpen
	}
	if left.Status == domain.TodoCompleted {
		return left.CompletedAt != nil && (right.CompletedAt == nil || left.CompletedAt.After(*right.CompletedAt))
	}
	if left.DueAt == nil && right.DueAt != nil {
		return false
	}
	if left.DueAt != nil && right.DueAt == nil {
		return true
	}
	if left.DueAt != nil && right.DueAt != nil && !left.DueAt.Equal(*right.DueAt) {
		return left.DueAt.Before(*right.DueAt)
	}
	return todoPriorityRank(left.Priority) > todoPriorityRank(right.Priority)
}

func (s *Service) CompleteTodo(ctx context.Context, userID, todoID string, completed bool, expected ...string) (domain.TodoItem, *domain.TodoItem, error) {
	todo, err := s.todoForChange(ctx, userID, todoID, expected)
	if err != nil {
		return domain.TodoItem{}, nil, err
	}
	if (todo.Status == domain.TodoCompleted) == completed {
		return todo, nil, nil
	}
	previous, now := todo.UpdatedAt, s.now().UTC()
	var next *domain.TodoItem
	if completed {
		todo.Status, todo.MyDayDate, todo.CompletedAt = domain.TodoCompleted, "", &now
		if todo.RepeatRule != domain.TodoRepeatNone && todo.NextTodoID == "" {
			if todo.RepeatRule != domain.TodoRepeatDaily && todo.RepeatRule != domain.TodoRepeatWeekly && todo.RepeatRule != domain.TodoRepeatMonthly {
				return todo, nil, domain.ErrInvalidState
			}
			if todo.DueAt == nil {
				return todo, nil, domain.ErrInvalidState
			}
			created := makeNextTodo(todo, now)
			next, todo.NextTodoID = &created, created.ID
		}
	} else {
		todo.Status, todo.CompletedAt = domain.TodoOpen, nil
	}
	todo.UpdatedAt = s.nextRecordTime(previous)
	if err := s.commitTodo(ctx, todo, previous, next); err != nil {
		return domain.TodoItem{}, nil, err
	}
	kind := "todo.reopened"
	if completed {
		kind = "todo.completed"
	}
	s.publish(kind, userID, todo.ID, map[string]any{"repeat_rule": todo.RepeatRule})
	return todo, next, nil
}

// No persistence here: the original and successor are committed together.
func makeNextTodo(completed domain.TodoItem, now time.Time) domain.TodoItem {
	nextDueAt := advanceTodoDueAt(*completed.DueAt, completed.RepeatRule, now)
	next := completed
	next.ID, next.NextTodoID, next.MemoActionID, next.ImportReceiptID = platform.NewID(), "", "", ""
	next.Status, next.MyDayDate, next.DueAt = domain.TodoOpen, "", &nextDueAt
	next.CreatedAt, next.UpdatedAt, next.CompletedAt = now, now, nil
	next.Steps = append([]domain.TodoStep(nil), completed.Steps...)
	for index := range next.Steps {
		next.Steps[index].ID, next.Steps[index].Completed, next.Steps[index].CreatedAt = platform.NewID(), false, now
	}
	return next
}

func (s *Service) SetTodoMyDay(ctx context.Context, userID, todoID, date string, expected ...string) (domain.TodoItem, error) {
	todo, err := s.todoForChange(ctx, userID, todoID, expected)
	if err != nil {
		return domain.TodoItem{}, err
	}
	if todo.Status == domain.TodoCompleted {
		return todo, fmt.Errorf("%w: completed todo cannot be added to My Day", domain.ErrInvalidState)
	}
	normalized, err := normalizeTodoDate(date, true)
	if err != nil {
		return todo, err
	}
	previous := todo.UpdatedAt
	todo.MyDayDate, todo.UpdatedAt = normalized, s.nextRecordTime(previous)
	if err := s.commitTodo(ctx, todo, previous, nil); err != nil {
		return domain.TodoItem{}, err
	}
	s.publish("todo.my_day_added", userID, todo.ID, map[string]any{"date": normalized})
	return todo, nil
}

func (s *Service) RemoveTodoMyDay(ctx context.Context, userID, todoID string, expected ...string) (domain.TodoItem, error) {
	todo, err := s.todoForChange(ctx, userID, todoID, expected)
	if err != nil {
		return domain.TodoItem{}, err
	}
	previous := todo.UpdatedAt
	todo.MyDayDate, todo.UpdatedAt = "", s.nextRecordTime(previous)
	if err := s.commitTodo(ctx, todo, previous, nil); err != nil {
		return domain.TodoItem{}, err
	}
	s.publish("todo.my_day_removed", userID, todo.ID, nil)
	return todo, nil
}

func (s *Service) ToggleTodoStep(ctx context.Context, userID, todoID, stepID string, completed bool, expected ...string) (domain.TodoItem, error) {
	todo, err := s.todoForChange(ctx, userID, todoID, expected)
	if err != nil {
		return domain.TodoItem{}, err
	}
	for index := range todo.Steps {
		if todo.Steps[index].ID == stepID {
			previous := todo.UpdatedAt
			todo.Steps[index].Completed, todo.UpdatedAt = completed, s.nextRecordTime(previous)
			if err := s.commitTodo(ctx, todo, previous, nil); err != nil {
				return domain.TodoItem{}, err
			}
			s.publish("todo.step_updated", userID, todo.ID, map[string]any{"step_id": stepID, "completed": completed})
			return todo, nil
		}
	}
	return todo, domain.ErrNotFound
}

func (s *Service) DeleteTodo(ctx context.Context, userID, todoID string, expected ...string) error {
	todo, err := s.todoForChange(ctx, userID, todoID, expected)
	if err != nil {
		return err
	}
	writer, err := s.todoChanges()
	if err != nil {
		return err
	}
	if err := writer.DeleteTodoIfUnchanged(ctx, userID, todoID, todo.UpdatedAt); err != nil {
		return err
	}
	s.publish("todo.deleted", userID, todoID, nil)
	return nil
}

func normalizeTodoDate(value string, defaultToday bool) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		if !defaultToday {
			return "", nil
		}
		return time.Now().In(time.Local).Format("2006-01-02"), nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return "", fmt.Errorf("%w: date must use YYYY-MM-DD", domain.ErrInvalidInput)
	}
	return parsed.Format("2006-01-02"), nil
}

func makeTodoSteps(values []string, now time.Time) ([]domain.TodoStep, error) {
	steps := make([]domain.TodoStep, 0, len(values))
	for _, value := range values {
		title := strings.TrimSpace(value)
		if title == "" {
			continue
		}
		if utf8.RuneCountInString(title) > 200 || len(steps) >= 30 {
			return nil, fmt.Errorf("%w: steps must contain at most 30 titles of 200 characters", domain.ErrInvalidInput)
		}
		steps = append(steps, domain.TodoStep{ID: platform.NewID(), Title: title, CreatedAt: now})
	}
	return steps, nil
}

func advanceTodoDueAt(dueAt time.Time, rule domain.TodoRepeatRule, now time.Time) time.Time {
	next := advanceTodoDueOnce(dueAt, rule)
	for !next.After(now) {
		next = advanceTodoDueOnce(next, rule)
	}
	return next
}

func advanceTodoDueOnce(dueAt time.Time, rule domain.TodoRepeatRule) time.Time {
	switch rule {
	case domain.TodoRepeatDaily:
		return dueAt.AddDate(0, 0, 1)
	case domain.TodoRepeatWeekly:
		return dueAt.AddDate(0, 0, 7)
	case domain.TodoRepeatMonthly:
		return dueAt.AddDate(0, 1, 0)
	default:
		return dueAt
	}
}

func todoPriorityRank(priority domain.TaskPriority) int {
	return map[domain.TaskPriority]int{domain.PriorityLow: 1, domain.PriorityMedium: 2, domain.PriorityHigh: 3}[priority]
}

func isTodoColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, character := range value[1:] {
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') && !(character >= 'A' && character <= 'F') {
			return false
		}
	}
	return true
}
