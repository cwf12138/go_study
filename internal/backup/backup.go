// Package backup implements local, stopped-service directory backups. Packages
// are private, unencrypted copies. Verification detects corruption, not forgery.
package backup

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/buildinfo"
	"github.com/example/studyflow/internal/datalock"
	"github.com/example/studyflow/internal/store"
)

const Format = "daynest.service-backup"
const primary = "payload/snapshot.json"

type Entry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	Format                   string         `json:"format"`
	Version                  int            `json:"version"`
	ID                       string         `json:"id"`
	CreatedAt                time.Time      `json:"created_at"`
	Build                    buildinfo.Info `json:"build"`
	SnapshotVersion          int            `json:"snapshot_version"`
	TransfersIncluded        bool           `json:"transfers_included"`
	TransfersPresentAtSource bool           `json:"transfers_present_at_source"`
	Files                    []Entry        `json:"files"`
}

// Reports deliberately exclude account IDs, titles, content and absolute paths.
// Validation is never equivalent to launching the restored app or device QA.
type Report struct {
	Operation           string                   `json:"operation"`
	BackupID            string                   `json:"backup_id"`
	CheckedAt           time.Time                `json:"checked_at"`
	Files               int                      `json:"files"`
	Bytes               int64                    `json:"bytes"`
	Snapshot            store.SnapshotInspection `json:"snapshot"`
	Transfers           TransferInspection       `json:"transfers"`
	RollingBackup       string                   `json:"rolling_backup"`
	Warnings            []string                 `json:"warnings"`
	ContentVerified     bool                     `json:"content_verified"`
	ApplicationVerified bool                     `json:"application_verified"`
	ProductionChanged   bool                     `json:"production_changed"`
}

func fileLimit(name string) int64 {
	if name == primary || name == primary+".bak" {
		return MaxSnapshotBytes
	}
	return 32 << 20
}

func payloadPath(name string) bool {
	if !safeRelative(name) {
		return false
	}
	if name == primary || name == primary+".bak" {
		return true
	}
	parts := strings.Split(name, "/")
	return len(parts) == 4 && parts[0] == "payload" && parts[1] == "transfers" && digestPattern.MatchString(parts[2])
}

func inspectSnapshot(name string) (store.SnapshotInspection, error) {
	data, err := readSmall(name, MaxSnapshotBytes)
	if err != nil {
		return store.SnapshotInspection{}, err
	}
	if err := checkJSON(data); err != nil {
		return store.SnapshotInspection{}, err
	}
	return store.InspectSnapshot(data)
}

// Create requires the new API's lock AND an explicit offline assertion, since
// old API binaries do not participate in data-directory locking.
func Create(dataFile, output string, serviceStopped bool) (Report, error) {
	if !serviceStopped {
		return Report{}, errors.New("stop the service and explicitly pass --service-stopped")
	}
	source, err := absoluteNoLinks(dataFile)
	if err != nil {
		return Report{}, err
	}
	f, _, err := regularOpen(source, MaxSnapshotBytes)
	if err != nil {
		return Report{}, err
	}
	f.Close()
	guard, err := datalock.Acquire(filepath.Dir(source))
	if err != nil {
		return Report{}, err
	}
	defer guard.Close()
	if _, err := os.Lstat(filepath.Join(filepath.Dir(source), Incomplete)); !errors.Is(err, os.ErrNotExist) {
		return Report{}, errors.New("source is an incomplete restore")
	}
	if _, err := inspectSnapshot(source); err != nil {
		return Report{}, fmt.Errorf("primary snapshot failed validation; source preserved: %w", err)
	}
	type sourceFile struct{ src, path string }
	sources := []sourceFile{{source, primary}}
	if _, err := os.Lstat(source + ".bak"); err == nil {
		sources = append(sources, sourceFile{source + ".bak", primary + ".bak"})
	} else if !errors.Is(err, os.ErrNotExist) {
		return Report{}, err
	}
	transferRoot := filepath.Join(filepath.Dir(source), "transfers")
	present := false
	if _, err := os.Lstat(transferRoot); err == nil {
		present = true
		if _, err := absoluteNoLinks(transferRoot); err != nil {
			return Report{}, err
		}
		names, err := walk(transferRoot)
		if err != nil {
			return Report{}, err
		}
		for _, name := range names {
			sources = append(sources, sourceFile{filepath.Join(transferRoot, filepath.FromSlash(name)), "payload/transfers/" + name})
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Report{}, err
	}
	if len(sources) > MaxFiles {
		return Report{}, errors.New("too many files")
	}
	target, err := newDirectory(output, filepath.Dir(source))
	if err != nil {
		return Report{}, err
	}
	if err := os.MkdirAll(filepath.Join(target, "payload", "transfers"), 0o700); err != nil {
		return Report{}, err
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Report{}, err
	}
	m := Manifest{Format: Format, Version: 1, ID: hex.EncodeToString(random[:]), CreatedAt: time.Now().UTC(), Build: buildinfo.Current(), SnapshotVersion: 1, TransfersIncluded: true, TransfersPresentAtSource: present}
	var total int64
	for _, s := range sources {
		if !payloadPath(s.path) {
			return Report{}, errors.New("unsupported transfer layout")
		}
		e, err := fileDigest(s.src, fileLimit(s.path), filepath.Join(target, filepath.FromSlash(s.path)))
		if err != nil {
			return Report{}, fmt.Errorf("backup copy failed; incomplete destination retained: %w", err)
		}
		e.Path = s.path
		total += e.Size
		if total > MaxTotalBytes {
			return Report{}, errors.New("backup exceeds the total size limit")
		}
		m.Files = append(m.Files, e)
	}
	sort.Slice(m.Files, func(i, j int) bool { return m.Files[i].Path < m.Files[j].Path })
	report, err := inspectContent(target, m)
	if err != nil {
		return Report{}, err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return Report{}, err
	}
	if int64(len(data))+1 > maxManifestBytes {
		return Report{}, errors.New("manifest exceeds the size limit; incomplete destination retained")
	}
	if err := exclusiveWrite(filepath.Join(target, "manifest.json"), append(data, '\n')); err != nil {
		return Report{}, err
	}
	if err := os.Remove(filepath.Join(target, Incomplete)); err != nil {
		return Report{}, err
	}
	report.Operation = "create"
	return report, nil
}

func readManifest(root string) (Manifest, error) {
	var m Manifest
	if _, err := os.Lstat(filepath.Join(root, Incomplete)); !errors.Is(err, os.ErrNotExist) {
		return m, errors.New("backup is incomplete")
	}
	data, err := readSmall(filepath.Join(root, "manifest.json"), maxManifestBytes)
	if err != nil {
		return m, err
	}
	if err := checkJSON(data); err != nil {
		return m, err
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err := d.Decode(&m); err != nil {
		return m, errors.New("invalid backup manifest")
	}
	if m.Format != Format || m.Version != 1 || m.SnapshotVersion != 1 || !m.TransfersIncluded || len(m.ID) != 32 || m.CreatedAt.IsZero() || len(m.Files) == 0 || len(m.Files) > MaxFiles {
		return m, errors.New("unsupported or incomplete backup manifest")
	}
	if _, err := hex.DecodeString(m.ID); err != nil {
		return m, errors.New("invalid backup ID")
	}
	return m, nil
}

func Verify(input string) (Report, error) {
	r, _, _, err := verified(input)
	return r, err
}

func verified(input string) (Report, Manifest, string, error) {
	root, err := absoluteNoLinks(input)
	if err != nil {
		return Report{}, Manifest{}, "", err
	}
	m, err := readManifest(root)
	if err != nil {
		return Report{}, m, root, err
	}
	// No unlisted files, links or private configuration may be smuggled into a
	// verified package. Empty directories are harmless but still checked by walk.
	names, err := walk(root)
	if err != nil {
		return Report{}, m, root, err
	}
	expected := map[string]bool{"manifest.json": true}
	for _, e := range m.Files {
		expected[e.Path] = true
	}
	for _, name := range names {
		if !expected[name] {
			return Report{}, m, root, errors.New("backup contains an unlisted file")
		}
	}
	if len(names) != len(expected) {
		return Report{}, m, root, errors.New("backup file is missing")
	}
	r, err := inspectContent(root, m)
	return r, m, root, err
}

func inspectContent(root string, m Manifest) (Report, error) {
	r := Report{Operation: "verify", BackupID: m.ID, CheckedAt: time.Now().UTC(), Files: len(m.Files), RollingBackup: "absent", Warnings: []string{}}
	seen := map[string]bool{}
	entries := map[string]Entry{}
	for _, e := range m.Files {
		key := strings.ToLower(e.Path)
		if !payloadPath(e.Path) || seen[key] || e.Size < 0 || e.Size > fileLimit(e.Path) || !digestPattern.MatchString(e.SHA256) {
			return r, errors.New("unsafe, duplicate or oversized manifest entry")
		}
		seen[key] = true
		r.Bytes += e.Size
		if r.Bytes > MaxTotalBytes {
			return r, errors.New("backup exceeds the total size limit")
		}
		actual, err := fileDigest(filepath.Join(root, filepath.FromSlash(e.Path)), fileLimit(e.Path), "")
		if err != nil {
			return r, err
		}
		if actual.Size != e.Size || actual.SHA256 != e.SHA256 {
			return r, errors.New("backup content hash/size mismatch")
		}
		entries[e.Path] = e
	}
	if !seen[primary] {
		return r, errors.New("primary snapshot is missing from manifest")
	}
	var err error
	r.Snapshot, err = inspectSnapshot(filepath.Join(root, filepath.FromSlash(primary)))
	if err != nil {
		return r, err
	}
	if seen[primary+".bak"] {
		r.RollingBackup = "valid"
		if _, err := inspectSnapshot(filepath.Join(root, filepath.FromSlash(primary+".bak"))); err != nil {
			r.RollingBackup = "invalid_preserved"
			r.Warnings = append(r.Warnings, "rolling_backup_invalid_preserved")
		}
	}
	r.Transfers, err = inspectTransfers(root, r.Snapshot.UserIDs, entries)
	if err != nil {
		return r, err
	}
	if !m.TransfersPresentAtSource && (r.Transfers.Files > 0 || r.Transfers.OrphanFiles > 0) {
		return r, errors.New("transfer scope disagrees with manifest")
	}
	if r.Snapshot.MissingReferences > 0 {
		r.Warnings = append(r.Warnings, "historical_references_need_review")
	}
	if r.Transfers.OrphanFiles > 0 {
		r.Warnings = append(r.Warnings, "unreferenced_transfer_files_preserved")
	}
	if !m.TransfersPresentAtSource {
		r.Warnings = append(r.Warnings, "source_transfer_directory_was_absent")
	}
	r.ContentVerified = true
	return r, nil
}

// Restore verifies before copying and independently reads back every new file.
// It never chooses a production DATA_FILE or starts a service.
func Restore(input, output string, apply bool) (Report, error) {
	r, m, root, err := verified(input)
	if err != nil {
		return r, err
	}
	r.Operation = "restore_preview"
	target, err := absoluteNoLinks(output)
	if err != nil {
		return r, err
	}
	if nested(root, target) || nested(target, root) {
		return r, errors.New("backup and restore directories must be separate")
	}
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		return r, errors.New("restore destination must not exist")
	}
	if info, err := os.Stat(filepath.Dir(target)); err != nil || !info.IsDir() {
		return r, errors.New("restore destination parent must already exist")
	}
	if !apply {
		return r, nil
	}
	target, err = newDirectory(target, root)
	if err != nil {
		return r, err
	}
	if err := os.Mkdir(filepath.Join(target, "transfers"), 0o700); err != nil {
		return r, err
	}
	for _, e := range m.Files {
		if !payloadPath(e.Path) {
			return r, errors.New("manifest changed during restore")
		}
		dest := ""
		switch e.Path {
		case primary:
			dest = "studyflow.json"
		case primary + ".bak":
			dest = "studyflow.json.bak"
		default:
			dest = strings.TrimPrefix(e.Path, "payload/")
		}
		actual, err := fileDigest(filepath.Join(root, filepath.FromSlash(e.Path)), fileLimit(e.Path), filepath.Join(target, filepath.FromSlash(dest)))
		if err != nil {
			return r, err
		}
		if actual.SHA256 != e.SHA256 || actual.Size != e.Size {
			return r, errors.New("source changed during restore; incomplete destination retained")
		}
		// Independently read back the restored bytes before removing the marker.
		readBack, err := fileDigest(filepath.Join(target, filepath.FromSlash(dest)), fileLimit(e.Path), "")
		if err != nil || readBack.SHA256 != e.SHA256 || readBack.Size != e.Size {
			return r, errors.New("restored file failed read-back verification")
		}
	}
	if _, err := inspectSnapshot(filepath.Join(target, "studyflow.json")); err != nil {
		return r, err
	}
	// Include immutable provenance without any source paths or credentials.
	r.Operation = "restore"
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return r, err
	}
	if err := exclusiveWrite(filepath.Join(target, "restore-report.json"), append(data, '\n')); err != nil {
		return r, err
	}
	if err := os.Remove(filepath.Join(target, Incomplete)); err != nil {
		return r, err
	}
	return r, nil
}
