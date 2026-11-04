package service

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestTodoImportConcurrentReplayAndSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	for _, id := range []string{"alice", "bob"} {
		if err := repo.CreateUser(ctx, domain.User{ID: id, Name: id, Email: id + "@example.test", CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return now }
	in := CreateTodoImportInput{SchemaVersion: 1, RequestID: "request-1234567890", Title: "\ufeff 整理书架 \u0085", Notes: " 首先清洁，然后归类。 ", Priority: domain.PriorityHigh}
	var wg sync.WaitGroup
	results := make(chan TodoImportResult, 24)
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := svc.CreateTodoImport(ctx, "alice", in)
			results <- out
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	created := 0
	var result TodoImportResult
	for row := range results {
		if row.Created {
			created++
		}
		result = row
	}
	if created != 1 || result.Todo == nil || result.Todo.Title != "整理书架" || result.Todo.RepeatRule != domain.TodoRepeatNone || result.Todo.ImportReceiptID != result.Receipt.ID {
		t.Fatalf("%d %+v", created, result)
	}
	rows, _ := repo.ListTodos(ctx, "alice", store.TodoFilter{})
	lists, _ := repo.ListTodoLists(ctx, "alice")
	receipts, _ := repo.ListTodoImports(ctx, "alice")
	if len(rows) != 1 || len(lists) != 1 || len(receipts) != 1 {
		t.Fatalf("partial create: %d %d %d", len(rows), len(lists), len(receipts))
	}
	changed := in
	changed.Title = "不同内容"
	if _, err := svc.CreateTodoImport(ctx, "alice", changed); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("changed body: %v", err)
	}
	if _, err := svc.TodoImport(ctx, "bob", in.RequestID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	other, err := svc.CreateTodoImport(ctx, "bob", changed)
	if err != nil || other.Receipt.ID == result.Receipt.ID || other.Todo.UserID != "bob" {
		t.Fatal(other, err)
	}
	updated := *result.Todo
	updated.Title = "在线修改后的名称"
	updated.Status = domain.TodoCompleted
	repo.UpdateTodo(ctx, updated)
	replayed, err := svc.CreateTodoImport(ctx, "alice", in)
	if err != nil || replayed.Created || replayed.Todo.Title != updated.Title || replayed.Receipt.Fingerprint != result.Receipt.Fingerprint {
		t.Fatal(replayed, err)
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
	replayed, err = restored.CreateTodoImport(ctx, "alice", in)
	if err != nil || replayed.Created || replayed.Todo.ID != result.Todo.ID {
		t.Fatal(replayed, err)
	}
	loaded.DeleteTodo(ctx, result.Todo.ID)
	if err = loaded.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	again := store.NewMemory()
	if err = again.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	afterDelete := New(again, nil, nil)
	replayed, err = afterDelete.CreateTodoImport(ctx, "alice", in)
	if err != nil || replayed.Created || replayed.Todo != nil {
		t.Fatal("deleted todo resurrected", replayed, err)
	}
	export, err := afterDelete.ExportUserData(ctx, "alice")
	if err != nil || len(export.TodoImports) != 1 || export.Counts["todo_imports"] != 1 {
		t.Fatal(export.Counts, err)
	}
}

func TestTodoImportValidationDoesNotCreateInbox(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	repo.CreateUser(ctx, domain.User{ID: "alice", Email: "alice@example.test"})
	svc := New(repo, nil, nil)
	for _, in := range []CreateTodoImportInput{{SchemaVersion: 2, RequestID: "request-1234567890", Title: "x"}, {SchemaVersion: 1, RequestID: "short", Title: "x"}, {SchemaVersion: 1, RequestID: "request-1234567890", Title: "\u0085\ufeff "}, {SchemaVersion: 1, RequestID: "request-1234567890", Title: strings.Repeat("中", 201)}} {
		if _, err := svc.CreateTodoImport(ctx, "alice", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(in, err)
		}
	}
	lists, _ := repo.ListTodoLists(ctx, "alice")
	rows, _ := repo.ListTodos(ctx, "alice", store.TodoFilter{})
	if len(lists)+len(rows) != 0 {
		t.Fatal("rejected command wrote records")
	}
	valid := CreateTodoImportInput{SchemaVersion: 1, RequestID: "request-1234567890", Title: strings.Repeat("中", 200), Notes: strings.Repeat("文", 6000)}
	if _, err := svc.CreateTodoImport(ctx, "alice", valid); err != nil {
		t.Fatal(err)
	}
}

func TestTodoImportFingerprintProtocol(t *testing.T) {
	for _, test := range []struct{ title, notes, want string }{
		{"abc", "", "c7b084fde77c08e940a7103dcdb21a76fe3cba51f413ba71f16221790f79ff63"},
		{"<hello>", "中文\u2028🙂", "76fd166b1ea07bea5519cc8251f15d116d0f4871b881b1656b8617b442b459bc"},
		{"整理", "A:B\n下一行", "d618252e31c763c7b99978a0ea2baf91a5e5550cd3f046d0b82bbf436325922d"},
	} {
		if got := todoImportFingerprint(test.title, test.notes, domain.PriorityMedium); got != test.want {
			t.Fatalf("fingerprint = %s, want %s", got, test.want)
		}
	}
}
