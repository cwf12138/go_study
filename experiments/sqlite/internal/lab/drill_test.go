package lab

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/backup"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/store"
)

type fixture struct {
	root, pack, output, source string
	raw                        []byte
	password                   string
}

func seed(t *testing.T) fixture {
	t.Helper()
	root := t.TempDir()
	source := filepath.Join(root, "source", "snapshot.json")
	m := store.NewMemory()
	ctx := context.Background()
	password := "sqlite-fixture-password"
	hash, err := security.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	old := now.Add(-time.Hour)
	for _, id := range []string{"alice", "bob"} {
		must(t, m.CreateUser(ctx, domain.User{ID: id, Email: id + "@example.test", PasswordHash: hash, CreatedAt: now}))
	}
	must(t, m.CreateMemoFolder(ctx, domain.MemoFolder{ID: "folder-alice", UserID: "alice", Name: "我的记录", CreatedAt: now, UpdatedAt: now}))
	must(t, m.CreateMemoFolder(ctx, domain.MemoFolder{ID: "folder-bob", UserID: "bob", Name: "另一账号", CreatedAt: now, UpdatedAt: now}))
	must(t, m.CreateMemoNote(ctx, domain.MemoNote{ID: "memo-alice", UserID: "alice", FolderID: "folder-alice", Title: "中文备忘", Content: "原始正文\n- [x] 已核对", Tags: []string{"日常"}, Pinned: true, CreatedAt: old, UpdatedAt: now}))
	must(t, m.CreateMemoNote(ctx, domain.MemoNote{ID: "memo-trash", UserID: "alice", Title: "最近删除", DeletedAt: &now, CreatedAt: old, UpdatedAt: now}))
	must(t, m.CreateMemoNote(ctx, domain.MemoNote{ID: "memo-bob", UserID: "bob", Title: "私有记录", Content: "BOB_PRIVATE", CreatedAt: old, UpdatedAt: now}))
	must(t, m.CreateTodoList(ctx, domain.TodoList{ID: "list-alice", UserID: "alice", Name: "我的清单", Kind: domain.TodoListCustom}))
	must(t, m.CreateTodoList(ctx, domain.TodoList{ID: "list-bob", UserID: "bob", Name: "另一清单", Kind: domain.TodoListCustom}))
	must(t, m.CreateTodo(ctx, domain.TodoItem{ID: "todo-alice", UserID: "alice", ListID: "list-alice", Title: "原有待办", Status: domain.TodoOpen}))
	for _, id := range []string{"alice", "bob"} {
		_, err := m.SaveTextClip(ctx, domain.TextClip{ID: "same-clip-id", UserID: id, Text: "片段 " + id, Deleted: id == "alice", ExpiresAt: old, CreatedAt: old, UpdatedAt: now}, 0, false)
		must(t, err)
	}
	must(t, m.CreateGoal(ctx, domain.Goal{ID: "archived-goal", UserID: "alice", Title: "未映射的目标", Status: domain.GoalArchived}))
	must(t, m.SaveJSON(source))
	data, err := os.ReadFile(source)
	must(t, err)
	var sections map[string]json.RawMessage
	must(t, json.Unmarshal(data, &sections))
	sections["future_section"] = json.RawMessage(`{"preserve":"不得丢失"}`)
	var notes []map[string]json.RawMessage
	must(t, json.Unmarshal(sections["memo_notes"], &notes))
	for _, n := range notes {
		if string(n["id"]) == `"memo-alice"` {
			n["future_note_field"] = json.RawMessage(`{"kept":true}`)
		}
	}
	sections["memo_notes"], err = json.Marshal(notes)
	must(t, err)
	data, err = json.Marshal(sections)
	must(t, err)
	must(t, os.WriteFile(source, data, 0o600))
	pack := filepath.Join(root, "backup")
	_, err = backup.Create(source, pack, true)
	must(t, err)
	return fixture{root: root, pack: pack, output: filepath.Join(root, "lab"), source: source, raw: data, password: password}
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func imported(t *testing.T) (fixture, *Lab) {
	t.Helper()
	f := seed(t)
	s, err := ReadSource(f.pack)
	must(t, err)
	_, err = Convert(context.Background(), s, f.output, true)
	must(t, err)
	l, err := Open(context.Background(), f.output, false)
	must(t, err)
	t.Cleanup(func() { l.Close() })
	return f, l
}

type memoContract interface {
	CreateUser(context.Context, domain.User) error
	CreateMemoNote(context.Context, domain.MemoNote) error
	MemoNoteByID(context.Context, string) (domain.MemoNote, error)
	ListMemoNotes(context.Context, string) ([]domain.MemoNote, error)
}

var _ memoContract = (*Lab)(nil)
var _ memoContract = (*store.Memory)(nil)

func exerciseMemoContract(t *testing.T, repo memoContract) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	for _, user := range []string{"contract-alice", "contract-bob"} {
		must(t, repo.CreateUser(ctx, domain.User{ID: user, Email: user + "@example.test"}))
	}
	a := domain.MemoNote{ID: "contract-note", UserID: "contract-alice", Title: "保留字段", Content: "中文正文", Tags: []string{"A"}, UpdatedAt: now, CreatedAt: now}
	b := domain.MemoNote{ID: "contract-bob-note", UserID: "contract-bob", Title: "不应出现在 Alice 列表", UpdatedAt: now, CreatedAt: now}
	must(t, repo.CreateMemoNote(ctx, a))
	must(t, repo.CreateMemoNote(ctx, b))
	later := a
	later.ID = "zz-later"
	later.UpdatedAt = a.UpdatedAt.Add(time.Nanosecond)
	must(t, repo.CreateMemoNote(ctx, later))
	if err := repo.CreateMemoNote(ctx, a); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate ID contract", err)
	}
	got, err := repo.MemoNoteByID(ctx, a.ID)
	must(t, err)
	if !reflect.DeepEqual(a, got) {
		t.Fatal("memo fields differ")
	}
	rows, err := repo.ListMemoNotes(ctx, "contract-alice")
	must(t, err)
	if len(rows) != 2 || rows[0].ID != later.ID || rows[1].ID != a.ID {
		t.Fatal("list owner scope differs")
	}
	if _, err := repo.MemoNoteByID(ctx, "absent"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("not found contract", err)
	}
}

func TestSQLiteDrill(t *testing.T) {
	checks := map[string]bool{}
	checks["preview_and_exact_snapshot_archive"] = t.Run("preview-and-source", func(t *testing.T) {
		f := seed(t)
		s, err := ReadSource(f.pack)
		must(t, err)
		plan, err := Convert(context.Background(), s, f.output, false)
		must(t, err)
		if _, err := os.Stat(f.output); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("preview created a database")
		}
		if plan.AllModulesMigrated || plan.AttachmentsCopied || plan.ProductionChanged {
			t.Fatal("prototype overclaimed coverage")
		}
		_, err = Convert(context.Background(), s, f.output, true)
		must(t, err)
		l, err := Open(context.Background(), f.output, false)
		must(t, err)
		defer l.Close()
		original, err := l.OriginalSnapshot(context.Background())
		must(t, err)
		if !bytes.Equal(original, f.raw) {
			t.Fatal("source bytes changed")
		}
		u, err := l.UserByEmail(context.Background(), "ALICE@example.test")
		must(t, err)
		if !security.VerifyPassword(u.PasswordHash, f.password) {
			t.Fatal("credentials not preserved")
		}
		n, err := l.MemoNoteByID(context.Background(), "memo-alice")
		must(t, err)
		if n.FolderID != "folder-alice" || !n.Pinned || n.Content != "原始正文\n- [x] 已核对" {
			t.Fatal("mapped memo fields lost")
		}
		trash, err := l.MemoNoteByID(context.Background(), "memo-trash")
		must(t, err)
		if trash.DeletedAt == nil {
			t.Fatal("trash omitted")
		}
		var clips int
		must(t, l.db.QueryRow("SELECT count(*) FROM text_clips WHERE id='same-clip-id'").Scan(&clips))
		if clips != 2 {
			t.Fatal("scoped duplicate IDs collapsed")
		}
		if _, err := l.MemoFor(context.Background(), "bob", "memo-alice"); !errors.Is(err, domain.ErrNotFound) {
			t.Fatal("scoped read leaked another account")
		}
		var raw string
		must(t, l.db.QueryRow("SELECT payload_json FROM memos WHERE id='memo-alice'").Scan(&raw))
		if !strings.Contains(raw, "future_note_field") {
			t.Fatal("unknown record fields lost")
		}
		if err := l.Import(context.Background(), s); err == nil {
			t.Fatal("nonempty lab accepted import")
		}
		if _, err := Convert(context.Background(), s, f.output, true); err == nil {
			t.Fatal("existing lab overwritten")
		}
		after, err := os.ReadFile(f.source)
		must(t, err)
		if !bytes.Equal(after, f.raw) {
			t.Fatal("source modified")
		}
	})
	checks["selected_memory_sqlite_contract"] = t.Run("repository-contract", func(t *testing.T) {
		t.Run("memory", func(t *testing.T) { exerciseMemoContract(t, store.NewMemory()) })
		t.Run("sqlite", func(t *testing.T) {
			l, err := Create(context.Background(), filepath.Join(t.TempDir(), "contract"))
			must(t, err)
			defer l.Close()
			exerciseMemoContract(t, l)
		})
	})
	checks["atomic_link_idempotency_and_foreign_keys"] = t.Run("atomic-and-idempotent", func(t *testing.T) {
		_, l := imported(t)
		ctx := context.Background()
		n := domain.MemoNote{ID: "atomic-memo", UserID: "alice", Title: "联动备忘", FolderID: "folder-alice"}
		todo := domain.TodoItem{ID: "atomic-todo", UserID: "alice", ListID: "missing-list", Title: "联动待办"}
		if _, err := l.CreateMemoAndTodo(ctx, "alice", "command-atomic", n, todo); err == nil {
			t.Fatal("bad reference committed")
		}
		if _, err := l.MemoNoteByID(ctx, n.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatal("failed transaction left a note")
		}
		todo.ListID = "list-alice"
		a, err := l.CreateMemoAndTodo(ctx, "alice", "command-atomic", n, todo)
		must(t, err)
		b, err := l.CreateMemoAndTodo(ctx, "alice", "command-atomic", n, todo)
		must(t, err)
		if a.Replayed || !b.Replayed || a.MemoID != b.MemoID {
			t.Fatal("idempotency receipt differs")
		}
		n.Title = "different"
		if _, err := l.CreateMemoAndTodo(ctx, "alice", "command-atomic", n, todo); !errors.Is(err, domain.ErrConflict) {
			t.Fatal("idempotency key allowed different request", err)
		}
		n.ID = "foreign-folder"
		n.FolderID = "folder-bob"
		if err := l.CreateMemoNote(ctx, n); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("cross-account FK accepted", err)
		}
		r, err := l.Inspect(ctx)
		must(t, err)
		if r.Counts["memo_todo_links"] != 1 || r.Counts["commands"] != 1 {
			t.Fatal("duplicate link/receipt")
		}
	})
	checks["optimistic_conflicts_and_unknown_fields"] = t.Run("version-conflict", func(t *testing.T) {
		_, l := imported(t)
		ctx := context.Background()
		v, err := l.MemoFor(ctx, "alice", "memo-alice")
		must(t, err)
		start := make(chan struct{})
		results := make(chan error, 2)
		var wg sync.WaitGroup
		for _, title := range []string{"device-one", "device-two"} {
			wg.Add(1)
			go func(title string) {
				defer wg.Done()
				<-start
				n := v.Note
				n.Title = title
				_, err := l.EditMemo(ctx, "alice", n, v.Revision)
				results <- err
			}(title)
		}
		close(start)
		wg.Wait()
		close(results)
		success, conflicts := 0, 0
		for err := range results {
			if err == nil {
				success++
			} else if errors.Is(err, domain.ErrConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if success != 1 || conflicts != 1 {
			t.Fatal("lost update protection failed")
		}
		var raw string
		must(t, l.db.QueryRow("SELECT payload_json FROM memos WHERE id='memo-alice'").Scan(&raw))
		if !strings.Contains(raw, "future_note_field") {
			t.Fatal("editing dropped unknown fields")
		}
		original, err := l.OriginalSnapshot(ctx)
		must(t, err)
		if !strings.Contains(string(original), "future_section") {
			t.Fatal("archive lost unmapped data")
		}
	})
	checks["live_consistent_backup_and_restore"] = t.Run("live-backup", func(t *testing.T) {
		f, l := imported(t)
		ctx := context.Background()
		n := domain.MemoNote{ID: "before-backup", UserID: "alice", Title: "已提交的新记录"}
		must(t, l.CreateMemoNote(ctx, n))
		dest := filepath.Join(f.root, "database-copy")
		report, err := l.Backup(ctx, dest)
		must(t, err)
		if !report.IntegrityOK || !report.SourceArchiveVerified || report.AttachmentsIncluded || report.AllModulesMigrated {
			t.Fatal("backup report invalid")
		}
		must(t, l.CreateMemoNote(ctx, domain.MemoNote{ID: "after-backup", UserID: "alice", Title: "副本之后的记录"}))
		copy, err := Open(ctx, dest, true)
		must(t, err)
		defer copy.Close()
		if _, err := copy.MemoNoteByID(ctx, n.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := copy.MemoNoteByID(ctx, "after-backup"); !errors.Is(err, domain.ErrNotFound) {
			t.Fatal("copy includes later write")
		}
		if _, err := l.Backup(ctx, dest); err == nil {
			t.Fatal("database copy overwritten")
		}
		must(t, copy.Close())
		writable, err := Open(ctx, dest, false)
		must(t, err)
		defer writable.Close()
		settings, err := writable.Inspect(ctx)
		must(t, err)
		if settings.JournalMode != "wal" {
			t.Fatal("restored lab did not regain runtime WAL policy")
		}
	})
	checks["committed_survives_process_kill_uncommitted_does_not"] = t.Run("process-crash", func(t *testing.T) {
		f, l := imported(t)
		must(t, l.Close())
		runCrashChild(t, f.output)
		recovered, err := Open(context.Background(), f.output, false)
		must(t, err)
		defer recovered.Close()
		if _, err := recovered.MemoNoteByID(context.Background(), "crash-committed"); err != nil {
			t.Fatal("acknowledged commit lost", err)
		}
		if _, err := recovered.MemoNoteByID(context.Background(), "crash-uncommitted"); !errors.Is(err, domain.ErrNotFound) {
			t.Fatal("uncommitted row survived", err)
		}
		_, err = recovered.Inspect(context.Background())
		must(t, err)
	})
	if t.Failed() {
		return
	}
	data, _ := json.Marshal(map[string]any{"schema_version": 1, "checked_at": time.Now().UTC(), "fixtures_only": true, "checks": checks, "production_changed": false, "all_modules_migrated": false, "power_loss_verified": false, "android_device_verified": false})
	t.Log("D05_SQLITE_DRILL " + string(data))
}

func TestCrashHelper(t *testing.T) {
	dir := os.Getenv("DAYNEST_SQLITE_CRASH_DIRECTORY")
	if dir == "" {
		return
	}
	l, err := Open(context.Background(), dir, false)
	must(t, err)
	must(t, l.CreateMemoNote(context.Background(), domain.MemoNote{ID: "crash-committed", UserID: "alice", Title: "已确认提交"}))
	tx, err := l.db.BeginTx(context.Background(), nil)
	must(t, err)
	n := domain.MemoNote{ID: "crash-uncommitted", UserID: "alice", Title: "尚未提交"}
	b, err := json.Marshal(n)
	must(t, err)
	must(t, insertMemo(context.Background(), tx, n, b))
	fmt.Println("CRASH_READY")
	time.Sleep(30 * time.Second)
	t.Fatal("parent failed to terminate helper")
}
func runCrashChild(t *testing.T, dir string) {
	t.Helper()
	exe, err := os.Executable()
	must(t, err)
	cmd := exec.Command(exe, "-test.run=^TestCrashHelper$")
	cmd.Env = append(os.Environ(), "DAYNEST_SQLITE_CRASH_DIRECTORY="+dir)
	stdout, err := cmd.StdoutPipe()
	must(t, err)
	cmd.Stderr = os.Stderr
	must(t, cmd.Start())
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	ready := make(chan bool, 1)
	go func() {
		s := bufio.NewScanner(stdout)
		for s.Scan() {
			if s.Text() == "CRASH_READY" {
				ready <- true
				return
			}
		}
		ready <- false
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("crash helper failed before transaction was open")
		}
	case <-time.After(12 * time.Second):
		t.Fatal("crash helper timed out")
	}
	must(t, cmd.Process.Kill())
	cmd.Wait()
}
