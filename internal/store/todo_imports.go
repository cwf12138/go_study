package store

import (
	"context"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func (m *Memory) CreateTodoImport(ctx context.Context, receipt domain.TodoImportReceipt, todo domain.TodoItem, inbox domain.TodoList) (domain.TodoImportReceipt, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return receipt, false, err
	}
	if _, ok := m.users[receipt.UserID]; !ok {
		return receipt, false, domain.ErrNotFound
	}
	if old, ok := m.todoImports[receipt.ID]; ok {
		if old.UserID != receipt.UserID || old.Fingerprint != receipt.Fingerprint {
			return receipt, false, domain.ErrConflict
		}
		return old, false, nil
	}
	if _, ok := m.todos[todo.ID]; ok {
		return receipt, false, domain.ErrConflict
	}
	for _, list := range m.todoLists {
		if list.UserID == receipt.UserID && list.Kind == domain.TodoListInbox {
			todo.ListID = list.ID
			break
		}
	}
	if todo.ListID == "" {
		if _, exists := m.todoLists[inbox.ID]; exists {
			return receipt, false, domain.ErrConflict
		}
		todo.ListID = inbox.ID
		m.todoLists[inbox.ID] = inbox
	}
	m.todos[todo.ID] = cloneTodo(todo)
	m.todoImports[receipt.ID] = receipt
	return receipt, true, nil
}

func (m *Memory) TodoImportByID(_ context.Context, id string) (domain.TodoImportReceipt, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.todoImports[id]
	if !ok {
		return row, domain.ErrNotFound
	}
	return row, nil
}
func (m *Memory) ListTodoImports(_ context.Context, user string) ([]domain.TodoImportReceipt, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := []domain.TodoImportReceipt{}
	for _, row := range m.todoImports {
		if row.UserID == user {
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt.After(rows[j].CreatedAt) })
	return rows, nil
}
