// Package lab is an isolated SQLite feasibility prototype. It is deliberately
// NOT a full store.Repository and is never selected by cmd/api.
package lab

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"modernc.org/sqlite"
)

const applicationID = 0x444e4c42 // DNLB, distinct from arbitrary SQLite files.
const schemaVersion = 1

//go:embed schema.sql
var schema string

type Marker struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	ID      string `json:"id"`
}
type Lab struct {
	db        *sql.DB
	directory string
	marker    Marker
}

func schemaHash() string { b := sha256.Sum256([]byte(schema)); return hex.EncodeToString(b[:]) }

func connect(ctx context.Context, directory string, readonly bool) (*sql.DB, error) {
	abs := filepath.ToSlash(filepath.Join(directory, dbName))
	if !strings.HasPrefix(abs, "/") {
		abs = "/" + abs
	}
	u := url.URL{Scheme: "file", Path: abs}
	q := u.Query()
	q.Set("mode", "rw")
	if readonly {
		q.Set("mode", "ro")
	}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(1500)")
	q.Add("_pragma", "synchronous(FULL)")
	q.Set("_txlock", "immediate")
	if readonly {
		q.Add("_pragma", "query_only(1)")
	}
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func Create(ctx context.Context, directory string) (*Lab, error) {
	dir, err := newDir(directory, "")
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, dbName), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	db, err := connect(ctx, dir, false)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			db.Close()
		}
	}()
	var journal string
	if err := db.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&journal); err != nil || journal != "wal" {
		return nil, errors.New("could not enable WAL")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, schema); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version,sha256,applied_at) VALUES(?,?,?)", schemaVersion, schemaHash(), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA application_id=%d; PRAGMA user_version=%d", applicationID, schemaVersion)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	marker := Marker{Format: "daynest.sqlite-lab", Version: 1, ID: hex.EncodeToString(id[:])}
	data, err := json.Marshal(marker)
	if err != nil {
		return nil, err
	}
	if err := writeNew(filepath.Join(dir, markerName), data); err != nil {
		return nil, err
	}
	l := &Lab{db: db, directory: dir, marker: marker}
	if err := l.validate(ctx); err != nil {
		return nil, err
	}
	if err := os.Remove(filepath.Join(dir, incompleteName)); err != nil {
		return nil, err
	}
	ok = true
	return l, nil
}

func Open(ctx context.Context, directory string, readonly bool) (*Lab, error) {
	dir, err := cleanPath(directory)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(filepath.Join(dir, incompleteName)); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("incomplete lab directory")
	}
	data, err := smallFile(filepath.Join(dir, markerName), 4096)
	if err != nil {
		return nil, err
	}
	var m Marker
	if err := json.Unmarshal(data, &m); err != nil || m.Format != "daynest.sqlite-lab" || m.Version != 1 || len(m.ID) != 32 {
		return nil, errors.New("not a supported SQLite lab directory")
	}
	if _, err := hex.DecodeString(m.ID); err != nil {
		return nil, errors.New("invalid lab marker")
	}
	if info, err := os.Lstat(filepath.Join(dir, dbName)); err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("lab database missing or unsafe")
	}
	db, err := connect(ctx, dir, readonly)
	if err != nil {
		return nil, err
	}
	l := &Lab{db: db, directory: dir, marker: m}
	if err := l.validate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	// A VACUUM copy can use a different journal header. Restore the lab's
	// runtime WAL policy only after the marker and schema have been accepted.
	if !readonly {
		var journal string
		if err := db.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&journal); err != nil || journal != "wal" {
			db.Close()
			return nil, errors.New("could not enable runtime WAL mode")
		}
	}
	return l, nil
}

func (l *Lab) validate(ctx context.Context) error {
	var app, version int
	if err := l.db.QueryRowContext(ctx, "PRAGMA application_id").Scan(&app); err != nil {
		return err
	}
	if err := l.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if app != applicationID || version != schemaVersion {
		return errors.New("unsupported application or schema version; no migration was attempted")
	}
	var migrations int
	if err := l.db.QueryRowContext(ctx, "SELECT count(*) FROM schema_migrations").Scan(&migrations); err != nil {
		return err
	}
	if migrations != 1 {
		return errors.New("unsupported migration ledger; no migration was attempted")
	}
	var hash string
	if err := l.db.QueryRowContext(ctx, "SELECT sha256 FROM schema_migrations WHERE version=?", schemaVersion).Scan(&hash); err != nil {
		return err
	}
	if hash != schemaHash() {
		return errors.New("schema migration checksum differs from this prototype")
	}
	return nil
}
func (l *Lab) Close() error { return l.db.Close() }

func dbError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	var e *sqlite.Error
	if errors.As(err, &e) {
		switch e.Code() {
		case 1555, 2067:
			return domain.ErrConflict
		case 787, 275, 1299:
			return domain.ErrInvalidInput
		}
	}
	return err
}
