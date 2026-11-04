package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestTodoCommitRejectsPartialRecurringWrite(t *testing.T) {
	ctx := context.Background()
	repo := NewMemory()
	at := time.Now().UTC()
	list := domain.TodoList{ID: "inbox", UserID: "alice", Kind: domain.TodoListInbox}
	repo.CreateTodoList(ctx, list)
	source := domain.TodoItem{ID: "source", UserID: "alice", ListID: list.ID, Status: domain.TodoOpen, UpdatedAt: at}
	repo.CreateTodo(ctx, source)
	occupied := domain.TodoItem{ID: "occupied", UserID: "alice", ListID: list.ID}
	repo.CreateTodo(ctx, occupied)
	changed := source
	changed.Status = domain.TodoCompleted
	changed.NextTodoID = occupied.ID
	changed.UpdatedAt = at.Add(time.Nanosecond)
	if err := repo.CommitTodoChange(ctx, changed, at, &occupied); !errors.Is(err, domain.ErrConflict) {
		t.Fatal(err)
	}
	actual, _ := repo.TodoByID(ctx, source.ID)
	if actual.Status != domain.TodoOpen || actual.NextTodoID != "" || !actual.UpdatedAt.Equal(at) {
		t.Fatal("partial completion persisted", actual)
	}
	foreign := changed
	foreign.UserID = "bob"
	if err := repo.CommitTodoChange(ctx, foreign, at, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := repo.CommitTodoChange(canceled, changed, at, nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestTodoCreationCannotUseDeletedCategoryOrReplaceExistingID(t *testing.T) {
	ctx := context.Background()
	repo := NewMemory()
	repo.CreateTodoList(ctx, domain.TodoList{ID: "inbox", UserID: "alice", Kind: domain.TodoListInbox})
	repo.CreateTodoList(ctx, domain.TodoList{ID: "custom", UserID: "alice", Kind: domain.TodoListCustom})
	original := domain.TodoItem{ID: "original", UserID: "alice", ListID: "custom", Title: "keep"}
	if err := repo.CreateTodo(ctx, original); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateTodo(ctx, original); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate task replaced original", err)
	}
	if err := repo.DeleteTodoListAndMove(ctx, "alice", "custom", "inbox", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateTodo(ctx, domain.TodoItem{ID: "late", UserID: "alice", ListID: "custom"}); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("late create left orphaned category", err)
	}
	actual, _ := repo.TodoByID(ctx, original.ID)
	if actual.Title != "keep" || actual.ListID != "inbox" {
		t.Fatal(actual)
	}
}
