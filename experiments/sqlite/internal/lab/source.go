package lab

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/backup"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

const maxSourceBytes = 64 << 20

var mappedSections = map[string]string{"users": "users", "memo_folders": "memo_folders", "memo_notes": "memos", "todo_lists": "todo_lists", "todos": "todos", "text_clips": "text_clips"}

type Coverage struct {
	Section string `json:"section"`
	Records int    `json:"records"`
	Mode    string `json:"mode"`
	Table   string `json:"table,omitempty"`
}
type Plan struct {
	SchemaVersion               int        `json:"schema_version"`
	BackupID                    string     `json:"backup_id"`
	SnapshotSHA256              string     `json:"snapshot_sha256"`
	SnapshotBytes               int        `json:"snapshot_bytes"`
	SavedAt                     time.Time  `json:"saved_at"`
	Accounts                    int        `json:"accounts"`
	Coverage                    []Coverage `json:"coverage"`
	HistoricalMissingReferences int        `json:"historical_missing_references"`
	AllModulesMigrated          bool       `json:"all_modules_migrated"`
	AttachmentsCopied           bool       `json:"attachments_copied"`
	ProductionChanged           bool       `json:"production_changed"`
}
type Source struct {
	data      []byte
	sections  map[string]json.RawMessage
	plan      Plan
	directory string
}

// ReadSource accepts a verified stopped-service backup, never DATA_FILE or a
// guessed live path. Original snapshot bytes stay intact in the lab archive.
func ReadSource(input string) (*Source, error) {
	dir, err := cleanPath(input)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(filepath.Join(dir, "payload", "snapshot.json"))
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxSourceBytes {
		return nil, errors.New("prototype snapshot limit is 64 MiB")
	}
	data, report, err := backup.ReadVerifiedSnapshot(dir)
	if err != nil {
		return nil, err
	}
	if len(data) > maxSourceBytes {
		return nil, errors.New("prototype snapshot limit is 64 MiB")
	}
	inspection, err := store.InspectSnapshot(data)
	if err != nil {
		return nil, err
	}
	sections := map[string]json.RawMessage{}
	if err := json.Unmarshal(data, &sections); err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	p := Plan{SchemaVersion: 1, BackupID: report.BackupID, SnapshotSHA256: hex.EncodeToString(sum[:]), SnapshotBytes: len(data), SavedAt: inspection.SavedAt, Accounts: inspection.Accounts, Coverage: []Coverage{}, HistoricalMissingReferences: inspection.MissingReferences}
	counts := inspection.Records
	counts["users"] = inspection.Accounts
	for key, count := range counts {
		row := Coverage{Section: key, Records: count, Mode: "archive_only"}
		if table, ok := mappedSections[key]; ok {
			row.Mode = "relational_and_archive"
			row.Table = table
		}
		p.Coverage = append(p.Coverage, row)
	}
	sort.Slice(p.Coverage, func(i, j int) bool { return p.Coverage[i].Section < p.Coverage[j].Section })
	s := &Source{data: data, sections: sections, plan: p, directory: dir}
	if err := s.validateMappedReferences(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Source) Plan() Plan {
	p := s.plan
	p.Coverage = append([]Coverage(nil), p.Coverage...)
	return p
}
func (s *Source) rows(section string) ([]json.RawMessage, error) {
	var rows []json.RawMessage
	raw := s.sections[section]
	if len(raw) == 0 {
		return rows, nil
	}
	err := json.Unmarshal(raw, &rows)
	return rows, err
}

func (s *Source) validateMappedReferences() error {
	folders, lists := map[string]string{}, map[string]string{}
	for _, entry := range []struct {
		section string
		into    map[string]string
	}{{"memo_folders", folders}, {"todo_lists", lists}} {
		rows, err := s.rows(entry.section)
		if err != nil {
			return err
		}
		for _, raw := range rows {
			var row struct {
				ID     string
				UserID string `json:"user_id"`
			}
			if err := json.Unmarshal(raw, &row); err != nil {
				return err
			}
			entry.into[row.ID] = row.UserID
		}
	}
	rows, err := s.rows("memo_notes")
	if err != nil {
		return err
	}
	for _, raw := range rows {
		var n domain.MemoNote
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if n.FolderID != "" && folders[n.FolderID] != n.UserID {
			return errors.New("mapped memo folder reference is missing or belongs to another account; no output created")
		}
	}
	rows, err = s.rows("todos")
	if err != nil {
		return err
	}
	for _, raw := range rows {
		var n domain.TodoItem
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if n.ListID == "" || lists[n.ListID] != n.UserID {
			return errors.New("mapped todo list reference is missing or belongs to another account; no output created")
		}
	}
	return nil
}

func (l *Lab) Import(ctx context.Context, s *Source) error {
	if s == nil {
		return errors.New("verified source required")
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"users", "memo_folders", "memos", "todo_lists", "todos", "text_clips", "source_snapshot", "commands", "memo_todo_links"} {
		var n int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return errors.New("import requires a completely empty lab database")
		}
	}
	for _, section := range []string{"users", "memo_folders", "todo_lists", "memo_notes", "todos", "text_clips"} {
		rows, err := s.rows(section)
		if err != nil {
			return err
		}
		for _, raw := range rows {
			if err := ctx.Err(); err != nil {
				return err
			}
			switch section {
			case "users":
				var row persistedUser
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO users(id,email,payload_json) VALUES(?,?,?)", row.ID, strings.ToLower(row.Email), string(raw))
			case "memo_folders":
				var row domain.MemoFolder
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO memo_folders(id,user_id,payload_json) VALUES(?,?,?)", row.ID, row.UserID, string(raw))
			case "todo_lists":
				var row domain.TodoList
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO todo_lists(id,user_id,payload_json) VALUES(?,?,?)", row.ID, row.UserID, string(raw))
			case "memo_notes":
				var row domain.MemoNote
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				err = insertMemo(ctx, tx, row, raw)
			case "todos":
				var row domain.TodoItem
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO todos(id,user_id,list_id,payload_json) VALUES(?,?,?,?)", row.ID, row.UserID, row.ListID, string(raw))
			case "text_clips":
				var row domain.TextClip
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO text_clips(user_id,id,payload_json) VALUES(?,?,?)", row.UserID, row.ID, string(raw))
			}
			if err != nil {
				return dbError(err)
			}
		}
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO source_snapshot(singleton,backup_id,sha256,imported_at,original_bytes) VALUES(1,?,?,?,?)", s.plan.BackupID, s.plan.SnapshotSHA256, time.Now().UTC().Format(time.RFC3339Nano), s.data)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func Convert(ctx context.Context, s *Source, output string, apply bool) (Plan, error) {
	if s == nil {
		return Plan{}, errors.New("verified source required")
	}
	abs, err := cleanPath(output)
	if err != nil {
		return s.Plan(), err
	}
	if overlaps(abs, s.directory) {
		return s.Plan(), errors.New("backup and lab output must be separate")
	}
	if _, err := os.Lstat(abs); !errors.Is(err, os.ErrNotExist) {
		return s.Plan(), errors.New("output must not exist")
	}
	if info, err := os.Stat(filepath.Dir(abs)); err != nil || !info.IsDir() {
		return s.Plan(), errors.New("output parent directory must exist")
	}
	if !apply {
		return s.Plan(), nil
	}
	l, err := Create(ctx, abs)
	if err != nil {
		return s.Plan(), err
	}
	err = l.Import(ctx, s)
	if err == nil {
		var report Inspection
		report, err = l.Inspect(ctx)
		if err == nil && (!report.SourceArchiveVerified || report.SourceSHA256 != s.plan.SnapshotSHA256 || !report.OwnerIndexUsed) {
			err = errors.New("converted database failed read-back validation")
		}
		if err == nil {
			for _, row := range s.plan.Coverage {
				if row.Table != "" && report.Counts[row.Table] != row.Records {
					err = errors.New("converted row count mismatch")
					break
				}
			}
		}
	}
	closeErr := l.Close()
	if err == nil {
		err = closeErr
	}
	return s.Plan(), err
}

func (l *Lab) OriginalSnapshot(ctx context.Context) ([]byte, error) {
	var b []byte
	err := l.db.QueryRowContext(ctx, "SELECT original_bytes FROM source_snapshot WHERE singleton=1").Scan(&b)
	return b, dbError(err)
}

type sqlExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func insertMemo(ctx context.Context, exec sqlExecutor, n domain.MemoNote, raw []byte) error {
	_, err := exec.ExecContext(ctx, "INSERT INTO memos(id,user_id,folder_id,title,updated_seconds,updated_nanos,pinned,deleted,revision,payload_json) VALUES(?,?,?,?,?,?,?,?,1,?)", n.ID, n.UserID, nullID(n.FolderID), n.Title, n.UpdatedAt.Unix(), n.UpdatedAt.Nanosecond(), n.Pinned, n.DeletedAt != nil, string(raw))
	return dbError(err)
}
func nullID(id string) any {
	if id == "" {
		return nil
	}
	return id
}
