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
