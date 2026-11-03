package service

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func actionFixture(t *testing.T) (*Service, *store.Memory, *time.Time, domain.MemoNote, CreateMemoActionInput) {
	t.Helper()
	ctx := context.Background()
	repo := store.NewMemory()
	now := time.Date(2026, 11, 3, 2, 0, 0, 0, time.UTC)
	for _, id := range []string{"alice", "bob"} {
		if err := repo.CreateUser(ctx, domain.User{ID: id, Email: id + "@example.test", Name: id, CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return now }
	note := domain.MemoNote{ID: "memo-a", UserID: "alice", Title: "本周行动", Content: "- [ ] 阅读并整理笔记\n- [ ] 预约检查", CreatedAt: now, UpdatedAt: now}
	if err := repo.CreateMemoNote(ctx, note); err != nil {
		t.Fatal(err)
	}
	in := CreateMemoActionInput{AnchorKind: "line", AnchorText: "- [ ] 阅读并整理笔记", Title: "阅读并整理笔记", ExpectedUpdatedAt: now, MyDayDate: "2026-11-03"}
	return svc, repo, &now, note, in
}

func TestMemoActionConcurrentReplayDeletionAndSnapshot(t *testing.T) {
	svc, repo, now, note, in := actionFixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan MemoActionResult, 24)
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := svc.CreateMemoAction(ctx, "alice", note.ID, in)
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
	var linked MemoActionResult
	for out := range results {
		if out.Created {
			created++
		}
		linked = out
	}
	if created != 1 || linked.Context.Todo == nil {
		t.Fatalf("created %d", created)
	}
	lists, _ := repo.ListTodoLists(ctx, "alice")
	todos, _ := repo.ListTodos(ctx, "alice", store.TodoFilter{})
	if len(lists) != 1 || len(todos) != 1 {
		t.Fatalf("partial or duplicate records: %d/%d", len(lists), len(todos))
	}
	in.Title = "重试时修改的标题"
	out, err := svc.CreateMemoAction(ctx, "alice", note.ID, in)
	if err != nil || out.Created || out.MatchesRequest || out.Context.Todo.Title != todos[0].Title {
		t.Fatalf("replay modified target: %+v %v", out, err)
	}
	if _, err = svc.ActionContext(ctx, "bob", linked.Context.Link.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal(err)
	}
	if _, err = svc.CreateMemoAction(ctx, "bob", note.ID, in); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	note.Content = "- [x] 阅读并整理笔记"
	note.UpdatedAt = *now
	repo.UpdateMemoNote(ctx, note)
	in.AnchorText = "- [x] 阅读并整理笔记"
	in.ExpectedUpdatedAt = *now
	out, err = svc.CreateMemoAction(ctx, "alice", note.ID, in)
	if err != nil || out.Created || out.Context.Link.ID != linked.Context.Link.ID || !out.Context.Source.Changed {
		t.Fatalf("checkbox identity: %+v %v", out, err)
	}
	repo.DeleteTodo(ctx, todos[0].ID)
	repo.DeleteMemoNote(ctx, note.ID)
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	reloaded := store.NewMemory()
	if err = reloaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	restored := New(reloaded, nil, nil)
	out, err = restored.CreateMemoAction(ctx, "alice", note.ID, in)
	if err != nil || out.Created || out.Context.Todo != nil || !out.Context.Source.Deleted {
		t.Fatalf("deleted target resurrected: %+v %v", out, err)
	}
	links, err := restored.MemoActionLinks(ctx, "alice", note.ID)
	if err != nil || len(links) != 1 {
		t.Fatal(links, err)
	}
	exported, err := restored.ExportUserData(ctx, "alice")
	if err != nil || len(exported.ActionLinks) != 1 || exported.Counts["action_links"] != 1 {
		t.Fatal(err)
	}
	usage, err := reloaded.AccountUsage(ctx, "bob")
	if err != nil || usage.Objects != 0 {
		t.Fatalf("cross account usage %+v %v", usage, err)
	}
}

func TestMemoActionRejectsStaleOrMissingAnchorWithoutSideEffects(t *testing.T) {
	svc, repo, _, note, in := actionFixture(t)
	ctx := context.Background()
	for _, mutate := range []func(*CreateMemoActionInput){func(i *CreateMemoActionInput) { i.ExpectedUpdatedAt = i.ExpectedUpdatedAt.Add(-time.Second) }, func(i *CreateMemoActionInput) { i.AnchorText = "正文中没有的内容" }} {
		candidate := in
		mutate(&candidate)
		if _, err := svc.CreateMemoAction(ctx, "alice", note.ID, candidate); !errors.Is(err, domain.ErrConflict) {
			t.Fatal(err)
		}
	}
	lists, _ := repo.ListTodoLists(ctx, "alice")
	todos, _ := repo.ListTodos(ctx, "alice", store.TodoFilter{})
	links, _ := repo.ListActionLinks(ctx, "alice")
	if len(lists)+len(todos)+len(links) != 0 {
		t.Fatal("rejected command created records")
	}
}

func TestTodoFocusReplayPauseCalendarAndNoSilentCompletion(t *testing.T) {
	svc, repo, now, note, in := actionFixture(t)
	ctx := context.Background()
	linked, err := svc.CreateMemoAction(ctx, "alice", note.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	input := StartFocusInput{TodoID: linked.Context.Todo.ID, RequestID: "request-1234567890", PlannedMinutes: 10, BreakEnabled: true}
	first, err := svc.StartFocus(ctx, "alice", input)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := svc.StartFocus(ctx, "alice", input)
	if err != nil || retry.ID != first.ID {
		t.Fatal(retry, err)
	}
	different := input
	different.PlannedMinutes = 20
	if _, err = svc.StartFocus(ctx, "alice", different); !errors.Is(err, domain.ErrConflict) {
		t.Fatal(err)
	}
	if _, err = svc.StartFocus(ctx, "bob", input); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	*now = now.Add(2 * time.Minute)
	paused, err := svc.PauseFocus(ctx, "alice", first.ID)
	if err != nil || paused.FocusedSeconds != 120 {
		t.Fatal(paused, err)
	}
	*now = now.Add(15 * time.Minute)
	if _, err = svc.ResumeFocus(ctx, "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(3 * time.Minute)
	if _, err = svc.AdvanceFocus(ctx, "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(5 * time.Minute)
	if _, err = svc.AdvanceFocus(ctx, "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(5 * time.Minute)
	done, err := svc.FinishFocus(ctx, "alice", first.ID, false)
	if err != nil || done.ActualMinutes != 10 {
		t.Fatal(done, err)
	}
	duplicate, err := svc.FinishFocus(ctx, "alice", first.ID, false)
	if err != nil || !duplicate.EndedAt.Equal(*done.EndedAt) {
		t.Fatal(duplicate, err)
	}
	if _, err = svc.FinishFocus(ctx, "alice", first.ID, true); !errors.Is(err, domain.ErrConflict) {
		t.Fatal(err)
	}
	late := paused
	late.Status = domain.FocusRunning
	if _, err = repo.ChangeTodoFocus(ctx, paused, late); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale resume overwrote finish", err)
	}
	retry, err = svc.StartFocus(ctx, "alice", input)
	if err != nil || retry.Status != domain.FocusCompleted {
		t.Fatal(retry, err)
	}
	actual, _ := repo.TodoByID(ctx, input.TodoID)
	if actual.Status != domain.TodoOpen {
		t.Fatal("focus silently completed todo")
	}
	actualNote, _ := repo.MemoNoteByID(ctx, note.ID)
	if actualNote.Content != note.Content {
		t.Fatal("focus modified memo")
	}
	context, err := svc.TodoContext(ctx, "alice", actual.ID)
	if err != nil || context.CompletedMinutes != 10 || len(context.Sessions) != 1 {
		t.Fatal(context, err)
	}
	overview, err := svc.CalendarOverview(ctx, "alice", "2026-11-03", "2026-11-04")
	if err != nil || len(overview.FocusSessions) != 1 || len(overview.Todos) != 1 {
		t.Fatal(overview, err)
	}
	lookup, err := svc.TodoFocusRequest(ctx, "alice", input.RequestID)
	if err != nil || lookup.ID != first.ID {
		t.Fatal(lookup, err)
	}
	if _, err = svc.TodoFocusRequest(ctx, "bob", input.RequestID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
}
