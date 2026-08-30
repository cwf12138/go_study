package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestPlannerPreferencesRejectOverlappingWindows(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	_, err := svc.SavePlannerPreferences(context.Background(), "planner-user", SavePlannerPreferencesInput{
		TimeZone: defaultPlannerTimeZone, SessionMinutes: 50, BreakMinutes: 10, DailyMaxMinutes: 180,
		Windows: []domain.AvailabilityWindow{
			{Weekday: 1, StartTime: "09:00", EndTime: "11:00"},
			{Weekday: 1, StartTime: "10:30", EndTime: "12:00"},
		},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("overlapping windows error = %v, want invalid input", err)
	}
}

func TestGeneratePlanWeekPrioritizesDeadlineAndPreservesLockedBlocks(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	now := time.Date(2026, 9, 7, 7, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	svc.now = func() time.Time { return now }
	_, err := svc.SavePlannerPreferences(ctx, "planner-user", SavePlannerPreferencesInput{
		TimeZone: defaultPlannerTimeZone, SessionMinutes: 50, BreakMinutes: 10, DailyMaxMinutes: 180,
		Windows: []domain.AvailabilityWindow{{Weekday: 1, StartTime: "09:00", EndTime: "12:00"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	locked, err := svc.CreatePlanBlock(ctx, "planner-user", CreatePlanBlockInput{
		Kind: domain.PlanBlockCustom, Title: "Fixed class", StartAt: time.Date(2026, 9, 7, 9, 0, 0, 0, now.Location()),
		EndAt: time.Date(2026, 9, 7, 10, 0, 0, 0, now.Location()), Priority: domain.PriorityMedium, Locked: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	due := time.Date(2026, 9, 7, 23, 0, 0, 0, now.Location())
	urgent, err := svc.CreateTask(ctx, "planner-user", CreateTaskInput{Title: "Urgent chapter", EstimatedMinutes: 100, Priority: domain.PriorityHigh, DueAt: &due})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTask(ctx, "planner-user", CreateTaskInput{Title: "Low priority reading", EstimatedMinutes: 50, Priority: domain.PriorityLow}); err != nil {
		t.Fatal(err)
	}

	week, err := svc.GeneratePlanWeek(ctx, "planner-user", "2026-09-07")
	if err != nil {
		t.Fatal(err)
	}
	if len(week.Blocks) != 3 {
		t.Fatalf("generated week has %d blocks, want locked block plus two urgent sessions: %+v", len(week.Blocks), week.Blocks)
	}
	if len(week.Unscheduled) != 1 || week.Unscheduled[0].Title != "Low priority reading" {
		t.Fatalf("unexpected unscheduled work: %+v", week.Unscheduled)
	}
	urgentBlocks := 0
	for _, block := range week.Blocks {
		if block.ID == locked.ID {
			continue
		}
		if block.SourceID != urgent.ID || block.Kind != domain.PlanBlockTask {
			t.Fatalf("lower priority work displaced urgent task: %+v", block)
		}
		if block.StartAt.Before(locked.EndAt) || block.StartAt.Before(time.Date(2026, 9, 7, 10, 0, 0, 0, now.Location()).UTC()) {
			t.Fatalf("generated block overlaps locked class: %+v", block)
		}
		urgentBlocks++
	}
	if urgentBlocks != 2 || week.Summary.UnscheduledMinutes != 50 || week.Summary.CapacityMinutes != 180 {
		t.Fatalf("unexpected plan summary: %+v", week.Summary)
	}
}

func TestPlanBlockFocusLifecycleUpdatesCalendarBlock(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	current := time.Date(2026, 9, 7, 19, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return current }
	task, err := svc.CreateTask(ctx, "planner-user", CreateTaskInput{Title: "Concurrency lab", EstimatedMinutes: 30, Priority: domain.PriorityHigh})
	if err != nil {
		t.Fatal(err)
	}
	block, err := svc.CreatePlanBlock(ctx, "planner-user", CreatePlanBlockInput{
		Kind: domain.PlanBlockTask, SourceID: task.ID, Title: task.Title, StartAt: current, EndAt: current.Add(30 * time.Minute), Priority: domain.PriorityHigh,
	})
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.StartFocus(ctx, "planner-user", StartFocusInput{PlanBlockID: block.ID})
	if err != nil {
		t.Fatal(err)
	}
	if session.TaskID != task.ID || session.PlannedMinutes != 30 {
		t.Fatalf("focus did not inherit plan block source and duration: %+v", session)
	}
	doing, _ := repository.PlanBlockByID(ctx, block.ID)
	if doing.Status != domain.PlanBlockDoing {
		t.Fatalf("block status after focus start = %s, want in_progress", doing.Status)
	}
	current = current.Add(30 * time.Minute)
	if _, err := svc.FinishFocus(ctx, "planner-user", session.ID, false); err != nil {
		t.Fatal(err)
	}
	completed, _ := repository.PlanBlockByID(ctx, block.ID)
	if completed.Status != domain.PlanBlockCompleted || completed.CompletedAt == nil {
		t.Fatalf("block was not completed with focus session: %+v", completed)
	}
}

func TestCompletingPlanBlockCanCompleteTodoSource(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	now := time.Date(2026, 9, 8, 19, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	todo, err := svc.CreateTodo(ctx, "planner-user", CreateTodoInput{Title: "Read Go memory model", Priority: domain.PriorityMedium})
	if err != nil {
		t.Fatal(err)
	}
	block, err := svc.CreatePlanBlock(ctx, "planner-user", CreatePlanBlockInput{
		Kind: domain.PlanBlockTodo, SourceID: todo.ID, Title: todo.Title, StartAt: now, EndAt: now.Add(25 * time.Minute), Priority: domain.PriorityMedium,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ChangePlanBlockStatus(ctx, "planner-user", block.ID, domain.PlanBlockCompleted, true); err != nil {
		t.Fatal(err)
	}
	updated, _ := repository.TodoByID(ctx, todo.ID)
	if updated.Status != domain.TodoCompleted {
		t.Fatalf("todo source status = %s, want completed", updated.Status)
	}
}

func TestPlannerSpreadsNewVocabularyByDailyBookLimit(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	now := time.Date(2026, 9, 7, 7, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	svc.now = func() time.Time { return now }
	windows := make([]domain.AvailabilityWindow, 0, 7)
	for weekday := 1; weekday <= 7; weekday++ {
		windows = append(windows, domain.AvailabilityWindow{Weekday: weekday, StartTime: "19:00", EndTime: "21:00"})
	}
	if _, err := svc.SavePlannerPreferences(ctx, "planner-user", SavePlannerPreferencesInput{TimeZone: defaultPlannerTimeZone, SessionMinutes: 50, BreakMinutes: 5, DailyMaxMinutes: 120, Windows: windows}); err != nil {
		t.Fatal(err)
	}
	book, err := svc.CreateWordBook(ctx, "planner-user", CreateWordBookInput{Name: "Go Vocabulary", DailyNewLimit: 2})
	if err != nil {
		t.Fatal(err)
	}
	for index := 1; index <= 5; index++ {
		if _, err := svc.CreateVocabularyWord(ctx, "planner-user", book.ID, CreateVocabularyWordInput{Term: string(rune('a' + index)), Definition: "definition"}); err != nil {
			t.Fatal(err)
		}
	}
	week, err := svc.GeneratePlanWeek(ctx, "planner-user", "2026-09-07")
	if err != nil {
		t.Fatal(err)
	}
	byDay := make(map[string]int)
	for _, block := range week.Blocks {
		if block.Kind == domain.PlanBlockVocabulary && strings.HasPrefix(block.SourceID, "vocabulary:new:") {
			byDay[block.StartAt.In(now.Location()).Format("2006-01-02")]++
		}
	}
	if len(byDay) != 3 {
		t.Fatalf("new words were not spread across three days: %+v, blocks: %+v", byDay, week.Blocks)
	}
}
