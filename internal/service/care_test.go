package service

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func careInput() SaveCareInput {
	return SaveCareInput{Title: "保养测试", Category: "home", Interval: 1, Unit: "months", Rhythm: "fixed", FirstDue: "2026-01-31", Importance: "normal", EstimateMinutes: 10}
}
func TestCareDatesAndActions(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, calendarLocation)
	s.now = func() time.Time { return now }
	for _, test := range []struct {
		a          string
		i, n       int
		unit, want string
	}{{"2026-01-31", 1, 1, "months", "2026-02-28"}, {"2026-01-31", 2, 1, "months", "2026-03-31"}, {"2024-02-29", 1, 12, "months", "2025-02-28"}, {"2026-10-20", 2, 1, "weeks", "2026-11-03"}} {
		got, e := careDate(test.a, test.i, test.n, test.unit)
		if e != nil || got != test.want {
			t.Fatal(test, got, e)
		}
	}
	in := careInput()
	row, e := s.SaveCare(ctx, "alice", "care-item-one", in)
	if e != nil {
		t.Fatal(e)
	}
	if again, e := s.SaveCare(ctx, "alice", row.ID, in); e != nil || again.Revision != 1 {
		t.Fatal("save retry", again, e)
	}
	apply := func(action, date, id string) {
		t.Helper()
		input := CareActionInput{Action: action, Date: date, CommandID: id, Revision: row.Revision, Note: "本次记录"}
		var e error
		row, e = s.CareAction(ctx, "alice", row.ID, input)
		if e != nil {
			t.Fatal(action, e)
		}
		again, e := s.CareAction(ctx, "alice", row.ID, input)
		if e != nil || !reflect.DeepEqual(row, again) {
			t.Fatal("action retry changed state", action, e)
		}
	}
	apply("complete", "2026-02-01", "care-command-one")
	if row.NextDate != "2026-02-28" || row.TotalCompletions != 1 {
		t.Fatal(row)
	}
	apply("complete", "2026-09-05", "care-command-two")
	if row.NextDate != "2026-09-30" || row.TotalCompletions != 2 || len(row.History) != 2 {
		t.Fatal("catchup fabricated history", row)
	}
	apply("undo", "", "care-command-undo")
	if row.NextDate != "2026-02-28" || row.TotalCompletions != 1 || len(row.History) != 1 {
		t.Fatal("undo", row)
	}
	apply("snooze", "2026-10-23", "care-command-snooze")
	if careEffective(row) != "2026-10-23" || row.AnchorDate != "2026-01-31" {
		t.Fatal("snooze shifted anchor", row)
	}
	apply("complete", "2026-10-20", "care-command-three")
	if row.NextDate != "2026-10-31" || row.SnoozedUntil != "" {
		t.Fatal(row)
	}
	apply("undo", "", "care-command-undo-two")
	if row.SnoozedUntil != "2026-10-23" {
		t.Fatal("undo lost snooze", row)
	}
	apply("pause", "", "care-command-pause")
	if row.State != "paused" {
		t.Fatal(row)
	}
	if _, e := s.CareAction(ctx, "alice", row.ID, CareActionInput{Action: "complete", Date: "2026-10-20", CommandID: "care-cmd-paused", Revision: row.Revision}); !errors.Is(e, domain.ErrInvalidState) {
		t.Fatal("paused completion", e)
	}
	apply("resume", "", "care-command-resume")
	apply("archive", "", "care-command-archive")
	apply("restore", "", "care-command-restore")
	if _, e = s.CareAction(ctx, "bob", row.ID, CareActionInput{Action: "pause", CommandID: "care-owner-guard", Revision: row.Revision}); !errors.Is(e, domain.ErrNotFound) {
		t.Fatal("owner isolation", e)
	}
	other, _ := s.ListCare(ctx, "bob")
	if len(other) != 0 {
		t.Fatal("list leaks")
	}
	file := filepath.Join(t.TempDir(), "care.json")
	if e = repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	restored := store.NewMemory()
	if e = restored.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	back, e := restored.CareByID(ctx, "alice", row.ID)
	if e != nil || !reflect.DeepEqual(row, back) {
		t.Fatal("snapshot", e)
	}
	if e = repo.CreateUser(ctx, domain.User{ID: "alice", Email: "care@example.test", Name: "Care"}); e != nil {
		t.Fatal(e)
	}
	export, e := s.ExportUserData(ctx, "alice")
	if e != nil || len(export.Care) != 1 || export.Counts["care"] != 1 {
		t.Fatal("export", e)
	}
	o, e := s.CalendarOverview(ctx, "alice", "2026-10-01", "2026-11-01")
	if e != nil || len(o.CareEntries) != 1 || o.CareEntries[0].Date != "2026-10-23" || o.CareEntries[0].Kind != "due" {
		t.Fatal("calendar projection", o.CareEntries, e)
	}
}

func TestCareRollingHistoryAndValidation(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	s.now = func() time.Time { return time.Date(2026, 10, 20, 12, 0, 0, 0, calendarLocation) }
	in := careInput()
	in.Rhythm = "rolling"
	in.FirstDue = "2026-01-31"
	row, e := s.SaveCare(ctx, "alice", "care-rolling-one", in)
	if e != nil {
		t.Fatal(e)
	}
	row, e = s.CareAction(ctx, "alice", row.ID, CareActionInput{Action: "complete", Date: "2026-02-28", CommandID: "care-rolling-done", Revision: row.Revision})
	if e != nil || row.NextDate != "2026-03-28" {
		t.Fatal("rolling should use actual completion", row, e)
	}
	// Ensure trimming and undo retain exactly the original bounded history.
	row.History = make([]domain.CareCompletion, 100)
	for i := range row.History {
		row.History[i] = domain.CareCompletion{ID: "historical", Date: "2026-02-28", Note: "保留"}
	}
	row.TotalCompletions = 100
	row, e = repo.SaveCare(ctx, row, row.Revision)
	if e != nil {
		t.Fatal(e)
	}
	before := append([]domain.CareCompletion{}, row.History...)
	row, e = s.CareAction(ctx, "alice", row.ID, CareActionInput{Action: "complete", Date: "2026-03-01", CommandID: "care-history-done", Revision: row.Revision})
	if e != nil || len(row.History) != 100 || row.TotalCompletions != 101 {
		t.Fatal("history cap", e)
	}
	row, e = s.CareAction(ctx, "alice", row.ID, CareActionInput{Action: "undo", CommandID: "care-history-undo", Revision: row.Revision})
	if e != nil || !reflect.DeepEqual(before, row.History) || row.TotalCompletions != 100 {
		t.Fatal("undo did not restore trimmed entry", e)
	}
	for _, change := range []func(*SaveCareInput){func(i *SaveCareInput) { i.Interval = 0 }, func(i *SaveCareInput) { i.Unit = "years" }, func(i *SaveCareInput) { i.FirstDue = "2026-02-30" }, func(i *SaveCareInput) { i.EstimateMinutes = 481 }, func(i *SaveCareInput) { i.Title = "" }} {
		bad := careInput()
		change(&bad)
		if _, e = s.SaveCare(ctx, "alice", "care-invalid-one", bad); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("invalid accepted", bad, e)
		}
	}
	for _, input := range []CareActionInput{{Action: "complete", Date: "2099-01-01"}, {Action: "complete", Date: "2026-01-01"}, {Action: "snooze", Date: "2026-10-20"}, {Action: "snooze", Date: "2027-12-31"}} {
		input.CommandID = "care-invalid-command"
		input.Revision = row.Revision
		if _, e = s.CareAction(ctx, "alice", row.ID, input); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("bad action accepted", input, e)
		}
	}
}
