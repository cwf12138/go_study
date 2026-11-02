package store

import (
	"context"
	"fmt"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func recordVersion(id string, updated time.Time) string {
	return id + "@" + updated.Format(time.RFC3339Nano)
}

func compareRecordVersion(exists bool, id string, updated time.Time, expected string) error {
	if (!exists && expected == "") || (exists && expected != "" && recordVersion(id, updated) == expected) {
		return nil
	}
	return fmt.Errorf("%w: record changed; compare with the server before saving", domain.ErrInvalidState)
}

// Empty expected means create only if absent. IDs prevent a deleted/recreated
// record with an identical clock value from accepting an old editor's writes.
func (m *Memory) UpsertMoodEntryIfUnchanged(_ context.Context, entry domain.MoodEntry, expected string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := moodKey(entry.UserID, entry.Date)
	current, exists := m.moods[key]
	if err := compareRecordVersion(exists, current.ID, current.UpdatedAt, expected); err != nil {
		return err
	}
	m.moods[key] = cloneMoodEntry(entry)
	return nil
}

func (m *Memory) UpsertWeeklyReflectionIfUnchanged(_ context.Context, reflection domain.WeeklyReflection, expected string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := weeklyReflectionKey(reflection.UserID, reflection.WeekStart)
	current, exists := m.weeklyReflections[key]
	if err := compareRecordVersion(exists, current.ID, current.UpdatedAt, expected); err != nil {
		return err
	}
	m.weeklyReflections[key] = cloneWeeklyReflection(reflection)
	return nil
}

func (m *Memory) DeleteMoodEntryIfUnchanged(_ context.Context, userID, date, expected string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := moodKey(userID, date)
	current, exists := m.moods[key]
	if !exists {
		return domain.ErrNotFound
	}
	if err := compareRecordVersion(true, current.ID, current.UpdatedAt, expected); err != nil {
		return err
	}
	delete(m.moods, key)
	return nil
}
