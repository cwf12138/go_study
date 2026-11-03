package store

import (
	"context"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func (m *Memory) ActionLinkByID(_ context.Context, id string) (domain.ActionLink, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	link, ok := m.actionLinks[id]
	if !ok {
		return link, domain.ErrNotFound
	}
	return link, nil
}

func (m *Memory) ListActionLinks(_ context.Context, user string) ([]domain.ActionLink, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.ActionLink{}
	for _, item := range m.actionLinks {
		if item.UserID == user {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

// LinkMemoAction commits the receipt, todo and (if needed) inbox under one lock.
func (m *Memory) LinkMemoAction(ctx context.Context, link domain.ActionLink, todo domain.TodoItem, inbox domain.TodoList) (domain.ActionLink, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return link, false, err
	}
	if old, ok := m.actionLinks[link.ID]; ok {
		if old.UserID != link.UserID {
			return link, false, domain.ErrForbidden
		}
		return old, false, nil
	}
	note, ok := m.memoNotes[link.MemoID]
	if !ok || note.UserID != link.UserID || note.DeletedAt != nil {
		return link, false, domain.ErrNotFound
	}
	if !note.UpdatedAt.Equal(link.MemoUpdatedAt) || !domain.MemoHasAction(note, link.AnchorKind, link.AnchorText) {
		return link, false, domain.ErrConflict
	}
	if _, ok := m.todos[todo.ID]; ok {
		return link, false, domain.ErrConflict
	}
	if todo.ListID == "" {
		for _, list := range m.todoLists {
			if list.UserID == link.UserID && list.Kind == domain.TodoListInbox {
				todo.ListID = list.ID
				break
			}
		}
		if todo.ListID == "" {
			todo.ListID = inbox.ID
			m.todoLists[inbox.ID] = inbox
		}
	} else if list, ok := m.todoLists[todo.ListID]; !ok || list.UserID != link.UserID {
		return link, false, domain.ErrNotFound
	}
	m.todos[todo.ID] = cloneTodo(todo)
	m.actionLinks[link.ID] = link
	return link, true, nil
}

func (m *Memory) StartTodoFocus(ctx context.Context, session domain.FocusSession) (domain.FocusSession, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return session, false, err
	}
	if old, ok := m.sessions[session.ID]; ok {
		if old.UserID != session.UserID || old.RequestFingerprint != session.RequestFingerprint {
			return session, false, domain.ErrConflict
		}
		return normalizeFocusSession(old), false, nil
	}
	todo, ok := m.todos[session.TodoID]
	if !ok || todo.UserID != session.UserID {
		return session, false, domain.ErrNotFound
	}
	if todo.Status != domain.TodoOpen {
		return session, false, domain.ErrInvalidState
	}
	for _, old := range m.sessions {
		if old.UserID == session.UserID && (old.Status == domain.FocusRunning || old.Status == domain.FocusPaused) {
			return session, false, domain.ErrConflict
		}
	}
	session.TitleSnapshot, session.MemoActionID = todo.Title, todo.MemoActionID
	m.sessions[session.ID] = session
	return session, true, nil
}

// Compare-and-swap prevents a late pause/resume from overwriting a finish.
func (m *Memory) ChangeTodoFocus(_ context.Context, before, after domain.FocusSession) (domain.FocusSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.sessions[before.ID]
	if !ok || current.UserID != before.UserID {
		return after, domain.ErrNotFound
	}
	current = normalizeFocusSession(current)
	if current.Status == domain.FocusCompleted || current.Status == domain.FocusAbandoned {
		if current.Status == after.Status {
			return current, nil
		}
		return current, domain.ErrConflict
	}
	if !reflect.DeepEqual(current, before) {
		return current, domain.ErrConflict
	}
	m.sessions[after.ID] = after
	return after, nil
}
