package store

import (
	"context"
	"fmt"
	"time"

	"github.com/example/studyflow/internal/domain"
)

// UpdateMemoNoteIfUnchanged compares and writes under the same lock. It is an
// optional capability: repositories must not silently emulate it with get/set.
func (m *Memory) UpdateMemoNoteIfUnchanged(_ context.Context, note domain.MemoNote, expected time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.memoNotes[note.ID]
	if !ok {
		return domain.ErrNotFound
	}
	if current.UserID != note.UserID {
		return domain.ErrForbidden
	}
	if current.DeletedAt != nil || !current.UpdatedAt.Equal(expected) {
		return fmt.Errorf("%w: memo changed; reload or keep a separate copy", domain.ErrInvalidState)
	}
	if note.FolderID != "" {
		folder, exists := m.memoFolders[note.FolderID]
		if !exists || folder.UserID != note.UserID {
			return fmt.Errorf("%w: memo folder no longer available", domain.ErrInvalidState)
		}
	}
	m.memoNotes[note.ID] = cloneMemoNote(note)
	return nil
}
