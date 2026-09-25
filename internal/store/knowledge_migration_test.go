package store

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestKnowledgeMigrationPreservesDataAndReceipts(t *testing.T) {
	m := NewMemory()
	timestamp := time.Date(2026, 9, 20, 8, 0, 0, 0, time.UTC)
	source := domain.KnowledgeNote{ID: "n1", UserID: "u1", Title: "旧笔记", Content: "## 正文\n[[链接]]", Tags: []string{"灵感实验", "生活"}, Pinned: true, CreatedAt: timestamp, UpdatedAt: timestamp.Add(time.Hour)}
	m.knowledgeNotes[source.ID] = source
	m.knowledgeNotes["n2"] = domain.KnowledgeNote{ID: "n2", UserID: "u2", Title: "另一个用户"}
	m.knowledgeNotes["empty"] = domain.KnowledgeNote{ID: "empty", UserID: "u1", Content: "  "}
	path := filepath.Join(t.TempDir(), "data.json")
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if count := m.MigrateKnowledgeToMemos(); count != 2 {
		t.Fatalf("migrated %d", count)
	}
	targetID := m.knowledgeMemoMigrations[migrationID("source", "u1", "n1")]
	target := m.memoNotes[targetID]
	if target.Title != source.Title || target.Content != source.Content || !target.Pinned || !reflect.DeepEqual(target.Tags, source.Tags) || !target.CreatedAt.Equal(source.CreatedAt) || !target.UpdatedAt.Equal(source.UpdatedAt) {
		t.Fatalf("copy lost fields: %+v", target)
	}
	if len(m.memoFolders) != 2 || m.memoFolders[target.FolderID].UserID != "u1" {
		t.Fatal("folder ownership lost")
	}
	if !reflect.DeepEqual(m.knowledgeNotes["n1"], source) {
		t.Fatal("original changed")
	}
	target.Tags[0] = "modified"
	if m.knowledgeNotes["n1"].Tags[0] != "灵感实验" {
		t.Fatal("tags shared with original")
	}
	target.Content = "edited in memos"
	m.memoNotes[targetID] = target
	otherID := m.knowledgeMemoMigrations[migrationID("source", "u2", "n2")]
	delete(m.memoNotes, otherID)
	if count := m.MigrateKnowledgeToMemos(); count != 0 {
		t.Fatal("migration not idempotent")
	}
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	backup := NewMemory()
	if err := backup.LoadJSON(path + ".bak"); err != nil {
		t.Fatal(err)
	}
	if len(backup.knowledgeNotes) != 3 || len(backup.memoNotes) != 0 {
		t.Fatal("pre-migration backup not preserved")
	}
	reloaded := NewMemory()
	if err := reloaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	if count := reloaded.MigrateKnowledgeToMemos(); count != 0 {
		t.Fatal("receipts lost on restart")
	}
	if reloaded.memoNotes[targetID].Content != "edited in memos" {
		t.Fatal("user edit overwritten")
	}
	if _, exists := reloaded.memoNotes[otherID]; exists {
		t.Fatal("deleted memo resurrected")
	}
}

func TestKnowledgeMigrationDoesNotOverwriteCollision(t *testing.T) {
	m := NewMemory()
	m.knowledgeNotes["n"] = domain.KnowledgeNote{ID: "n", UserID: "u", Title: "import"}
	id := migrationID("note", "u", "n")
	m.memoNotes[id] = domain.MemoNote{ID: id, UserID: "other", Title: "existing"}
	folderID := migrationID("folder", "u", "")
	m.memoFolders[folderID] = domain.MemoFolder{ID: folderID, UserID: "other", Name: "private"}
	if m.MigrateKnowledgeToMemos() != 1 {
		t.Fatal("missing import")
	}
	if m.memoNotes[id].Title != "existing" || m.memoFolders[folderID].Name != "private" {
		t.Fatal("collision overwritten")
	}
	copy := m.memoNotes[m.knowledgeMemoMigrations[migrationID("source", "u", "n")]]
	if copy.ID == id || copy.FolderID == folderID || m.memoFolders[copy.FolderID].UserID != "u" {
		t.Fatal("collision not isolated")
	}
}
