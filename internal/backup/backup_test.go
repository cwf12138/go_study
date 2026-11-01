package backup

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/datalock"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/store"
	"github.com/example/studyflow/internal/transfers"
)

type fixture struct {
	root, source, pack string
	snapshot           []byte
	password           string
}

func seed(t *testing.T) fixture {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.Join(root, "source", "custom-name.json")
	if err := os.Mkdir(filepath.Dir(source), 0o700); err != nil {
		t.Fatal(err)
	}
	m := store.NewMemory()
	password := "drill-only-password"
	hash, err := security.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, u := range []domain.User{{ID: "fixture-alice", Email: "alice@example.test", PasswordHash: hash, Name: "Alice", Role: domain.RoleAdmin, CreatedAt: now}, {ID: "fixture-bob", Email: "bob@example.test", PasswordHash: hash, Name: "Bob", CreatedAt: now}} {
		if err := m.CreateUser(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.SaveJSON(source); err != nil {
		t.Fatal(err)
	} // Older generation retained as .bak.
	operations := []func() error{
		func() error {
			return m.CreateGoal(ctx, domain.Goal{ID: "goal-alice", UserID: "fixture-alice", Title: "完整恢复目标", Status: domain.GoalActive})
		},
		func() error {
			return m.CreateTask(ctx, domain.StudyTask{ID: "task-alice", UserID: "fixture-alice", GoalID: "goal-alice", Title: "引用应保持", Status: domain.TaskTodo})
		},
		func() error {
			return m.CreateTodoList(ctx, domain.TodoList{ID: "list-alice", UserID: "fixture-alice", Name: "演练清单", Kind: domain.TodoListCustom})
		},
		func() error {
			return m.CreateTodo(ctx, domain.TodoItem{ID: "todo-alice", UserID: "fixture-alice", ListID: "list-alice", Title: "今日恢复检查", Status: domain.TodoOpen})
		},
		func() error {
			return m.CreateMemoFolder(ctx, domain.MemoFolder{ID: "folder-alice", UserID: "fixture-alice", Name: "我的文件夹"})
		},
		func() error {
			return m.CreateMemoNote(ctx, domain.MemoNote{ID: "memo-alice", UserID: "fixture-alice", FolderID: "folder-alice", Title: "中文笔记", Content: "需要完整保留的正文\n- [x] 核对字段", Tags: []string{"演练"}, Pinned: true})
		},
		func() error {
			return m.CreateMemoNote(ctx, domain.MemoNote{ID: "trash-memo", UserID: "fixture-alice", FolderID: "folder-alice", Title: "回收站保留", Content: "不应静默删除", DeletedAt: &now})
		},
		func() error {
			return m.CreateMemoNote(ctx, domain.MemoNote{ID: "memo-bob", UserID: "fixture-bob", Title: "Bob private", Content: "BOB_PRIVATE_BODY"})
		},
		func() error {
			return m.CreateCalendarEvent(ctx, domain.CalendarEvent{ID: "event-alice", UserID: "fixture-alice", Title: "日历演练", StartAt: now, EndAt: now.Add(time.Hour), RepeatRule: domain.CalendarRepeatWeekly})
		},
		func() error {
			_, err := m.SaveTextClip(ctx, domain.TextClip{ID: "clip-same", UserID: "fixture-alice", Title: "Alice片段", Text: "ALICE_PRIVATE_CLIP", TTLHours: 24, ExpiresAt: now.Add(-time.Hour), Deleted: true, CreatedAt: now, UpdatedAt: now}, 0, false)
			return err
		},
		func() error {
			_, err := m.SaveTextClip(ctx, domain.TextClip{ID: "clip-same", UserID: "fixture-bob", Title: "Bob片段", Text: "BOB_PRIVATE_CLIP", CreatedAt: now, UpdatedAt: now}, 0, false)
			return err
		},
	}
	for _, op := range operations {
		if err := op(); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.SaveJSON(source); err != nil {
		t.Fatal(err)
	}
	x := transfers.New(filepath.Join(filepath.Dir(source), "transfers"))
	for _, p := range []struct{ user, id, body string }{{"fixture-alice", "upload-live", "ALICE_ATTACHMENT_内容"}, {"fixture-alice", "upload-trash", "TRASH_ATTACHMENT_内容"}, {"fixture-bob", "upload-live", "BOB_ATTACHMENT_内容"}} {
		if _, err := x.Upload(ctx, p.user, p.id, "演练.txt", 0, strings.NewReader(p.body), int64(len(p.body))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := x.Action(ctx, "fixture-alice", "upload-trash", "trash"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{root: root, source: source, pack: filepath.Join(root, "backup"), snapshot: data, password: password}
}

func mustCreate(t *testing.T, f fixture) Report {
	t.Helper()
	r, err := Create(f.source, f.pack, true)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func read(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func write(t *testing.T, name string, b []byte) {
	t.Helper()
	if err := os.WriteFile(name, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
func mutateManifest(t *testing.T, dir string, fn func(*Manifest)) {
	t.Helper()
	m, err := readManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	fn(&m)
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "manifest.json"), data)
}

func TestBackupRoundTripAndPreview(t *testing.T) {
	f := seed(t)
	r := mustCreate(t, f)
	if !r.ContentVerified || r.ApplicationVerified || r.ProductionChanged || r.Snapshot.Accounts != 2 || r.Transfers.Files != 3 || r.Transfers.Trashed != 1 || r.RollingBackup != "valid" {
		t.Fatalf("unexpected report: %+v", r)
	}
	encoded, _ := json.Marshal(r)
	for _, private := range []string{f.root, "fixture-alice", "ALICE_PRIVATE_CLIP", "需要完整保留", "password_hash"} {
		if bytes.Contains(encoded, []byte(private)) {
			t.Fatalf("private report field: %s", private)
		}
	}
	to := filepath.Join(f.root, "restored")
	if r, err := Restore(f.pack, to, false); err != nil || r.Operation != "restore_preview" {
		t.Fatal(r, err)
	}
	if _, err := os.Stat(to); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("preview wrote destination")
	}
	if _, err := Restore(f.pack, to, true); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(read(t, filepath.Join(to, "studyflow.json")), f.snapshot) {
		t.Fatal("snapshot bytes changed")
	}
	if !bytes.Equal(read(t, f.source), f.snapshot) {
		t.Fatal("source changed")
	}
	if !bytes.Equal(read(t, f.source+".bak"), read(t, filepath.Join(to, "studyflow.json.bak"))) {
		t.Fatal("rolling backup changed")
	}
	loaded := store.NewMemory()
	if err := loaded.LoadJSON(filepath.Join(to, "studyflow.json")); err != nil {
		t.Fatal(err)
	}
	u, err := loaded.UserByEmail(context.Background(), "alice@example.test")
	if err != nil || !security.VerifyPassword(u.PasswordHash, f.password) {
		t.Fatal("credentials not retained", err)
	}
	task, err := loaded.TaskByID(context.Background(), "task-alice")
	if err != nil || task.GoalID != "goal-alice" {
		t.Fatal("goal reference", task, err)
	}
	note, err := loaded.MemoNoteByID(context.Background(), "memo-alice")
	if err != nil || note.FolderID != "folder-alice" || !note.Pinned || !strings.Contains(note.Content, "核对字段") {
		t.Fatal(note, err)
	}
	trash, err := loaded.MemoNoteByID(context.Background(), "trash-memo")
	if err != nil || trash.DeletedAt == nil {
		t.Fatal(trash, err)
	}
	clips, err := loaded.ListTextClips(context.Background(), "fixture-alice")
	if err != nil || len(clips) != 1 || !clips[0].Deleted || clips[0].ExpiresAt.After(time.Now()) {
		t.Fatal(clips, err)
	}
	x := transfers.New(filepath.Join(to, "transfers"))
	file, row, err := x.Open(context.Background(), "fixture-alice", "upload-live")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(file)
	file.Close()
	sum := sha256.Sum256(data)
	if row.SHA256 != hex.EncodeToString(sum[:]) || string(data) != "ALICE_ATTACHMENT_内容" {
		t.Fatal("attachment read-back mismatch")
	}
	if _, err := Restore(f.pack, to, true); err == nil {
		t.Fatal("existing restore directory overwritten")
	}
}

func TestBackupRefusesBusyAndNestedDirectories(t *testing.T) {
	f := seed(t)
	if _, err := Create(f.source, f.pack, false); err == nil {
		t.Fatal("offline assertion missing")
	}
	l, err := datalock.Acquire(filepath.Dir(f.source))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Create(f.source, f.pack, true); !errors.Is(err, datalock.ErrBusy) {
		t.Fatal("busy source", err)
	}
	l.Close()
	if _, err := os.Stat(f.pack); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("busy operation wrote backup")
	}
	if _, err := Create(f.source, filepath.Join(filepath.Dir(f.source), "nested-backup"), true); err == nil {
		t.Fatal("nested destination accepted")
	}
	mustCreate(t, f)
	if _, err := Create(f.source, f.pack, true); err == nil {
		t.Fatal("existing backup overwritten")
	}
	if _, err := Restore(f.pack, filepath.Join(f.pack, "restored"), false); err == nil {
		t.Fatal("nested restore accepted")
	}
}

func TestBackupRejectsCorruptAndUnsafePackages(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*testing.T, fixture)
	}{
		{"changed bytes", func(t *testing.T, f fixture) {
			b := read(t, filepath.Join(f.pack, filepath.FromSlash(primary)))
			b[0] = '[' // Same size; must fail SHA-256, not merely the size check.
			write(t, filepath.Join(f.pack, filepath.FromSlash(primary)), b)
		}},
		{"missing blob", func(t *testing.T, f fixture) {
			m, _ := readManifest(f.pack)
			for _, e := range m.Files {
				if strings.HasSuffix(e.Path, ".blob") {
					if err := os.Remove(filepath.Join(f.pack, filepath.FromSlash(e.Path))); err != nil {
						t.Fatal(err)
					}
					return
				}
			}
		}},
		{"unlisted private file", func(t *testing.T, f fixture) { write(t, filepath.Join(f.pack, ".env"), []byte("secret")) }},
		{"path traversal", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.Files[0].Path = "../outside" })
		}},
		{"Windows path", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.Files[0].Path = `C:\outside` })
		}},
		{"Windows ADS", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.Files[0].Path = "payload/snapshot.json:extra" })
		}},
		{"duplicate entry", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.Files = append(m.Files, m.Files[0]) })
		}},
		{"unknown version", func(t *testing.T, f fixture) { mutateManifest(t, f.pack, func(m *Manifest) { m.Version = 99 }) }},
		{"contradictory transfer scope", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.TransfersPresentAtSource = false })
		}},
		{"oversized entry", func(t *testing.T, f fixture) {
			mutateManifest(t, f.pack, func(m *Manifest) { m.Files[0].Size = MaxTotalBytes + 1 })
		}},
		{"incomplete marker", func(t *testing.T, f fixture) { write(t, filepath.Join(f.pack, Incomplete), []byte("interrupted")) }},
		{"duplicate manifest key", func(t *testing.T, f fixture) {
			b := read(t, filepath.Join(f.pack, "manifest.json"))
			b = bytes.Replace(b, []byte(`"version": 1`), []byte(`"version": 1, "version": 1`), 1)
			write(t, filepath.Join(f.pack, "manifest.json"), b)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := seed(t)
			mustCreate(t, f)
			test.change(t, f)
			to := filepath.Join(f.root, "rejected")
			if _, err := Verify(f.pack); err == nil {
				t.Fatal("invalid package verified")
			}
			if _, err := Restore(f.pack, to, true); err == nil {
				t.Fatal("invalid package restored")
			}
			if _, err := os.Stat(to); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("rejected package created restore directory")
			}
			if !bytes.Equal(read(t, f.source), f.snapshot) {
				t.Fatal("source changed")
			}
		})
	}
}

func TestBackupSemanticFailuresAndPreservation(t *testing.T) {
	t.Run("foreign metadata rejected even with matching manifest", func(t *testing.T) {
		f := seed(t)
		mustCreate(t, f)
		m, err := readManifest(f.pack)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range m.Files {
			if !strings.HasPrefix(e.Path, "payload/transfers/") || !strings.HasSuffix(e.Path, ".json") {
				continue
			}
			var row transfers.Record
			if err := json.Unmarshal(read(t, filepath.Join(f.pack, filepath.FromSlash(e.Path))), &row); err != nil {
				t.Fatal(err)
			}
			row.UserID = "foreign-owner"
			data, err := json.Marshal(row)
			if err != nil {
				t.Fatal(err)
			}
			write(t, filepath.Join(f.pack, filepath.FromSlash(e.Path)), data)
			sum := sha256.Sum256(data)
			mutateManifest(t, f.pack, func(m *Manifest) {
				for i := range m.Files {
					if m.Files[i].Path == e.Path {
						m.Files[i].SHA256 = hex.EncodeToString(sum[:])
						m.Files[i].Size = int64(len(data))
					}
				}
			})
			break
		}
		if _, err := Verify(f.pack); err == nil {
			t.Fatal("forged ownership accepted")
		}
	})
	t.Run("missing source blob", func(t *testing.T) {
		f := seed(t)
		sum := sha256.Sum256([]byte("fixture-alice"))
		blob := filepath.Join(filepath.Dir(f.source), "transfers", hex.EncodeToString(sum[:]), "upload-live.blob")
		if err := os.Remove(blob); err != nil {
			t.Fatal(err)
		}
		if _, err := Create(f.source, f.pack, true); err == nil {
			t.Fatal("missing blob accepted")
		}
		if _, err := Verify(f.pack); err == nil {
			t.Fatal("partial backup accepted")
		}
		if _, err := os.Stat(filepath.Join(f.pack, Incomplete)); err != nil {
			t.Fatal("partial marker missing", err)
		}
	})
	t.Run("invalid primary never falls back", func(t *testing.T) {
		f := seed(t)
		write(t, f.source, []byte{0, 0, 0})
		if _, err := Create(f.source, f.pack, true); err == nil {
			t.Fatal("invalid primary accepted")
		}
		if _, err := os.Stat(f.pack); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid primary created backup")
		}
		if len(read(t, f.source)) != 3 {
			t.Fatal("source repaired without permission")
		}
	})
	t.Run("invalid rolling backup retained", func(t *testing.T) {
		f := seed(t)
		write(t, f.source+".bak", []byte{0, 0})
		r := mustCreate(t, f)
		if r.RollingBackup != "invalid_preserved" || len(r.Warnings) == 0 {
			t.Fatal(r)
		}
		to := filepath.Join(f.root, "restored")
		if _, err := Restore(f.pack, to, true); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(read(t, filepath.Join(to, "studyflow.json.bak")), []byte{0, 0}) {
			t.Fatal("backup dropped")
		}
	})
	t.Run("orphan files retained", func(t *testing.T) {
		f := seed(t)
		sum := sha256.Sum256([]byte("fixture-alice"))
		write(t, filepath.Join(filepath.Dir(f.source), "transfers", hex.EncodeToString(sum[:]), ".upload-orphan"), []byte("preserve interrupted bytes"))
		r := mustCreate(t, f)
		if r.Transfers.OrphanFiles != 1 {
			t.Fatal(r)
		}
	})
	t.Run("unknown raw sections retained", func(t *testing.T) {
		f := seed(t)
		raw := bytes.TrimSpace(f.snapshot)
		raw = append(append(raw[:len(raw)-1], []byte(`,"legacy_future_data":{"kept":"保留"}`)...), '}')
		write(t, f.source, raw)
		mustCreate(t, f)
		to := filepath.Join(f.root, "restored")
		if _, err := Restore(f.pack, to, true); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(read(t, filepath.Join(to, "studyflow.json")), raw) {
			t.Fatal("unknown section rewritten")
		}
	})
}

func TestJSONAndPathBoundaries(t *testing.T) {
	for _, b := range []string{`{"a":1,"a":2}`, `{"x":{"a":1,"a":2}}`, `{} 42`, strings.Repeat("[", 130) + strings.Repeat("]", 130)} {
		if checkJSON([]byte(b)) == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
	for _, p := range []string{"../a", "/root", "a\\b", "a:ads", "a/CON.txt", "a/lpt1", "a/b.", "a//b", "a/../b", "a/COM¹"} {
		if safeRelative(p) {
			t.Fatal("unsafe path", p)
		}
	}
}

func TestRejectsSourceSymlinkWhenAvailable(t *testing.T) {
	f := seed(t)
	link := filepath.Join(f.root, "source-link")
	if err := os.Symlink(filepath.Dir(f.source), link); err != nil {
		t.Skip("symlink creation unavailable; other path checks completed")
	}
	if _, err := Create(filepath.Join(link, filepath.Base(f.source)), f.pack, true); err == nil {
		t.Fatal("linked source accepted")
	}
}
