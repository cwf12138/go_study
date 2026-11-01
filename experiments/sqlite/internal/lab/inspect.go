package lab

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

var dataTables = []string{"users", "memo_folders", "memos", "todo_lists", "todos", "text_clips", "memo_todo_links", "commands"}

type Inspection struct {
	SchemaVersion         int            `json:"schema_version"`
	SQLiteVersion         string         `json:"sqlite_version"`
	JournalMode           string         `json:"journal_mode"`
	ForeignKeys           int            `json:"foreign_keys"`
	Synchronous           int            `json:"synchronous"`
	BusyTimeoutMS         int            `json:"busy_timeout_ms"`
	IntegrityOK           bool           `json:"integrity_ok"`
	ForeignKeysOK         bool           `json:"foreign_keys_ok"`
	OwnerIndexUsed        bool           `json:"owner_index_used"`
	Counts                map[string]int `json:"counts"`
	SourcePresent         bool           `json:"source_present"`
	SourceSHA256          string         `json:"source_sha256,omitempty"`
	SourceArchiveVerified bool           `json:"source_archive_verified"`
	AllModulesMigrated    bool           `json:"all_modules_migrated"`
	AttachmentsIncluded   bool           `json:"attachments_included"`
	ProductionChanged     bool           `json:"production_changed"`
}

func (l *Lab) Inspect(ctx context.Context) (Inspection, error) {
	out := Inspection{SchemaVersion: schemaVersion, Counts: map[string]int{}}
	if err := l.validate(ctx); err != nil {
		return out, err
	}
	for _, query := range []struct {
		sql  string
		dest any
	}{{"SELECT sqlite_version()", &out.SQLiteVersion}, {"PRAGMA journal_mode", &out.JournalMode}, {"PRAGMA foreign_keys", &out.ForeignKeys}, {"PRAGMA synchronous", &out.Synchronous}, {"PRAGMA busy_timeout", &out.BusyTimeoutMS}} {
		if err := l.db.QueryRowContext(ctx, query.sql).Scan(query.dest); err != nil {
			return out, err
		}
	}
	var check string
	if err := l.db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&check); err != nil {
		return out, err
	}
	if check != "ok" {
		return out, errors.New("SQLite integrity check failed")
	}
	out.IntegrityOK = true
	rows, err := l.db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return out, err
	}
	bad := rows.Next()
	readErr := rows.Err()
	rows.Close()
	if readErr != nil {
		return out, readErr
	}
	if bad {
		return out, errors.New("SQLite foreign key check failed")
	}
	out.ForeignKeysOK = true
	for _, table := range dataTables {
		var n int
		if err := l.db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			return out, err
		}
		out.Counts[table] = n
	}
	var sourceRows int
	if err := l.db.QueryRowContext(ctx, "SELECT count(*) FROM source_snapshot").Scan(&sourceRows); err != nil {
		return out, err
	}
	if sourceRows == 1 {
		var original []byte
		if err := l.db.QueryRowContext(ctx, "SELECT sha256,original_bytes FROM source_snapshot WHERE singleton=1").Scan(&out.SourceSHA256, &original); err != nil {
			return out, err
		}
		out.SourcePresent = true
		sum := sha256.Sum256(original)
		if hex.EncodeToString(sum[:]) != out.SourceSHA256 {
			return out, errors.New("original snapshot archive hash mismatch")
		}
		out.SourceArchiveVerified = true
	} else if sourceRows != 0 {
		return out, errors.New("unexpected source archive count")
	}
	rows, err = l.db.QueryContext(ctx, "EXPLAIN QUERY PLAN SELECT payload_json FROM memos WHERE user_id=? ORDER BY pinned DESC,updated_seconds DESC,updated_nanos DESC,id LIMIT 20", "index-probe")
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			return out, err
		}
		if containsIndex(detail, "memos_owner_order") {
			out.OwnerIndexUsed = true
		}
	}
	return out, rows.Err()
}

func containsIndex(detail, name string) bool {
	// Keep the report free of query text; only publish the expected-index result.
	for i := 0; i+len(name) <= len(detail); i++ {
		if detail[i:i+len(name)] == name {
			return true
		}
	}
	return false
}
