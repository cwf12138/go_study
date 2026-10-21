// Package transfers stores opaque attachment files separately from JSON snapshots.
// A Store is single-process: short metadata locks, four bounded streaming uploads,
// reserved quota, immutable upload IDs, and account-derived private directories.
package transfers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const MaxFileBytes int64 = 32 << 20
const MaxAccountBytes int64 = 256 << 20
const MaxFiles = 100

var (
	ErrInvalid  = errors.New("invalid transfer input")
	ErrNotFound = errors.New("file not found")
	ErrConflict = errors.New("file already exists with different content")
	ErrQuota    = errors.New("storage quota exceeded")
	ErrBusy     = errors.New("upload slots busy")
	ErrExpired  = errors.New("file expired or unavailable")
	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)
	hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

type Record struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Name      string     `json:"name"`
	Size      int64      `json:"size"`
	SHA256    string     `json:"sha256"`
	TTLHours  int        `json:"ttl_hours"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}
type File struct {
	Record
	Expired bool `json:"expired"`
	Missing bool `json:"missing"`
}
type Listing struct {
	Items        []File    `json:"items"`
	UsedBytes    int64     `json:"used_bytes"`
	MaxBytes     int64     `json:"max_bytes"`
	MaxFileBytes int64     `json:"max_file_bytes"`
	MaxFiles     int       `json:"max_files"`
	ServerTime   time.Time `json:"server_time"`
}
type Store struct {
	root         string
	mu           sync.Mutex
	slots        chan struct{}
	pending      map[string]bool
	reserved     map[string]int64
	pendingCount map[string]int
	now          func() time.Time
}

func New(root string) *Store {
	return &Store{root: root, slots: make(chan struct{}, 4), pending: map[string]bool{}, reserved: map[string]int64{}, pendingCount: map[string]int{}, now: time.Now}
}
func ValidName(name string) bool {
	if strings.TrimSpace(name) == "" || name == "." || name == ".." || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 180 || strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func validTTL(ttl int) bool { return ttl == 0 || ttl == 24 || ttl == 168 }
func (s *Store) dir(user string) (string, error) {
	if user == "" {
		return "", ErrInvalid
	}
	sum := sha256.Sum256([]byte(user))
	dir := filepath.Join(s.root, hex.EncodeToString(sum[:]))
	if info, e := os.Lstat(dir); e == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("unsafe attachment directory")
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return "", e
	}
	return dir, nil
}
func (s *Store) paths(user, id string) (string, string, error) {
	if !idPattern.MatchString(id) {
		return "", "", ErrInvalid
	}
	dir, e := s.dir(user)
	if e != nil {
		return "", "", e
	}
	return filepath.Join(dir, id+".json"), filepath.Join(dir, id+".blob"), nil
}
func regular(path string) error {
	info, e := os.Lstat(path)
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular attachment file")
	}
	return nil
}
func (s *Store) read(user, id string) (Record, error) {
	var row Record
	meta, _, e := s.paths(user, id)
	if e != nil {
		return row, e
	}
	if e = regular(meta); e != nil {
		if errors.Is(e, os.ErrNotExist) {
			return row, ErrNotFound
		}
		return row, e
	}
	f, e := os.Open(meta)
	if e != nil {
		return row, e
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, 8192))
	d.DisallowUnknownFields()
	if e = d.Decode(&row); e != nil {
		return row, e
	}
	if e = d.Decode(&struct{}{}); !errors.Is(e, io.EOF) {
		return Record{}, fmt.Errorf("invalid attachment metadata trailing content")
	}
	if row.ID != id || row.UserID != user || !ValidName(row.Name) || row.Size < 0 || row.Size > MaxFileBytes || !hashPattern.MatchString(row.SHA256) || !validTTL(row.TTLHours) || row.CreatedAt.IsZero() {
		return Record{}, fmt.Errorf("invalid attachment metadata")
	}
	return row, nil
}
func (s *Store) records(user string) ([]Record, error) {
	dir, e := s.dir(user)
	if e != nil {
		return nil, e
	}
	entries, e := os.ReadDir(dir)
	if errors.Is(e, os.ErrNotExist) {
		return []Record{}, nil
	}
	if e != nil {
		return nil, e
	}
	rows := []Record{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			id := strings.TrimSuffix(entry.Name(), ".json")
			if !idPattern.MatchString(id) {
				return nil, fmt.Errorf("invalid attachment metadata filename")
			}
			row, e := s.read(user, id)
			if e != nil {
				return nil, e
			}
			rows = append(rows, row)
		}
	}
	return rows, nil
}
func (s *Store) view(row Record) File {
	_, blob, e := s.paths(row.UserID, row.ID)
	missing := e != nil
	if !missing {
		info, err := os.Lstat(blob)
		missing = err != nil || !info.Mode().IsRegular() || info.Size() != row.Size
	}
	return File{Record: row, Expired: row.ExpiresAt != nil && !s.now().Before(*row.ExpiresAt), Missing: missing}
}
func (s *Store) List(ctx context.Context, user string) (Listing, error) {
	if e := ctx.Err(); e != nil {
		return Listing{}, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, e := s.records(user)
	if e != nil {
		return Listing{}, e
	}
	out := Listing{Items: []File{}, MaxBytes: MaxAccountBytes, MaxFileBytes: MaxFileBytes, MaxFiles: MaxFiles, ServerTime: s.now().UTC()}
	for _, row := range rows {
		out.Items = append(out.Items, s.view(row))
		out.UsedBytes += row.Size
	}
	sort.Slice(out.Items, func(i, j int) bool {
		if out.Items[i].CreatedAt.Equal(out.Items[j].CreatedAt) {
			return out.Items[i].ID < out.Items[j].ID
		}
		return out.Items[i].CreatedAt.After(out.Items[j].CreatedAt)
	})
	return out, nil
}
func (s *Store) write(row Record) error {
	meta, _, e := s.paths(row.UserID, row.ID)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(meta), ".meta-")
	if e != nil {
		return e
	}
	temp := f.Name()
	defer os.Remove(temp)
	if e = json.NewEncoder(f).Encode(row); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temp, meta)
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.reader.Read(b)
}
func (s *Store) Upload(ctx context.Context, user, id, name string, ttl int, body io.Reader, expected int64) (File, error) {
	if !idPattern.MatchString(id) || !ValidName(name) || !validTTL(ttl) || expected < -1 {
		return File{}, ErrInvalid
	}
	if expected > MaxFileBytes {
		return File{}, ErrQuota
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return File{}, ErrBusy
	}
	meta, blob, e := s.paths(user, id)
	if e != nil {
		return File{}, e
	}
	key := user + ":" + id
	s.mu.Lock()
	old, existsErr := s.read(user, id)
	if existsErr != nil && !errors.Is(existsErr, ErrNotFound) {
		s.mu.Unlock()
		return File{}, existsErr
	}
	exists := existsErr == nil
	if s.pending[key] {
		s.mu.Unlock()
		return File{}, ErrBusy
	}
	var reservation int64
	if !exists {
		rows, e := s.records(user)
		if e != nil {
			s.mu.Unlock()
			return File{}, e
		}
		var used int64
		for _, r := range rows {
			used += r.Size
		}
		reservation = expected
		if reservation < 0 {
			reservation = MaxFileBytes
		}
		if len(rows)+s.pendingCount[user] >= MaxFiles || used+s.reserved[user]+reservation > MaxAccountBytes {
			s.mu.Unlock()
			return File{}, ErrQuota
		}
		s.reserved[user] += reservation
		s.pendingCount[user]++
	}
	s.pending[key] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, key)
		s.reserved[user] -= reservation
		if !exists {
			s.pendingCount[user]--
		}
		s.mu.Unlock()
	}()
	if e = os.MkdirAll(filepath.Dir(meta), 0700); e != nil {
		return File{}, e
	}
	if _, e = s.dir(user); e != nil {
		return File{}, e
	}
	f, e := os.CreateTemp(filepath.Dir(meta), ".upload-")
	if e != nil {
		return File{}, e
	}
	temp := f.Name()
	defer os.Remove(temp)
	defer f.Close()
	hash := sha256.New()
	size, e := io.Copy(io.MultiWriter(f, hash), io.LimitReader(contextReader{ctx, body}, MaxFileBytes+1))
	if e != nil {
		return File{}, e
	}
	if e = ctx.Err(); e != nil {
		return File{}, e
	}
	if size > MaxFileBytes {
		return File{}, ErrQuota
	}
	if expected >= 0 && size != expected {
		return File{}, ErrInvalid
	}
	if e = f.Sync(); e != nil {
		return File{}, e
	}
	if e = f.Close(); e != nil {
		return File{}, e
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	s.mu.Lock()
	defer s.mu.Unlock()
	if exists {
		current, e := s.read(user, id)
		if e != nil {
			return File{}, e
		}
		if current.DeletedAt != nil || old.SHA256 != digest || old.Size != size || old.Name != name || old.TTLHours != ttl {
			return File{}, ErrConflict
		}
		view := s.view(current)
		if view.Missing {
			return File{}, ErrConflict
		}
		if view.Expired {
			return File{}, ErrExpired
		}
		return view, nil
	}
	// Fail closed if a previous crashed operation left a blob with the same ID.
	if _, e = os.Lstat(blob); e == nil {
		return File{}, ErrConflict
	} else if !errors.Is(e, os.ErrNotExist) {
		return File{}, e
	}
	now := s.now().UTC()
	row := Record{ID: id, UserID: user, Name: name, Size: size, SHA256: digest, TTLHours: ttl, CreatedAt: now}
	if ttl != 0 {
		expiry := now.Add(time.Duration(ttl) * time.Hour)
		row.ExpiresAt = &expiry
	}
	if e = os.Rename(temp, blob); e != nil {
		return File{}, e
	}
	if e = s.write(row); e != nil {
		_ = os.Remove(blob)
		return File{}, e
	}
	return s.view(row), nil
}
func (s *Store) Open(ctx context.Context, user, id string) (*os.File, Record, error) {
	if e := ctx.Err(); e != nil {
		return nil, Record{}, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	row, e := s.read(user, id)
	if e != nil {
		return nil, row, e
	}
	v := s.view(row)
	if row.DeletedAt != nil || v.Expired {
		return nil, row, ErrExpired
	}
	if v.Missing {
		return nil, row, ErrNotFound
	}
	_, blob, _ := s.paths(user, id)
	if e = regular(blob); e != nil {
		return nil, row, e
	}
	f, e := os.Open(blob)
	return f, row, e
}
func (s *Store) Action(ctx context.Context, user, id, action string) (File, error) {
	if e := ctx.Err(); e != nil {
		return File{}, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending[user+":"+id] {
		return File{}, ErrBusy
	}
	row, e := s.read(user, id)
	if e != nil {
		return File{}, e
	}
	now := s.now().UTC()
	switch action {
	case "trash":
		if row.DeletedAt == nil {
			row.DeletedAt = &now
		}
	case "restore":
		row.DeletedAt = nil
	case "extend":
		if row.DeletedAt != nil {
			return File{}, ErrInvalid
		}
		expiry := now.Add(7 * 24 * time.Hour)
		row.ExpiresAt = &expiry
		row.TTLHours = 168
	default:
		return File{}, ErrInvalid
	}
	if e = s.write(row); e != nil {
		return File{}, e
	}
	return s.view(row), nil
}
func (s *Store) Purge(ctx context.Context, user, id string) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending[user+":"+id] {
		return ErrBusy
	}
	row, e := s.read(user, id)
	if e != nil {
		return e
	}
	if row.DeletedAt == nil && !(row.ExpiresAt != nil && !s.now().Before(*row.ExpiresAt)) {
		return ErrInvalid
	}
	meta, blob, e := s.paths(user, id)
	if e != nil {
		return e
	}
	if e = regular(blob); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if e = os.Remove(blob); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	return os.Remove(meta)
}
