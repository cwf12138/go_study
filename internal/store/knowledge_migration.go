package store

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"

	"github.com/example/studyflow/internal/domain"
)

// MigrateKnowledgeToMemos copies legacy notes without removing their originals.
// Call before serving requests and save the snapshot before allowing edits.
// Persisted receipts prevent edits/trash/permanent deletions from being undone.
func (m *Memory) MigrateKnowledgeToMemos() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.knowledgeNotes))
	for id := range m.knowledgeNotes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	folders := make(map[string]string)
	count := 0
	for _, id := range ids {
		note := m.knowledgeNotes[id]
		key := migrationID("source", note.UserID, note.ID)
		if _, done := m.knowledgeMemoMigrations[key]; done {
			continue
		}
		if strings.TrimSpace(note.Title) == "" && strings.TrimSpace(note.Content) == "" {
			continue
		}
		folderID := folders[note.UserID]
		if folderID == "" {
			// Reuse only the same user's dedicated import folder.
			for _, folder := range m.memoFolders {
				if folder.UserID == note.UserID && folder.Name == "知识花园（已迁入）" {
					if folderID == "" || folder.ID < folderID {
						folderID = folder.ID
					}
				}
			}
			if folderID == "" {
				base := migrationID("folder", note.UserID, "")
				folderID = base
				for suffix := 1; ; suffix++ {
					if _, exists := m.memoFolders[folderID]; !exists {
						break
					}
					folderID = fmt.Sprintf("%s-%d", base, suffix)
				}
				m.memoFolders[folderID] = domain.MemoFolder{ID: folderID, UserID: note.UserID, Name: "知识花园（已迁入）", Color: "mint", CreatedAt: note.CreatedAt, UpdatedAt: note.UpdatedAt}
			}
			folders[note.UserID] = folderID
		}
		base := migrationID("note", note.UserID, note.ID)
		target := base
		for suffix := 1; ; suffix++ {
			if _, exists := m.memoNotes[target]; !exists {
				break
			}
			target = fmt.Sprintf("%s-%d", base, suffix)
		}
		m.memoNotes[target] = domain.MemoNote{
			ID: target, UserID: note.UserID, FolderID: folderID,
			Title: note.Title, Content: note.Content, Tags: append([]string(nil), note.Tags...),
			Color: "default", Pinned: note.Pinned, CreatedAt: note.CreatedAt, UpdatedAt: note.UpdatedAt,
		}
		m.knowledgeMemoMigrations[key] = target
		count++
	}
	return count
}

func migrationID(kind, userID, sourceID string) string {
	return fmt.Sprintf("knowledge-%s-%x", kind, sha256.Sum256([]byte(fmt.Sprintf("%q:%q", userID, sourceID))))
}
