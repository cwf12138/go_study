package store

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestInspectSnapshotStorageKeysAndReferences(t *testing.T) {
	base := func() snapshot {
		return snapshot{Version: 1, SavedAt: time.Now(), Users: []persistedUser{
			{User: domain.User{ID: "u1", Email: "one@example.test"}, PasswordHash: "hash-one"},
			{User: domain.User{ID: "u2", Email: "two@example.test"}, PasswordHash: "hash-two"},
		}}
	}
	check := func(s snapshot) (SnapshotInspection, error) {
		b, e := json.Marshal(s)
		if e != nil {
			t.Fatal(e)
		}
		return InspectSnapshot(b)
	}
	t.Run("scoped IDs may match across accounts", func(t *testing.T) {
		s := base()
		s.TextClips = []domain.TextClip{{ID: "same", UserID: "u1"}, {ID: "same", UserID: "u2"}}
		if _, err := check(s); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("duplicate natural key", func(t *testing.T) {
		s := base()
		s.Moods = []domain.MoodEntry{{ID: "a", UserID: "u1", Date: "2026-11-01"}, {ID: "b", UserID: "u1", Date: "2026-11-01"}}
		if _, err := check(s); err == nil {
			t.Fatal("would silently collapse mood rows")
		}
	})
	t.Run("duplicate preferences", func(t *testing.T) {
		s := base()
		s.PlannerPrefs = []domain.PlannerPreferences{{UserID: "u1"}, {UserID: "u1"}}
		if _, err := check(s); err == nil {
			t.Fatal("duplicate prefs accepted")
		}
	})
	t.Run("duplicate global ID", func(t *testing.T) {
		s := base()
		s.Goals = []domain.Goal{{ID: "same", UserID: "u1"}, {ID: "same", UserID: "u2"}}
		if _, err := check(s); err == nil {
			t.Fatal("duplicate goal accepted")
		}
	})
	t.Run("cross owner", func(t *testing.T) {
		s := base()
		s.Goals = []domain.Goal{{ID: "g", UserID: "u2"}}
		s.Tasks = []domain.StudyTask{{ID: "t", UserID: "u1", GoalID: "g"}}
		if _, err := check(s); err == nil {
			t.Fatal("foreign reference accepted")
		}
	})
	t.Run("historical missing target is reported", func(t *testing.T) {
		s := base()
		s.Tasks = []domain.StudyTask{{ID: "t", UserID: "u1", GoalID: "old"}}
		r, err := check(s)
		if err != nil || r.MissingReferences != 1 {
			t.Fatal(r, err)
		}
	})
	t.Run("unknown owner", func(t *testing.T) {
		s := base()
		s.Goals = []domain.Goal{{ID: "g", UserID: "other"}}
		if _, err := check(s); err == nil {
			t.Fatal("unknown owner accepted")
		}
	})
}

func TestInspectTodoImportReferences(t *testing.T) {
	base := snapshot{Version: 1, SavedAt: time.Now(), Users: []persistedUser{
		{User: domain.User{ID: "u1", Email: "one@example.test"}, PasswordHash: "hash-one"},
		{User: domain.User{ID: "u2", Email: "two@example.test"}, PasswordHash: "hash-two"},
	}}
	inspect := func(s snapshot) (SnapshotInspection, error) {
		raw, err := json.Marshal(s)
		if err != nil {
			t.Fatal(err)
		}
		return InspectSnapshot(raw)
	}
	base.TodoImports = []domain.TodoImportReceipt{{ID: "import-a", UserID: "u1", TodoID: "todo-a", RequestID: "request-1234567890"}}
	if result, err := inspect(base); err != nil || result.MissingReferences != 1 {
		t.Fatalf("deleted target must remain a historical warning: %+v %v", result, err)
	}
	base.Todos = []domain.TodoItem{{ID: "todo-a", UserID: "u2"}}
	if _, err := inspect(base); err == nil {
		t.Fatal("cross-account receipt target accepted")
	}
	base.Todos = []domain.TodoItem{{ID: "todo-a", UserID: "u1", ImportReceiptID: "import-a"}}
	if result, err := inspect(base); err != nil || result.MissingReferences != 0 {
		t.Fatalf("valid receipt pair: %+v %v", result, err)
	}
	base.TodoImports[0].UserID = "u2"
	if _, err := inspect(base); err == nil {
		t.Fatal("cross-account receipt backlink accepted")
	}
}

func TestInspectTodoSuccessorReferences(t *testing.T) {
	s := snapshot{Version: 1, SavedAt: time.Now(), Users: []persistedUser{
		{User: domain.User{ID: "u1", Email: "one@example.test"}, PasswordHash: "one"},
		{User: domain.User{ID: "u2", Email: "two@example.test"}, PasswordHash: "two"},
	}, Todos: []domain.TodoItem{{ID: "original", UserID: "u1", NextTodoID: "next"}}}
	raw, _ := json.Marshal(s)
	result, err := InspectSnapshot(raw)
	if err != nil || result.MissingReferences != 1 {
		t.Fatalf("deleted successor must be a warning: %+v %v", result, err)
	}
	s.Todos = append(s.Todos, domain.TodoItem{ID: "next", UserID: "u2"})
	raw, _ = json.Marshal(s)
	if _, err = InspectSnapshot(raw); err == nil {
		t.Fatal("cross-account successor accepted")
	}
}

func TestInspectCalendarCommandReferences(t *testing.T) {
	s := snapshot{Version: 1, SavedAt: time.Now(), Users: []persistedUser{
		{User: domain.User{ID: "u1", Email: "one@example.test"}, PasswordHash: "one"},
		{User: domain.User{ID: "u2", Email: "two@example.test"}, PasswordHash: "two"},
	}, CalendarCommands: []domain.CalendarCommandReceipt{{ID: "receipt", UserID: "u1", EventID: "event", RequestID: "request-12345678"}}}
	raw, _ := json.Marshal(s)
	result, err := InspectSnapshot(raw)
	if err != nil || result.MissingReferences != 1 {
		t.Fatalf("deleted event must be historical warning: %+v %v", result, err)
	}
	s.CalendarEvents = []domain.CalendarEvent{{ID: "event", UserID: "u2"}}
	raw, _ = json.Marshal(s)
	if _, err = InspectSnapshot(raw); err == nil {
		t.Fatal("cross-owner event receipt accepted")
	}
}
