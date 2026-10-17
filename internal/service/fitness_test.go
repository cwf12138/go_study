package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func fitnessRoutine() SaveFitnessInput {
	return SaveFitnessInput{Kind: "routine", Title: "轻量训练", Category: "strength", Equipment: "chair", Moves: []domain.FitnessMove{{Name: "舒适步行", Mode: "time", Target: 20, Sets: 1, RestSeconds: 5, Instruction: "按能力调整"}, {Name: "墙壁俯卧撑", Mode: "reps", Target: 5, Sets: 1, RestSeconds: 0}}}
}
func TestFitnessLifecycleTimingSnapshotAndExport(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	now := time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	in := fitnessRoutine()
	routine, err := svc.SaveFitness(ctx, "alice", "routine-01", in)
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.SaveFitness(ctx, "alice", "routine-01", in)
	if err != nil || again.Revision != 1 {
		t.Fatal("save retry", err, again)
	}
	in.Moves[0].Name = "mutated input"
	routine.Moves[0].Name = "mutated return"
	owned, _ := svc.ListFitness(ctx, "alice")
	if owned[0].Moves[0].Name != "舒适步行" {
		t.Fatal("slice alias")
	}
	other, _ := svc.ListFitness(ctx, "bob")
	if len(other) != 0 {
		t.Fatal("account leak")
	}
	plan, err := svc.SaveFitness(ctx, "alice", "plan-0001", SaveFitnessInput{Kind: "plan", RoutineID: "routine-01", Date: "2026-10-18", State: "scheduled"})
	if err != nil {
		t.Fatal(err)
	}
	in = fitnessRoutine()
	in.Revision = 1
	in.Title = "调整后训练"
	in.Moves[0].Target = 60
	if _, err = svc.SaveFitness(ctx, "alice", "routine-01", in); err != nil {
		t.Fatal(err)
	}
	start := StartFitnessInput{SourceID: plan.ID}
	session, err := svc.StartFitness(ctx, "alice", "session-01", start)
	if err != nil || session.Title != "轻量训练" || session.RemainingSeconds != 20 {
		t.Fatal("snapshot start", session, err)
	}
	if retry, e := svc.StartFitness(ctx, "alice", "session-01", start); e != nil || retry.Revision != session.Revision {
		t.Fatal("start retry", e)
	}
	commandNumber := 0
	command := func(name string) FitnessActionInput {
		commandNumber++
		return FitnessActionInput{Action: name, CommandID: fmt.Sprintf("command-%s-%d", name, commandNumber), Revision: session.Revision}
	}
	apply := func(in FitnessActionInput) {
		t.Helper()
		var e error
		session, e = svc.FitnessAction(ctx, "alice", session.ID, in)
		if e != nil {
			t.Fatal(in.Action, e)
		}
	}
	now = now.Add(10 * time.Second)
	pause := FitnessActionInput{Action: "pause", CommandID: "command-pause-01", Revision: session.Revision}
	apply(pause)
	if session.ElapsedSeconds != 10 || session.RemainingSeconds != 10 || !session.RunningSince.IsZero() {
		t.Fatal(session)
	}
	if retry, e := svc.FitnessAction(ctx, "alice", session.ID, pause); e != nil || !reflect.DeepEqual(retry, session) {
		t.Fatal("action replay", e, retry)
	}
	now = now.Add(100 * time.Second)
	apply(command("resume"))
	now = now.Add(3 * time.Second)
	apply(command("complete_set"))
	if session.Phase != "rest" || session.ElapsedSeconds != 13 || session.CurrentMove != 1 {
		t.Fatal(session)
	}
	now = now.Add(2 * time.Second)
	apply(command("pause"))
	if session.RemainingSeconds != 3 {
		t.Fatal("rest pause", session)
	}
	now = now.Add(100 * time.Second)
	apply(command("resume"))
	now = now.Add(3 * time.Second)
	apply(command("next"))
	now = now.Add(5 * time.Second)
	apply(command("complete_set"))
	if session.Phase != "done" || session.State != "paused" || session.ElapsedSeconds != 23 {
		t.Fatal(session)
	}
	now = now.Add(100 * time.Second)
	finish := command("finish")
	finish.Note = "状态不错"
	finish.Effort = 2
	apply(finish)
	if session.State != "completed" || session.ElapsedSeconds != 23 || session.Effort != 2 {
		t.Fatal(session)
	}
	p, _ := repo.FitnessByID(ctx, "alice", plan.ID)
	if p.State != "completed" || p.Revision != plan.Revision+1 {
		t.Fatal("linked plan not committed", p)
	}
	apply(command("archive"))
	if !session.Deleted {
		t.Fatal("archive")
	}
	apply(command("restore"))
	if session.Deleted {
		t.Fatal("restore")
	}
	if _, e := svc.FitnessAction(ctx, "bob", session.ID, FitnessActionInput{Action: "pause", CommandID: "command-other", Revision: session.Revision}); !errors.Is(e, domain.ErrNotFound) {
		t.Fatal("cross account", e)
	}
	file := filepath.Join(t.TempDir(), "fitness.json")
	if e := repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	restored := store.NewMemory()
	if e := restored.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	row, e := restored.FitnessByID(ctx, "alice", session.ID)
	if e != nil || !reflect.DeepEqual(row, session) {
		t.Fatal("snapshot round trip", e)
	}
	if e := repo.CreateUser(ctx, domain.User{ID: "alice", Name: "Fitness", Email: "fitness-export@example.test"}); e != nil {
		t.Fatal(e)
	}
	export, e := svc.ExportUserData(ctx, "alice")
	if e != nil || len(export.Fitness) != 3 || export.Counts["fitness"] != 3 {
		t.Fatal("fitness export", export.Counts, e)
	}
}
func TestFitnessUniqueActiveAndPartialProgress(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	now := time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	input := fitnessRoutine()
	routine, e := svc.SaveFitness(ctx, "alice", "routine-01", input)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"session-one", "session-two"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, e := svc.StartFitness(ctx, "alice", id, StartFitnessInput{SourceID: routine.ID})
			results <- e
		}(id)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, domain.ErrConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal(ok, conflict)
	}
	rows, _ := svc.ListFitness(ctx, "alice")
	var session domain.FitnessEntry
	for _, r := range rows {
		if r.Kind == "session" {
			session = r
		}
	}
	for i := 0; i < 2; i++ {
		session, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "skip", CommandID: []string{"command-skip-1", "command-skip-2"}[i], Revision: session.Revision})
		if e != nil {
			t.Fatal(e)
		}
	}
	if _, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "finish", CommandID: "command-finish", Revision: session.Revision}); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal("all skipped was marked complete", e)
	}
	session, e = svc.FitnessAction(ctx, "alice", session.ID, FitnessActionInput{Action: "stop", CommandID: "command-stop", Revision: session.Revision})
	if e != nil || session.State != "stopped" {
		t.Fatal(e, session)
	}
	if _, e = svc.StartFitness(ctx, "alice", "session-new", StartFitnessInput{SourceID: routine.ID}); e != nil {
		t.Fatal("could not start after stopping", e)
	}
}
func TestFitnessValidation(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	for _, change := range []func(*SaveFitnessInput){func(i *SaveFitnessInput) { i.Moves[0].Sets = 9 }, func(i *SaveFitnessInput) { i.Moves[0].Mode = "auto" }, func(i *SaveFitnessInput) { i.Moves[0].Done = 1 }, func(i *SaveFitnessInput) { i.Moves[0].RestSeconds = 301 }, func(i *SaveFitnessInput) { i.Moves[0].Target = 0 }} {
		in := fitnessRoutine()
		change(&in)
		if _, e := svc.SaveFitness(ctx, "alice", "routine-01", in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("invalid routine", e)
		}
	}
	for _, in := range []SaveFitnessInput{{Kind: "session"}, {Kind: "log", Title: "步行", Category: "cardio", Date: "2099-01-01", ElapsedSeconds: 600}, {Kind: "settings", WeeklyMinutes: 1, WeeklySessions: 3}, {Kind: "plan", RoutineID: "missing-01", Date: "2026-10-18", State: "scheduled"}} {
		if _, e := svc.SaveFitness(ctx, "alice", "record-01", in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("invalid input accepted", in, e)
		}
	}
}

func TestFitnessClockAtDurationCap(t *testing.T) {
	now := time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC)
	row := domain.FitnessEntry{State: "active", RunningSince: now.Add(-5 * time.Second), ElapsedSeconds: 86400, RemainingSeconds: 100}
	settleFitness(&row, now)
	if row.ElapsedSeconds != 86400 || row.RemainingSeconds != 95 || !row.RunningSince.IsZero() {
		t.Fatal("duration cap froze stage clock", row)
	}
	row.RunningSince = now.Add(time.Second)
	settleFitness(&row, now)
	if row.RemainingSeconds != 95 {
		t.Fatal("backward clock changed remaining time", row)
	}
	row.State = "paused"
	row.RunningSince = now.Add(-time.Hour)
	settleFitness(&row, now)
	if row.RemainingSeconds != 95 {
		t.Fatal("pause changed remaining time", row)
	}
}
