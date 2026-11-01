package lab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/example/studyflow/internal/backup"
	"github.com/example/studyflow/internal/domain"
)

func TestConnectionSettingsAndCancellation(t *testing.T) {
	_, l := imported(t)
	ctx := context.Background()
	// Reserve all pool slots so these are distinct physical connections.
	for i := 0; i < 4; i++ {
		conn, err := l.db.Conn(ctx)
		must(t, err)
		defer conn.Close()
		for _, check := range []struct {
			sql  string
			want int
		}{{"PRAGMA foreign_keys", 1}, {"PRAGMA synchronous", 2}, {"PRAGMA busy_timeout", 1500}} {
			var got int
			must(t, conn.QueryRowContext(ctx, check.sql).Scan(&got))
			if got != check.want {
				t.Fatalf("connection pragma mismatch: %s", check.sql)
			}
		}
	}
}

func TestCancelledTransactionDoesNotCommit(t *testing.T) {
	_, l := imported(t)
	ctx, cancel := context.WithCancel(context.Background())
	tx, err := l.db.BeginTx(ctx, nil)
	must(t, err)
	n := domain.MemoNote{ID: "cancelled-note", UserID: "alice", Title: "不应提交"}
	raw, err := json.Marshal(n)
	must(t, err)
	must(t, insertMemo(ctx, tx, n, raw))
	cancel()
	if err := tx.Commit(); err == nil {
		t.Fatal("cancelled transaction committed")
	}
	if _, err := l.MemoNoteByID(context.Background(), n.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("cancelled row persisted", err)
	}
}

func TestSchemaAndPathRefusal(t *testing.T) {
	ctx := context.Background()
	for _, change := range []string{"future-version", "checksum", "incomplete", "ledger"} {
		t.Run(change, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "lab")
			l, err := Create(ctx, dir)
			must(t, err)
			switch change {
			case "future-version":
				_, err = l.db.Exec("PRAGMA user_version=99")
			case "checksum":
				_, err = l.db.Exec("UPDATE schema_migrations SET sha256='incorrect'")
			case "incomplete":
				err = writeNew(filepath.Join(dir, incompleteName), []byte("interrupted"))
			case "ledger":
				_, err = l.db.Exec("INSERT INTO schema_migrations(version,sha256,applied_at) VALUES(2,'future','unknown')")
			}
			must(t, err)
			must(t, l.Close())
			before, err := os.ReadFile(filepath.Join(dir, dbName))
			must(t, err)
			if opened, err := Open(ctx, dir, false); err == nil {
				opened.Close()
				t.Fatal("unsupported lab opened")
			}
			after, err := os.ReadFile(filepath.Join(dir, dbName))
			must(t, err)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected database was rewritten")
			}
		})
	}
	plain := t.TempDir()
	must(t, os.WriteFile(filepath.Join(plain, dbName), nil, 0o600))
	if opened, err := Open(ctx, plain, false); err == nil {
		opened.Close()
		t.Fatal("unmarked database accepted")
	}
	if _, err := Create(ctx, plain); err == nil {
		t.Fatal("existing directory overwritten")
	}
	_, l := imported(t)
	if _, err := l.Backup(ctx, filepath.Join(l.directory, "nested")); err == nil {
		t.Fatal("nested backup accepted")
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(l.directory, link); err == nil {
		if opened, err := Open(ctx, link, true); err == nil {
			opened.Close()
			t.Fatal("linked lab accepted")
		}
	}
}

func TestSourceRefusalBeforeOutputAndUnknownFields(t *testing.T) {
	f := seed(t)
	// Corrupting a backup without a matching digest must fail before conversion.
	path := filepath.Join(f.pack, "payload", "snapshot.json")
	must(t, os.WriteFile(path, []byte("broken"), 0o600))
	if _, err := ReadSource(f.pack); err == nil {
		t.Fatal("corrupt backup accepted")
	}
	if _, err := os.Stat(f.output); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("invalid source created output")
	}
	f = seed(t)
	var object map[string]json.RawMessage
	must(t, json.Unmarshal(f.raw, &object))
	var notes []map[string]json.RawMessage
	must(t, json.Unmarshal(object["memo_notes"], &notes))
	notes[0]["folder_id"] = json.RawMessage(`"missing-folder"`)
	object["memo_notes"], _ = json.Marshal(notes)
	raw, err := json.Marshal(object)
	must(t, err)
	must(t, os.WriteFile(f.source, raw, 0o600))
	pack := filepath.Join(f.root, "dangling-backup")
	_, err = backup.Create(f.source, pack, true)
	must(t, err)
	if _, err := ReadSource(pack); err == nil {
		t.Fatal("mapped dangling reference was not caught in preview")
	}
}

func TestBoundSQLParametersAndInventory(t *testing.T) {
	f, l := imported(t)
	ctx := context.Background()
	name := filepath.Join(f.root, "数据库 ' ; --")
	if _, err := l.Backup(ctx, name); err != nil {
		t.Fatal("bound VACUUM destination failed", err)
	}
	if _, err := l.UserByEmail(ctx, `alice@example.test' OR 1=1 --`); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("email query was not parameterized", err)
	}
	inv := MigrationInventory()
	if inv.Implemented != 7 || inv.ContractMethods <= inv.Implemented || inv.AllModulesMigrated {
		t.Fatal("coverage overclaimed", inv.Implemented, inv.ContractMethods)
	}
	seen := map[string]bool{}
	for _, row := range inv.Methods {
		if seen[row.Name] {
			t.Fatal("duplicate inventory row")
		}
		seen[row.Name] = true
	}
}
