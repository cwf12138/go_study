package lab

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const dbName = "daynest.sqlite"
const markerName = "daynest-sqlite-lab.json"
const incompleteName = ".sqlite-lab-incomplete"

func cleanPath(name string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", errors.New("explicit directory is required")
	}
	abs, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	for p := abs; ; p = filepath.Dir(p) {
		info, err := os.Lstat(p)
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("links/junctions are not supported")
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return abs, nil
}

func overlaps(a, b string) bool {
	a, b = strings.ToLower(filepath.Clean(a)), strings.ToLower(filepath.Clean(b))
	for _, pair := range [][2]string{{a, b}, {b, a}} {
		r, e := filepath.Rel(pair[0], pair[1])
		if e == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r) {
			return true
		}
	}
	return false
}

func newDir(name, away string) (string, error) {
	abs, err := cleanPath(name)
	if err != nil {
		return "", err
	}
	if away != "" && overlaps(abs, away) {
		return "", errors.New("source and output must be separate directories")
	}
	if _, err := os.Lstat(abs); !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("output must be a new directory; no overwrite is supported")
	}
	if info, err := os.Stat(filepath.Dir(abs)); err != nil || !info.IsDir() {
		return "", errors.New("output parent directory must exist")
	}
	if err := os.Mkdir(abs, 0o700); err != nil {
		return "", err
	}
	if err := writeNew(filepath.Join(abs, incompleteName), []byte("Incomplete SQLite lab. Do not use or remove this marker to bypass validation.\n")); err != nil {
		return "", err
	}
	return abs, nil
}

func writeNew(name string, data []byte) error {
	f, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	return errors.Join(err, f.Close())
}

func smallFile(name string, max int64) ([]byte, error) {
	info, err := os.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > max {
		return nil, errors.New("unsafe or oversized lab file")
	}
	return os.ReadFile(name)
}
