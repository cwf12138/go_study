package store

import (
	"context"
	"time"

	"github.com/example/studyflow/internal/domain"
)

// CommitTodoChange checks the version, category and optional next occurrence in
// the same critical section. A failed recurring completion has no partial write.
func (m *Memory) CommitTodoChange(ctx context.Context, todo domain.TodoItem, expected time.Time, next *domain.TodoItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	old, ok := m.todos[todo.ID]
	if !ok {
		return domain.ErrNotFound
	}
	if old.UserID != todo.UserID {
		return domain.ErrForbidden
	}
	if !old.UpdatedAt.Equal(expected) {
		return domain.ErrConflict
	}
	list, ok := m.todoLists[todo.ListID]
	if !ok || list.UserID != todo.UserID {
		return domain.ErrConflict
	}
	if !todo.UpdatedAt.After(old.UpdatedAt) {
		return domain.ErrInvalidInput
	}
	if next == nil && todo.NextTodoID != old.NextTodoID {
		return domain.ErrInvalidInput
	}
	if next != nil {
		if old.NextTodoID != "" || todo.NextTodoID != next.ID || next.ID == todo.ID || next.UserID != todo.UserID || next.ListID != todo.ListID {
			return domain.ErrConflict
		}
		if _, exists := m.todos[next.ID]; exists {
			return domain.ErrConflict
		}
	}
	m.todos[todo.ID] = cloneTodo(todo)
	if next != nil {
		m.todos[next.ID] = cloneTodo(*next)
	}
	return nil
}

func (m *Memory) DeleteTodoIfUnchanged(ctx context.Context, userID, id string, expected time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	todo, ok := m.todos[id]
	if !ok {
		return domain.ErrNotFound
	}
	if todo.UserID != userID {
		return domain.ErrForbidden
	}
	if !todo.UpdatedAt.Equal(expected) {
		return domain.ErrConflict
	}
	delete(m.todos, id)
	return nil
}

// Category removal and relocation are atomic with respect to task edits.
func (m *Memory) DeleteTodoListAndMove(ctx context.Context, userID, id, inboxID string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	list, ok := m.todoLists[id]
	if !ok {
		return domain.ErrNotFound
	}
	if list.UserID != userID {
		return domain.ErrForbidden
	}
	if list.Kind == domain.TodoListInbox {
		return domain.ErrInvalidState
	}
	inbox, ok := m.todoLists[inboxID]
	if !ok || inbox.UserID != userID || inbox.Kind != domain.TodoListInbox {
		return domain.ErrConflict
	}
	for key, todo := range m.todos {
		if todo.UserID != userID || todo.ListID != id {
			continue
		}
		todo.ListID = inboxID
		stamp := at.UTC()
		if !stamp.After(todo.UpdatedAt) {
			stamp = todo.UpdatedAt.Add(time.Nanosecond)
		}
		todo.UpdatedAt = stamp
		m.todos[key] = todo
	}
	delete(m.todoLists, id)
	return nil
}
