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

func TestCalendarSlotMoveRestoreAndReload(t *testing.T) {
	svc, repo, in := calendarWriteFixture(t)
	ctx := context.Background()
	in.RepeatRule = domain.CalendarRepeatWeekly
	series, err := svc.CreateCalendarEvent(ctx, "alice", in.CreateCalendarEventInput)
	if err != nil {
		t.Fatal(err)
	}
	slot := series.StartAt.AddDate(0, 0, 7)
	first, err := svc.CalendarSlot(ctx, "alice", series.ID, slot)
	if err != nil || first.Overridden || !first.StartAt.Equal(slot) || first.RepeatRule != domain.CalendarRepeatNone {
		t.Fatalf("generated slot = %+v, %v", first, err)
	}
	if _, err := svc.CalendarSlot(ctx, "bob", series.ID, slot); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("cross-account lookup: %v", err)
	}
	if _, err := svc.CalendarSlot(ctx, "alice", series.ID, slot.Add(time.Nanosecond)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("invalid anchor accepted: %v", err)
	}
	replacement := in.CreateCalendarEventInput
	replacement.RepeatRule, replacement.Title = domain.CalendarRepeatNone, "调整后"
	replacement.StartAt, replacement.EndAt = slot.AddDate(0, 1, 0), slot.AddDate(0, 1, 0).Add(2*time.Hour)
	moved, err := svc.SetCalendarSlot(ctx, "alice", series.ID, slot, &replacement, CalendarVersion(series))
	if err != nil || !moved.Overridden || moved.OccurrenceID != first.OccurrenceID || !moved.StartAt.Equal(replacement.StartAt) {
		t.Fatalf("moved occurrence = %+v, %v", moved, err)
	}
	if _, err := svc.SetCalendarSlot(ctx, "alice", series.ID, slot, nil, CalendarVersion(series)); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("stale reset accepted: %v", err)
	}
	shorten := series.StartAt
	if _, err := svc.UpdateCalendarEvent(ctx, "alice", series.ID, UpdateCalendarEventInput{RepeatUntil: &shorten}, CalendarVersion(moved.CalendarEvent)); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("series edit orphaned adjustment: %v", err)
	}
	path := filepath.Join(t.TempDir(), "calendar.json")
	if err := repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err := loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	svc = New(loaded, nil, nil)
	persisted, err := loaded.CalendarEventByID(ctx, series.ID)
	if err != nil || len(persisted.OccurrenceOverrides) != 1 {
		t.Fatalf("persisted series = %+v, %v", persisted, err)
	}
	rows := expandCalendarEvents([]domain.CalendarEvent{persisted}, slot, slot.Add(24*time.Hour))
	if len(rows) != 0 {
		t.Fatalf("original position still visible: %+v", rows)
	}
	rows = expandCalendarEvents([]domain.CalendarEvent{persisted}, replacement.StartAt, replacement.EndAt)
	if len(rows) != 1 || rows[0].Title != replacement.Title || rows[0].OriginalStart == nil || !rows[0].OriginalStart.Equal(slot) || len(rows[0].OccurrenceOverrides) != 0 {
		t.Fatalf("moved occurrence missing or repeated series payload: %+v", rows)
	}
	rows = expandCalendarEvents([]domain.CalendarEvent{persisted}, series.StartAt, series.EndAt)
	if len(rows) != 1 || rows[0].Title != series.Title || rows[0].Overridden {
		t.Fatalf("first occurrence changed: %+v", rows)
	}
	persisted.OccurrenceOverrides[0].Title = "mutated copy"
	stillMoved, err := svc.CalendarSlot(ctx, "alice", series.ID, slot)
	if err != nil || stillMoved.Title != replacement.Title {
		t.Fatalf("repository alias = %+v, %v", stillMoved, err)
	}
	restored, err := svc.SetCalendarSlot(ctx, "alice", series.ID, slot, nil, CalendarVersion(stillMoved.CalendarEvent))
	if err != nil || restored.Overridden || restored.Title != series.Title || !restored.StartAt.Equal(slot) {
		t.Fatalf("restored = %+v, %v", restored, err)
	}
}

func TestCalendarSlotAndSeriesShareWriteVersion(t *testing.T) {
	svc, _, in := calendarWriteFixture(t)
	ctx := context.Background()
	in.RepeatRule = domain.CalendarRepeatMonthly
	in.StartAt = time.Date(2026, 1, 31, 8, 0, 0, 991, time.UTC)
	in.EndAt = in.StartAt.Add(time.Hour)
	series, err := svc.CreateCalendarEvent(ctx, "alice", in.CreateCalendarEventInput)
	if err != nil {
		t.Fatal(err)
	}
	slot := time.Date(2026, 2, 28, 8, 0, 0, 991, time.UTC)
	version := CalendarVersion(series)
	replacement := in.CreateCalendarEventInput
	replacement.RepeatRule, replacement.AllDay = domain.CalendarRepeatNone, true
	replacement.StartAt, replacement.EndAt = slot, slot.Add(time.Hour)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := svc.SetCalendarSlot(ctx, "alice", series.ID, slot, &replacement, version)
		results <- err
	}()
	go func() {
		defer wg.Done()
		title := "更新系列"
		_, err := svc.UpdateCalendarEvent(ctx, "alice", series.ID, UpdateCalendarEventInput{Title: &title}, version)
		results <- err
	}()
	wg.Wait()
	close(results)
	committed := 0
	for err := range results {
		if err == nil {
			committed++
		} else if !errors.Is(err, domain.ErrConflict) {
			t.Fatal(err)
		}
	}
	if committed != 1 {
		t.Fatalf("committed %d writes for one version", committed)
	}
}
