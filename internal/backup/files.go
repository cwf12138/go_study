package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	MaxFiles               = 100000
	MaxTotalBytes    int64 = 20 << 30
	MaxSnapshotBytes int64 = 256 << 20
	maxManifestBytes int64 = 64 << 20
	Incomplete             = ".daynest-incomplete"
)

var component = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var devicePattern = regexp.MustCompile(`^(COM|LPT)[0-9]$`)

func safeRelative(name string) bool {
	if name == "" || len(name) > 300 || strings.Contains(name, "\\") || strings.HasPrefix(name, "/") {
		return false
	}
	parts := strings.Split(name, "/")
	if len(parts) > 5 {
		return false
	}
	for _, p := range parts {
		if !component.MatchString(p) || p == "." || p == ".." || strings.HasSuffix(p, ".") {
			return false
		}
		stem := strings.ToUpper(strings.SplitN(p, ".", 2)[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || devicePattern.MatchString(stem) {
			return false
		}
	}
	return true
}

// Refuse all symlink/junction components before walking or writing. Maintenance
// expects a private, quiescent local directory, not an attacker-writable tree.
func absoluteNoLinks(name string) (string, error) {
	abs, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	for p := abs; ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symbolic links/junctions are not supported")
		}
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return "", e
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return abs, nil
}

func nested(a, b string) bool {
	// Case folding also prevents accidental aliases on case-insensitive disks.
	a, b = strings.ToLower(filepath.Clean(a)), strings.ToLower(filepath.Clean(b))
	r, err := filepath.Rel(a, b)
	return err == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r)
}

func newDirectory(name, awayFrom string) (string, error) {
	abs, err := absoluteNoLinks(name)
	if err != nil {
		return "", err
	}
	if awayFrom != "" && (nested(awayFrom, abs) || nested(abs, awayFrom)) {
		return "", errors.New("source and destination directories must be separate")
	}
	if _, err := os.Lstat(abs); !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("destination must be a new directory; existing directories are never overwritten")
	}
	if info, err := os.Stat(filepath.Dir(abs)); err != nil || !info.IsDir() {
		return "", errors.New("destination parent directory must already exist")
	}
	if err := os.Mkdir(abs, 0o700); err != nil {
		return "", err
	}
	if err := exclusiveWrite(filepath.Join(abs, Incomplete), []byte("Incomplete operation. Do not start the API in this directory.\n")); err != nil {
		return "", err
	}
	return abs, nil
}

func exclusiveWrite(name string, data []byte) error {
	f, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	if writeErr == nil {
		writeErr = f.Sync()
	}
	return errors.Join(writeErr, f.Close())
}

func regularOpen(name string, max int64) (*os.File, fs.FileInfo, error) {
	before, err := os.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() || before.Size() > max {
		return nil, nil, errors.New("not a regular file or file exceeds the size limit")
	}
	f, err := os.Open(name)
	if err != nil {
		return nil, nil, err
	}
	after, err := f.Stat()
	if err != nil || !os.SameFile(before, after) {
		f.Close()
		return nil, nil, errors.New("file changed while opening")
	}
	return f, before, nil
}

func readSmall(name string, max int64) ([]byte, error) {
	f, _, err := regularOpen(name, max)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if int64(len(data)) > max {
		return nil, errors.New("file exceeds the size limit")
	}
	return data, err
}

func fileDigest(name string, max int64, destination string) (Entry, error) {
	f, before, err := regularOpen(name, max)
	if err != nil {
		return Entry{}, err
	}
	defer f.Close()
	hash := sha256.New()
	var writer io.Writer = hash
	var out *os.File
	if destination != "" {
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return Entry{}, err
		}
		out, err = os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return Entry{}, err
		}
		defer out.Close()
		writer = io.MultiWriter(hash, out)
	}
	n, err := io.Copy(writer, io.LimitReader(f, max+1))
	if err != nil {
		return Entry{}, err
	}
	after, err := f.Stat()
	if err != nil || n != before.Size() || n > max || !before.ModTime().Equal(after.ModTime()) || after.Size() != n {
		return Entry{}, errors.New("file changed while reading/copying")
	}
	if out != nil {
		if err := out.Sync(); err != nil {
			return Entry{}, err
		}
		if err := out.Close(); err != nil {
			return Entry{}, err
		}
	}
	return Entry{Size: n, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func walk(root string) ([]string, error) {
	names := []string{}
	seen := map[string]bool{}
	count := 0
	err := filepath.WalkDir(root, func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == root {
			if !d.IsDir() {
				return errors.New("expected a directory")
			}
			return nil
		}
		count++
		if count > MaxFiles*2+10 {
			return errors.New("too many directory entries")
		}
		rel, err := filepath.Rel(root, name)
		rel = filepath.ToSlash(rel)
		key := strings.ToLower(rel)
		if err != nil || !safeRelative(rel) || seen[key] {
			return errors.New("unsafe or case-ambiguous backup path")
		}
		seen[key] = true
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.Mode().IsRegular() && !info.IsDir()) {
			return errors.New("links and special files are not supported")
		}
		if !d.IsDir() {
			names = append(names, rel)
			// A complete package has one manifest in addition to payload files.
			// Source/payload limits are checked separately before publication.
			if len(names) > MaxFiles+1 {
				return errors.New("too many files")
			}
		}
		return nil
	})
	return names, err
}

// A hash cannot disambiguate duplicate JSON keys. Reject them before interpreting
// manifests, snapshots or transfer metadata, along with excessive nesting.
func checkJSON(data []byte) error {
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.UseNumber()
	var value func(int) error
	value = func(depth int) error {
		if depth > 128 {
			return errors.New("JSON nesting limit exceeded")
		}
		t, err := d.Token()
		if err != nil {
			return err
		}
		switch t {
		case json.Delim('{'):
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				s, ok := key.(string)
				if !ok || seen[s] {
					return errors.New("duplicate JSON key")
				}
				seen[s] = true
				if err := value(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
		case json.Delim('['):
			for d.More() {
				if err := value(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
		}
		return err
	}
	if err := value(0); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if _, err := d.Token(); !errors.Is(err, io.EOF) {
		return errors.New("JSON has trailing content")
	}
	return nil
}
