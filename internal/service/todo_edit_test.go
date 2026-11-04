package service

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func todoEditFixture(t *testing.T) (*Service, *store.Memory, domain.TodoItem) {
	t.Helper()
	ctx := context.Background()
	repo := store.NewMemory()
	for _, id := range []string{"alice", "bob"} {
		if err := repo.CreateUser(ctx, domain.User{ID: id, Email: id + "@example.test"}); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 5, 8, 0, 0, 123456789, time.UTC) }
	due := svc.now().Add(24 * time.Hour)
	todo, err := svc.CreateTodo(ctx, "alice", CreateTodoInput{Title: "原待办", Notes: "原备注", Priority: domain.PriorityMedium, DueAt: &due, Steps: []string{"第一个步骤"}})
	if err != nil {
		t.Fatal(err)
	}
	return svc, repo, todo
}

func editTodoInput(todo domain.TodoItem) UpdateTodoInput {
	steps := []EditTodoStep{}
	for _, s := range todo.Steps {
		steps = append(steps, EditTodoStep{ID: s.ID, Title: s.Title, Completed: s.Completed})
	}
	return UpdateTodoInput{ListID: todo.ListID, Title: todo.Title, Notes: todo.Notes, Priority: todo.Priority, DueAt: todo.DueAt, MyDayDate: todo.MyDayDate, RepeatRule: todo.RepeatRule, Tags: todo.Tags, Steps: steps}
}

func TestTodoEditConcurrentVersionAndMonotonicClock(t *testing.T) {
	svc, repo, todo := todoEditFixture(t)
	ctx := context.Background()
	var success atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			in := editTodoInput(todo)
			in.Title = "并发修改"
			_, err := svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(todo), in)
			if err == nil {
				success.Add(1)
			} else if !errors.Is(err, domain.ErrConflict) {
				t.Errorf("unexpected: %v", err)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 {
		t.Fatal("concurrent successful writes", success.Load())
	}
	current, _ := repo.TodoByID(ctx, todo.ID)
	if !current.UpdatedAt.Equal(todo.UpdatedAt.Add(time.Nanosecond)) {
		t.Fatal("frozen clock reused a version", current.UpdatedAt)
	}
	if _, _, err := svc.CompleteTodo(ctx, "alice", todo.ID, true, TodoVersion(todo)); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale complete accepted", err)
	}
	if _, err := svc.SetTodoMyDay(ctx, "alice", todo.ID, "2026-11-05", TodoVersion(todo)); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale My Day accepted", err)
	}
	if _, err := svc.ToggleTodoStep(ctx, "alice", todo.ID, todo.Steps[0].ID, true, TodoVersion(todo)); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale step accepted", err)
	}
	if err := svc.DeleteTodo(ctx, "alice", todo.ID, TodoVersion(todo)); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale deletion accepted", err)
	}
	if _, err := svc.UpdateTodo(ctx, "bob", todo.ID, TodoVersion(current), editTodoInput(current)); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal("cross-owner edit", err)
	}
	if _, err := svc.UpdateTodo(ctx, "alice", todo.ID, "", editTodoInput(current)); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("missing version", err)
	}
}

func TestTodoEditStepsCategoriesAndDeletedTarget(t *testing.T) {
	svc, repo, todo := todoEditFixture(t)
	ctx := context.Background()
	in := editTodoInput(todo)
	in.Title = strings.Repeat("中", 200)
	in.Notes = strings.Repeat("文", 6000)
	in.Steps[0].Completed = true
	in.Steps = append(in.Steps, EditTodoStep{Title: "新增步骤"})
	edited, err := svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(todo), in)
	if err != nil {
		t.Fatal(err)
	}
	if edited.Steps[0].ID != todo.Steps[0].ID || !edited.Steps[0].Completed || edited.Steps[1].ID == "" || !edited.CreatedAt.Equal(todo.CreatedAt) {
		t.Fatal("step identity/metadata changed", edited)
	}
	bad := editTodoInput(edited)
	bad.Steps[1].ID = bad.Steps[0].ID
	if _, err = svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(edited), bad); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("duplicate steps", err)
	}
	bad = editTodoInput(edited)
	bad.Steps[0].ID = "foreign-step"
	if _, err = svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(edited), bad); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("foreign steps", err)
	}
	list, err := svc.CreateTodoList(ctx, "alice", CreateTodoListInput{Name: "临时分类"})
	if err != nil {
		t.Fatal(err)
	}
	in = editTodoInput(edited)
	in.ListID = list.ID
	moved, err := svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(edited), in)
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.DeleteTodoList(ctx, "alice", list.ID); err != nil {
		t.Fatal(err)
	}
	after, _ := repo.TodoByID(ctx, todo.ID)
	if after.ListID == list.ID || !after.UpdatedAt.After(moved.UpdatedAt) {
		t.Fatal("category deletion did not invalidate editor")
	}
	if _, err = svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(moved), in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("deleted list accepted", err)
	}
	if err = svc.DeleteTodo(ctx, "alice", todo.ID, TodoVersion(after)); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(after), editTodoInput(after)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("deleted task was resurrected", err)
	}
}

func TestTodoRecurringCompletionAtomicAndSuccessorNeverDuplicated(t *testing.T) {
	svc, repo, todo := todoEditFixture(t)
	ctx := context.Background()
	if err := svc.DeleteTodo(ctx, "alice", todo.ID); err != nil {
		t.Fatal(err)
	}
	imported, err := svc.CreateTodoImport(ctx, "alice", CreateTodoImportInput{SchemaVersion: 1, RequestID: "recurring-import-123456", Title: "本机收集的重复任务", Priority: domain.PriorityMedium})
	if err != nil {
		t.Fatal(err)
	}
	todo = *imported.Todo
	in := editTodoInput(todo)
	due := svc.now().Add(24 * time.Hour)
	in.DueAt, in.RepeatRule, in.Steps = &due, domain.TodoRepeatDaily, []EditTodoStep{{Title: "一个可完成的步骤"}}
	todo, err = svc.UpdateTodo(ctx, "alice", todo.ID, TodoVersion(todo), in)
	if err != nil {
		t.Fatal(err)
	}
	if todo.ImportReceiptID != imported.Receipt.ID {
		t.Fatal("edit dropped source receipt")
	}
	var success atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := svc.CompleteTodo(ctx, "alice", todo.ID, true, TodoVersion(todo))
			if err == nil {
				success.Add(1)
			} else if !errors.Is(err, domain.ErrConflict) {
				t.Errorf("complete: %v", err)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 {
		t.Fatal("concurrent completion", success.Load())
	}
	items, _ := svc.ListTodos(ctx, "alice", ListTodosInput{View: "all"})
	if len(items) != 2 {
		t.Fatal("duplicate successor", len(items))
	}
	completed, _ := repo.TodoByID(ctx, todo.ID)
	next, err := repo.TodoByID(ctx, completed.NextTodoID)
	if err != nil || next.NextTodoID != "" || next.MemoActionID != "" || next.ImportReceiptID != "" || next.Steps[0].Completed {
		t.Fatal("invalid successor", next, err)
	}
	reopened, _, err := svc.CompleteTodo(ctx, "alice", todo.ID, false, TodoVersion(completed))
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.DeleteTodo(ctx, "alice", next.ID); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	restored := New(loaded, nil, nil)
	again, generated, err := restored.CompleteTodo(ctx, "alice", todo.ID, true, TodoVersion(reopened))
	if err != nil || generated != nil || again.NextTodoID != next.ID {
		t.Fatal("recreated successor after deletion/reload", again, generated, err)
	}
}

func TestTodoCompletionKeepsWallClockSeparateFromVersionClock(t *testing.T) {
	svc, _, todo := todoEditFixture(t)
	wall := todo.UpdatedAt.Add(-time.Hour)
	svc.now = func() time.Time { return wall }
	completed, _, err := svc.CompleteTodo(context.Background(), "alice", todo.ID, true, TodoVersion(todo))
	if err != nil || completed.CompletedAt == nil || !completed.CompletedAt.Equal(wall) || !completed.UpdatedAt.After(todo.UpdatedAt) {
		t.Fatal("wall clock/version clock mixed", completed, err)
	}
}
