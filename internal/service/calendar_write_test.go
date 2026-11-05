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

func calendarWriteFixture(t *testing.T) (*Service, *store.Memory, CreateCalendarCommandInput) {
	t.Helper()
	repo := store.NewMemory()
	ctx := context.Background()
	for _, id := range []string{"alice", "bob"} {
		if err := repo.CreateUser(ctx, domain.User{ID: id, Email: id + "@example.test"}); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 5, 8, 0, 0, 123456789, time.UTC) }
	return svc, repo, CreateCalendarCommandInput{SchemaVersion: 1, RequestID: "calendar-create-123456", CreateCalendarEventInput: CreateCalendarEventInput{Title: " 整理日常 <计划> ", Description: " 中文\u2028🙂 ", Location: "家", Category: "生活", Color: "#5B81FF", StartAt: svc.now(), EndAt: svc.now().Add(time.Hour), RepeatRule: domain.CalendarRepeatNone, ReminderMinutes: 30}}
}

func TestCalendarCommandConcurrentReplayAndDeleteReload(t *testing.T) {
	svc, repo, in := calendarWriteFixture(t)
	ctx := context.Background()
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := svc.CreateCalendarCommand(ctx, "alice", in)
			if err != nil {
				t.Errorf("create: %v", err)
			}
			if out.Created {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("duplicate creations", successes.Load())
	}
	out, err := svc.CalendarCommand(ctx, "alice", in.RequestID)
	if err != nil || out.Event == nil {
		t.Fatal(out, err)
	}
	if _, err = svc.CalendarCommand(ctx, "bob", in.RequestID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("cross-owner lookup", err)
	}
	changed := in
	changed.Title = "changed"
	if _, err = svc.CreateCalendarCommand(ctx, "alice", changed); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("changed command accepted", err)
	}
	title := "已经在线修改的标题"
	edited, err := svc.UpdateCalendarEvent(ctx, "alice", out.Event.ID, UpdateCalendarEventInput{Title: &title}, CalendarVersion(*out.Event))
	if err != nil {
		t.Fatal(err)
	}
	replay, err := svc.CreateCalendarCommand(ctx, "alice", in)
	if err != nil || replay.Created || replay.Event.Title != edited.Title || replay.Receipt.Fingerprint != out.Receipt.Fingerprint {
		t.Fatal("replay overwrote later edit", replay, err)
	}
	exported, err := svc.ExportUserData(ctx, "alice")
	if err != nil || len(exported.CalendarCommands) != 1 || exported.Counts["calendar_commands"] != 1 {
		t.Fatal("export omitted receipt", err)
	}
	if err = svc.DeleteCalendarEvent(ctx, "alice", edited.ID, CalendarVersion(edited)); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "fixture.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	again, err := New(loaded, nil, nil).CreateCalendarCommand(ctx, "alice", in)
	if err != nil || again.Event != nil || again.Created || again.Receipt.ID != out.Receipt.ID {
		t.Fatal("deleted event resurrected", again, err)
	}
	other, err := svc.CreateCalendarCommand(ctx, "bob", in)
	if err != nil || other.Event.ID == edited.ID {
		t.Fatal("request ID not scoped", err)
	}
}

func TestCalendarEditConcurrencyVersionAndPrecision(t *testing.T) {
	svc, repo, in := calendarWriteFixture(t)
	ctx := context.Background()
	out, err := svc.CreateCalendarCommand(ctx, "alice", in)
	if err != nil {
		t.Fatal(err)
	}
	original := *out.Event
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			title := "不同窗口的修改"
			_, err := svc.UpdateCalendarEvent(ctx, "alice", original.ID, UpdateCalendarEventInput{Title: &title}, CalendarVersion(original))
			if err == nil {
				successes.Add(1)
			} else if !errors.Is(err, domain.ErrConflict) {
				t.Errorf("edit: %v", err)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("concurrent writes", successes.Load())
	}
	current, _ := repo.CalendarEventByID(ctx, original.ID)
	if !current.UpdatedAt.Equal(original.UpdatedAt.Add(time.Nanosecond)) || !current.StartAt.Equal(original.StartAt) || !current.EndAt.Equal(original.EndAt) {
		t.Fatal("clock/time precision changed", current)
	}
	if err = svc.DeleteCalendarEvent(ctx, "alice", original.ID, CalendarVersion(original)); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale deletion", err)
	}
	title := "foreign"
	if _, err = svc.UpdateCalendarEvent(ctx, "bob", original.ID, UpdateCalendarEventInput{Title: &title}, CalendarVersion(current)); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal("cross-owner edit", err)
	}
	if err = svc.DeleteCalendarEvent(ctx, "alice", original.ID, CalendarVersion(current)); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.UpdateCalendarEvent(ctx, "alice", original.ID, UpdateCalendarEventInput{Title: &title}, CalendarVersion(current)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("deleted event rewritten", err)
	}
}

func TestCalendarAllDayUnicodeAndLegacyNotes(t *testing.T) {
	svc, repo, in := calendarWriteFixture(t)
	ctx := context.Background()
	in.Title = strings.Repeat("中", 160)
	in.Description = strings.Repeat("文", 6000)
	in.AllDay = true
	out, err := svc.CreateCalendarCommand(ctx, "alice", in)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 11, 5, 0, 0, 0, 0, calendarLocation)
	if !out.Event.StartAt.Equal(start) || !out.Event.EndAt.Equal(start.AddDate(0, 0, 1)) {
		t.Fatal("all-day boundary", out.Event)
	}
	in.Title += "中"
	if _, err = svc.CreateCalendarCommand(ctx, "alice", in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("title limit", err)
	}
	in.Title = "invalid color"
	in.Color = "#zzzzzz"
	if _, err = svc.CreateCalendarCommand(ctx, "alice", in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("color validation", err)
	}
	legacy := *out.Event
	legacy.ID = "legacy-all-day"
	legacy.StartAt = start.Add(9 * time.Hour)
	legacy.EndAt = start.Add(10 * time.Hour)
	repo.CreateCalendarEvent(ctx, legacy)
	notes := "只改说明"
	updated, err := svc.UpdateCalendarEvent(ctx, "alice", legacy.ID, UpdateCalendarEventInput{Description: &notes}, CalendarVersion(legacy))
	if err != nil || !updated.StartAt.Equal(legacy.StartAt) || !updated.EndAt.Equal(legacy.EndAt) {
		t.Fatal("silently normalized legacy time", updated, err)
	}
	copy, _ := repo.CalendarEventByID(ctx, out.Event.ID)
	until := start.AddDate(0, 0, 10)
	copy.RepeatUntil = &until
	repo.UpdateCalendarEvent(ctx, copy)
	copy, _ = repo.CalendarEventByID(ctx, copy.ID)
	*copy.RepeatUntil = start
	stored, _ := repo.CalendarEventByID(ctx, copy.ID)
	if stored.RepeatUntil.Equal(start) {
		t.Fatal("read pointer modified repository")
	}
}

func TestCalendarFingerprintVector(t *testing.T) {
	_, _, in := calendarWriteFixture(t)
	event, err := newCalendarEvent(in.CreateCalendarEventInput)
	if err != nil {
		t.Fatal(err)
	}
	if got := calendarFingerprint(event); got != "e06040132433b8d8b954a589367470c45536049c97c434756eaa3321832d63c2" {
		t.Fatal(got)
	}
}

func TestCalendarAllDayRecurrenceUsesDateBoundaries(t *testing.T) {
	start := time.Date(1988, 7, 1, 9, 0, 0, 0, calendarWallLocation)
	event, err := newCalendarEvent(CreateCalendarEventInput{Title: "日期边界", StartAt: start, EndAt: start.Add(time.Hour), AllDay: true, RepeatRule: domain.CalendarRepeatYearly})
	if err != nil {
		t.Fatal(err)
	}
	expected := time.Date(1988, 7, 1, 0, 0, 0, 0, calendarWallLocation)
	if !event.StartAt.Equal(expected) || !event.EndAt.Equal(expected.AddDate(0, 0, 1)) {
		t.Fatal(event)
	}
	rows := expandCalendarEvents([]domain.CalendarEvent{event}, expected.AddDate(1, 0, 0), expected.AddDate(1, 0, 2))
	if len(rows) != 1 || rows[0].OccurrenceStart.In(calendarWallLocation).Hour() != 0 {
		t.Fatal(rows)
	}
}
