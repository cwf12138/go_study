package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestFitnessCheckInCalendarLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	now := time.Date(2026, 10, 20, 0, 15, 0, 0, calendarLocation)
	svc.now = func() time.Time { return now }
	input := SaveFitnessInput{Kind: "checkin", Date: "2026-10-20", ElapsedSeconds: 999, WeeklySessions: 99, Moves: []domain.FitnessMove{{Name: "ignored"}}}
	var check domain.FitnessEntry
	for i := 0; i < 2; i++ {
		var e error
		check, e = svc.SaveFitness(ctx, "alice", "fitness-checkin-2026-10-20", input)
		if e != nil || check.Revision != 1 || check.ElapsedSeconds != 0 || len(check.Moves) != 0 {
			t.Fatal("check-in/retry must not invent training", check, e)
		}
	}
	overview := func(user string) domain.CalendarOverview {
		t.Helper()
		o, e := svc.CalendarOverview(ctx, user, "2026-10-19", "2026-10-21")
		if e != nil {
			t.Fatal(e)
		}
		return o
	}
	if days := overview("alice").FitnessDays; len(days) != 1 || !days[0].ManualCheckIn || days[0].CompletedSessions != 0 || days[0].RecordedSeconds != 0 {
		t.Fatal("manual check-in projection", days)
	}
	if days := overview("bob").FitnessDays; len(days) != 0 {
		t.Fatal("owner isolation", days)
	}
	input.Revision = check.Revision
	input.Deleted = true
	check, e := svc.SaveFitness(ctx, "alice", check.ID, input)
	if e != nil {
		t.Fatal(e)
	}
	if len(overview("alice").FitnessDays) != 0 {
		t.Fatal("undo left stale calendar record")
	}
	log, e := svc.SaveFitness(ctx, "alice", "workout-log-01", SaveFitnessInput{Kind: "log", Title: "散步", Category: "cardio", Date: "2026-10-20", ElapsedSeconds: 1200})
	if e != nil {
		t.Fatal(e)
	}
	input.Revision = check.Revision
	input.Deleted = false
	check, e = svc.SaveFitness(ctx, "alice", check.ID, input)
	if e != nil {
		t.Fatal(e)
	}
	if days := overview("alice").FitnessDays; len(days) != 1 || days[0].CompletedSessions != 1 || days[0].RecordedSeconds != 1200 || !days[0].ManualCheckIn {
		t.Fatal("same day should aggregate", days)
	}
	input.Revision = check.Revision
	input.Deleted = true
	check, e = svc.SaveFitness(ctx, "alice", check.ID, input)
	if e != nil {
		t.Fatal(e)
	}
	if days := overview("alice").FitnessDays; len(days) != 1 || days[0].ManualCheckIn || days[0].CompletedSessions != 1 {
		t.Fatal("undo must retain real workout", days)
	}
	logInput := SaveFitnessInput{Kind: "log", Title: log.Title, Category: log.Category, Date: log.Date, ElapsedSeconds: log.ElapsedSeconds, Revision: log.Revision, Deleted: true}
	if _, e = svc.SaveFitness(ctx, "alice", log.ID, logInput); e != nil {
		t.Fatal(e)
	}
	if len(overview("alice").FitnessDays) != 0 {
		t.Fatal("archived last record must disappear")
	}
	logInput.Revision++
	logInput.Deleted = false
	if _, e = svc.SaveFitness(ctx, "alice", log.ID, logInput); e != nil {
		t.Fatal(e)
	}
	if len(overview("alice").FitnessDays) != 1 {
		t.Fatal("restore must restore calendar projection")
	}
	file := filepath.Join(t.TempDir(), "fitness.json")
	if e = repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	back := store.NewMemory()
	if e = back.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	loaded, e := New(back, nil, nil).CalendarOverview(ctx, "alice", "2026-10-20", "2026-10-21")
	if e != nil || len(loaded.FitnessDays) != 1 || loaded.FitnessDays[0].ManualCheckIn {
		t.Fatal("snapshot retained wrong status", loaded.FitnessDays, e)
	}
	for _, bad := range []SaveFitnessInput{{Kind: "checkin", Date: "2026-10-21"}, {Kind: "checkin", Date: "2026-02-30"}, {Kind: "checkin", Date: "1999-12-31"}} {
		if _, e = svc.SaveFitness(ctx, "alice", "fitness-checkin-"+bad.Date, bad); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("invalid date", bad, e)
		}
	}
	if _, e = svc.SaveFitness(ctx, "alice", "checkin-wrong-id", SaveFitnessInput{Kind: "checkin", Date: "2026-10-20"}); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal("noncanonical id accepted", e)
	}
}

func TestFitnessCalendarRangeAndCompletedSession(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 10, 20, 12, 0, 0, 0, calendarLocation) }
	input := StartFitnessInput{Title: "测试", Category: "cardio", Equipment: "none", Moves: []domain.FitnessMove{{Name: "步行", Mode: "time", Target: 60, Sets: 1}}}
	session, e := svc.StartFitness(ctx, "alice", "fitness-session-one", input)
	if e != nil {
		t.Fatal(e)
	}
	get := func() []domain.FitnessDay {
		o, e := svc.CalendarOverview(ctx, "alice", "2026-10-20", "2026-10-21")
		if e != nil {
			t.Fatal(e)
		}
		return o.FitnessDays
	}
	if len(get()) != 0 {
		t.Fatal("active training is not a completion")
	}
	session, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "complete_set", CommandID: "complete-group", Revision: session.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if len(get()) != 0 {
		t.Fatal("unsaved summary should not mark complete")
	}
	session, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "finish", CommandID: "finish-session", Revision: session.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if days := get(); len(days) != 1 || days[0].CompletedSessions != 1 {
		t.Fatal("completed session missing", days)
	}
	if _, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "archive", CommandID: "archive-session", Revision: session.Revision}); e != nil {
		t.Fatal(e)
	}
	if len(get()) != 0 {
		t.Fatal("archived session is still projected")
	}
	rows := []domain.FitnessEntry{{Kind: "checkin", Date: "2026-10-19", State: "completed"}, {Kind: "checkin", Date: "2026-10-20", State: "completed"}, {Kind: "checkin", Date: "2026-10-21", State: "completed"}, {Kind: "session", Date: "2026-10-20", State: "stopped", ElapsedSeconds: 120}, {Kind: "plan", Date: "2026-10-20", State: "completed"}}
	if days := fitnessCalendarDays(rows, "2026-10-20", "2026-10-21"); len(days) != 1 || days[0].CompletedSessions != 0 {
		t.Fatal("range boundary/stopped/plan included", days)
	}
}
