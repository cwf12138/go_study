package lab

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

// Backup uses SQLite's consistent VACUUM INTO copy while the source can remain
// open. It never copies only a live .sqlite file or deletes WAL/SHM sidecars.
func (l *Lab) Backup(ctx context.Context, output string) (Inspection, error) {
	dir, err := newDir(output, l.directory)
	if err != nil {
		return Inspection{}, err
	}
	if _, err := l.db.ExecContext(ctx, "VACUUM main INTO ?", filepath.Join(dir, dbName)); err != nil {
		return Inspection{}, err
	}
	f, err := os.OpenFile(filepath.Join(dir, dbName), os.O_RDWR, 0)
	if err != nil {
		return Inspection{}, err
	}
	err = f.Sync()
	closeErr := f.Close()
	if err != nil {
		return Inspection{}, err
	}
	if closeErr != nil {
		return Inspection{}, closeErr
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Inspection{}, err
	}
	m := Marker{Format: "daynest.sqlite-lab", Version: 1, ID: hex.EncodeToString(id[:])}
	data, err := json.Marshal(m)
	if err != nil {
		return Inspection{}, err
	}
	if err := writeNew(filepath.Join(dir, markerName), data); err != nil {
		return Inspection{}, err
	}
	db, err := connect(ctx, dir, true)
	if err != nil {
		return Inspection{}, err
	}
	copy := &Lab{db: db, directory: dir, marker: m}
	report, inspectErr := copy.Inspect(ctx)
	closeErr = copy.Close()
	if inspectErr != nil {
		return report, inspectErr
	}
	if closeErr != nil {
		return report, closeErr
	}
	if err := os.Remove(filepath.Join(dir, incompleteName)); err != nil {
		return report, err
	}
	return report, nil
}
