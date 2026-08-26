package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/store"
)

func TestFocusSessionAllowsOnlyOneActiveSession(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	now := time.Date(2026, 8, 27, 9, 0, 0, 0, time.UTC)
	svc := New(repository, security.NewTokenManager("focus-test-secret-long-enough", "test", time.Hour), nil)
	svc.now = func() time.Time { return now }

	first, err := svc.StartFocus(ctx, "learner", StartFocusInput{PlannedMinutes: 25})
	if err != nil {
		t.Fatalf("StartFocus() error = %v", err)
	}
	if _, err := svc.StartFocus(ctx, "learner", StartFocusInput{PlannedMinutes: 15}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("second StartFocus() error = %v, want conflict", err)
	}
	active, err := svc.ActiveFocus(ctx, "learner")
	if err != nil || active == nil || active.ID != first.ID {
		t.Fatalf("ActiveFocus() = %+v, %v", active, err)
	}

	now = now.Add(25 * time.Minute)
	finished, err := svc.FinishFocus(ctx, "learner", first.ID, false)
	if err != nil {
		t.Fatalf("FinishFocus() error = %v", err)
	}
	if finished.Status != domain.FocusCompleted || finished.ActualMinutes != 25 {
		t.Fatalf("finished session = %+v", finished)
	}
	active, err = svc.ActiveFocus(ctx, "learner")
	if err != nil || active != nil {
		t.Fatalf("ActiveFocus() after finish = %+v, %v", active, err)
	}
}

func TestFocusBreakAndPauseDoNotInflateFocusedTime(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	now := time.Date(2026, 8, 27, 9, 0, 0, 0, time.UTC)
	svc := New(repository, security.NewTokenManager("focus-break-test-secret-long-enough", "test", time.Hour), nil)
	svc.now = func() time.Time { return now }

	session, err := svc.StartFocus(ctx, "learner", StartFocusInput{PlannedMinutes: 25, BreakEnabled: true})
	if err != nil {
		t.Fatalf("StartFocus() error = %v", err)
	}
	if session.Phase != domain.FocusPhaseFocusFirst || session.PhaseRemainingSeconds != 750 || session.BreakMinutes != 5 {
		t.Fatalf("unexpected initial break plan: %+v", session)
	}

	now = now.Add(5 * time.Minute)
	session, err = svc.PauseFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("PauseFocus() error = %v", err)
	}
	if session.Status != domain.FocusPaused || session.PhaseRemainingSeconds != 450 || session.FocusedSeconds != 300 {
		t.Fatalf("unexpected paused session: %+v", session)
	}
	now = now.Add(30 * time.Minute) // Paused time must not count.
	session, err = svc.ResumeFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("ResumeFocus() error = %v", err)
	}
	now = now.Add(450 * time.Second)
	session, err = svc.AdvanceFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("AdvanceFocus() to break error = %v", err)
	}
	if session.Phase != domain.FocusPhaseBreak || session.PhaseRemainingSeconds != 300 || session.FocusedSeconds != 750 {
		t.Fatalf("unexpected break phase: %+v", session)
	}

	now = now.Add(2 * time.Minute)
	session, err = svc.PauseFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("PauseFocus() during break error = %v", err)
	}
	if session.FocusedSeconds != 750 || session.PhaseRemainingSeconds != 180 {
		t.Fatalf("break was counted as focus: %+v", session)
	}
	now = now.Add(time.Hour)
	session, err = svc.ResumeFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("ResumeFocus() during break error = %v", err)
	}
	now = now.Add(180 * time.Second)
	session, err = svc.AdvanceFocus(ctx, "learner", session.ID)
	if err != nil {
		t.Fatalf("AdvanceFocus() to second segment error = %v", err)
	}
	if session.Phase != domain.FocusPhaseFocusSecond || session.PhaseRemainingSeconds != 750 {
		t.Fatalf("unexpected second segment: %+v", session)
	}
	now = now.Add(750 * time.Second)
	finished, err := svc.FinishFocus(ctx, "learner", session.ID, false)
	if err != nil {
		t.Fatalf("FinishFocus() error = %v", err)
	}
	if finished.FocusedSeconds != 1500 || finished.ActualMinutes != 25 || finished.Status != domain.FocusCompleted {
		t.Fatalf("unexpected completed session: %+v", finished)
	}
}

func TestDashboardCountsTodayCompletedTasksAndFocus(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	location := time.FixedZone("UTC+8", 8*60*60)
	now := time.Date(2026, 8, 27, 21, 0, 0, 0, location)
	svc := &Service{repo: repository, now: func() time.Time { return now }}

	completedAt := now.Add(-30 * time.Minute).UTC()
	if err := repository.CreateTask(ctx, domain.StudyTask{
		ID: "today-task", UserID: "learner", Title: "Finish concurrency exercise",
		Status: domain.TaskDone, CompletedAt: &completedAt,
	}); err != nil {
		t.Fatal(err)
	}
	yesterday := now.AddDate(0, 0, -1).UTC()
	if err := repository.CreateTask(ctx, domain.StudyTask{
		ID: "old-task", UserID: "learner", Title: "Old task",
		Status: domain.TaskDone, CompletedAt: &yesterday,
	}); err != nil {
		t.Fatal(err)
	}
	endedAt := now.Add(-5 * time.Minute).UTC()
	if err := repository.CreateFocusSession(ctx, domain.FocusSession{
		ID: "today-focus", UserID: "learner", PlannedMinutes: 25, ActualMinutes: 25,
		Status: domain.FocusCompleted, StartedAt: now.Add(-30 * time.Minute).UTC(), EndedAt: &endedAt,
	}); err != nil {
		t.Fatal(err)
	}

	dashboard, err := svc.Dashboard(ctx, "learner")
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if dashboard.CompletedTasks != 2 || dashboard.CompletedTasksToday != 1 {
		t.Fatalf("task counts = total %d, today %d", dashboard.CompletedTasks, dashboard.CompletedTasksToday)
	}
	if dashboard.FocusMinutesToday != 25 || dashboard.FocusSessionsToday != 1 {
		t.Fatalf("focus counts = minutes %d, sessions %d", dashboard.FocusMinutesToday, dashboard.FocusSessionsToday)
	}
}
