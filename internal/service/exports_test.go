package service

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestDataCSVAndCalendarExports(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	now := time.Date(2026, 8, 26, 20, 0, 0, 0, time.UTC)
	svc := New(repository, nil, nil)
	svc.now = func() time.Time { return now }
	user := domain.User{ID: "export-user", Email: "export@example.com", Name: "Export learner", PasswordHash: "must-not-leak", Role: domain.RoleStudent, CreatedAt: now.AddDate(0, -1, 0)}
	if err := repository.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	if err := repository.CreateGoal(ctx, domain.Goal{ID: "goal-export", UserID: user.ID, Title: "Learn Go", Status: domain.GoalActive, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	ended := now.Add(-time.Hour)
	if err := repository.CreateFocusSession(ctx, domain.FocusSession{ID: "focus-export", UserID: user.ID, Status: domain.FocusCompleted, PlannedMinutes: 30, ActualMinutes: 30, StartedAt: ended.Add(-30 * time.Minute), EndedAt: &ended}); err != nil {
		t.Fatal(err)
	}
	block := domain.StudyPlanBlock{ID: "block-export", UserID: user.ID, Kind: domain.PlanBlockTask, Title: "阅读 Go 并发：worker pool 与取消机制", Notes: "完成示例；记录问题", StartAt: time.Date(2026, 8, 24, 11, 0, 0, 0, time.UTC), EndAt: time.Date(2026, 8, 24, 11, 50, 0, 0, time.UTC), PlannedMinutes: 50, Status: domain.PlanBlockPlanned, CreatedAt: now, UpdatedAt: now}
	if err := repository.CreatePlanBlock(ctx, block); err != nil {
		t.Fatal(err)
	}

	bundle, err := svc.ExportUserData(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.SchemaVersion != 1 || bundle.Counts["goals"] != 1 || bundle.Counts["focus_sessions"] != 1 {
		t.Fatalf("unexpected export bundle: %+v", bundle.Counts)
	}
	encoded, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("must-not-leak")) {
		t.Fatal("password hash leaked into the portable data export")
	}
	csvData, err := svc.ExportLearningCSV(ctx, user.ID, 7, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(csvData, []byte{0xEF, 0xBB, 0xBF}) || !strings.Contains(string(csvData), "focus_minutes") || !strings.Contains(string(csvData), "2026-08-26,30") {
		t.Fatalf("unexpected CSV export: %q", string(csvData))
	}
	calendar, filename, err := svc.ExportPlanCalendar(ctx, user.ID, "2026-08-24")
	if err != nil {
		t.Fatal(err)
	}
	value := string(calendar)
	if filename != "studyflow-plan-2026-08-24.ics" || !strings.Contains(value, "BEGIN:VCALENDAR\r\n") || !strings.Contains(value, "UID:block-export@studyflow.local") || !strings.Contains(value, "DTSTART:20260824T110000Z") || !strings.Contains(value, "END:VCALENDAR\r\n") {
		t.Fatalf("unexpected calendar export %s: %q", filename, value)
	}
	for _, line := range strings.Split(strings.TrimSuffix(value, "\r\n"), "\r\n") {
		if len(line) > 75 {
			t.Fatalf("ICS line exceeds folding limit (%d bytes): %q", len(line), line)
		}
	}
}
