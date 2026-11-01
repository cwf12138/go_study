package transfers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"
	"time"
)

type IntegrityIssue struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

type IntegrityReport struct {
	Scope                 string           `json:"scope"`
	StartedAt             time.Time        `json:"started_at"`
	FinishedAt            time.Time        `json:"finished_at"`
	Files                 int              `json:"files"`
	Verified              int              `json:"verified"`
	Missing               int              `json:"missing"`
	Mismatched            int              `json:"mismatched"`
	Unreadable            int              `json:"unreadable"`
	Changed               int              `json:"changed"`
	PendingUploads        int              `json:"pending_uploads"`
	Issues                []IntegrityIssue `json:"issues"`
	UnindexedFilesChecked bool             `json:"unindexed_files_checked"`
	BackupRestoreVerified bool             `json:"backup_restore_verified"`
}

// CheckIntegrity is a read-only, account-scoped inspection of indexed files,
// including expired/trash entries. It never repairs, renews, removes or backs up.
// Hash I/O holds no metadata mutex; mutations detected afterward are inconclusive.
func (s *Store) CheckIntegrity(ctx context.Context, user string) (IntegrityReport, error) {
	if err := ctx.Err(); err != nil {
		return IntegrityReport{}, err
	}
	select {
	case s.checks <- struct{}{}:
		defer func() { <-s.checks }()
	default:
		return IntegrityReport{}, ErrBusy
	}
	out := IntegrityReport{Scope: "indexed_transfer_files", StartedAt: s.now().UTC(), Issues: []IntegrityIssue{}}
	s.mu.Lock()
	rows, err := s.records(user)
	for key := range s.pending {
		if strings.HasPrefix(key, user+":") {
			out.PendingUploads++
		}
	}
	s.mu.Unlock()
	if err != nil {
		return IntegrityReport{}, err
	}
	var bytes int64
	for _, row := range rows {
		bytes += row.Size
	}
	if len(rows) > MaxFiles || bytes > MaxAccountBytes {
		return IntegrityReport{}, ErrQuota
	}
	out.Files = len(rows)
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return IntegrityReport{}, err
		}
		s.mu.Lock()
		pending := s.pending[user+":"+row.ID]
		s.mu.Unlock()
		state := "changed"
		if !pending {
			state, err = s.checkBlob(ctx, row)
			if err != nil {
				return IntegrityReport{}, err
			}
		}
		s.mu.Lock()
		current, readErr := s.read(user, row.ID)
		if s.pending[user+":"+row.ID] || readErr != nil || !reflect.DeepEqual(row, current) {
			state = "changed"
		}
		s.mu.Unlock()
		switch state {
		case "verified":
			out.Verified++
		case "missing":
			out.Missing++
		case "mismatched":
			out.Mismatched++
		case "unreadable":
			out.Unreadable++
		default:
			out.Changed++
			state = "changed"
		}
		if state != "verified" {
			out.Issues = append(out.Issues, IntegrityIssue{ID: row.ID, Name: row.Name, State: state})
		}
	}
	if err := ctx.Err(); err != nil {
		return IntegrityReport{}, err
	}
	out.FinishedAt = s.now().UTC()
	return out, nil
}

func (s *Store) checkBlob(ctx context.Context, row Record) (string, error) {
	_, blob, err := s.paths(row.UserID, row.ID)
	if err != nil {
		return "unreadable", nil
	}
	before, err := os.Lstat(blob)
	if errors.Is(err, os.ErrNotExist) {
		return "missing", nil
	}
	if err != nil || !before.Mode().IsRegular() {
		return "unreadable", nil
	}
	if before.Size() != row.Size {
		return "mismatched", nil
	}
	f, err := os.Open(blob)
	if err != nil {
		return "unreadable", nil
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return "changed", nil
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(contextReader{ctx, f}, MaxFileBytes+1))
	if e := ctx.Err(); e != nil {
		return "", e
	}
	if err != nil {
		return "unreadable", nil
	}
	after, err := os.Lstat(blob)
	if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || before.Size() != after.Size() {
		return "changed", nil
	}
	if n != row.Size || hex.EncodeToString(hash.Sum(nil)) != row.SHA256 {
		return "mismatched", nil
	}
	return "verified", nil
}
