package lab

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/example/studyflow/internal/domain"
)

type persistedUser struct {
	domain.User
	Hash string `json:"password_hash"`
}

// These methods match a small, explicit subset of today's repository contract.
// ByID is an internal repository lookup; services must still enforce ownership.
func (l *Lab) CreateUser(ctx context.Context, user domain.User) error {
	if user.ID == "" || user.Email == "" {
		return domain.ErrInvalidInput
	}
	data, err := json.Marshal(persistedUser{User: user, Hash: user.PasswordHash})
	if err != nil {
		return err
	}
	_, err = l.db.ExecContext(ctx, "INSERT INTO users(id,email,payload_json) VALUES(?,?,?)", user.ID, strings.ToLower(user.Email), string(data))
	return dbError(err)
}
func (l *Lab) UserByID(ctx context.Context, id string) (domain.User, error) {
	return l.user(ctx, "SELECT payload_json FROM users WHERE id=?", id)
}
func (l *Lab) UserByEmail(ctx context.Context, email string) (domain.User, error) {
	return l.user(ctx, "SELECT payload_json FROM users WHERE email=?", strings.ToLower(email))
}
func (l *Lab) user(ctx context.Context, query string, arg any) (domain.User, error) {
	var data string
	if err := l.db.QueryRowContext(ctx, query, arg).Scan(&data); err != nil {
		return domain.User{}, dbError(err)
	}
	var row persistedUser
	if err := json.Unmarshal([]byte(data), &row); err != nil {
		return domain.User{}, err
	}
	row.User.PasswordHash = row.Hash
	return row.User, nil
}

func (l *Lab) CreateMemoFolder(ctx context.Context, n domain.MemoFolder) error {
	if n.ID == "" || n.UserID == "" {
		return domain.ErrInvalidInput
	}
	data, err := json.Marshal(n)
	if err != nil {
		return err
	}
	_, err = l.db.ExecContext(ctx, "INSERT INTO memo_folders(id,user_id,payload_json) VALUES(?,?,?)", n.ID, n.UserID, string(data))
	return dbError(err)
}
func (l *Lab) CreateMemoNote(ctx context.Context, n domain.MemoNote) error {
	if n.ID == "" || n.UserID == "" {
		return domain.ErrInvalidInput
	}
	data, err := json.Marshal(n)
	if err != nil {
		return err
	}
	return insertMemo(ctx, l.db, n, data)
}
func (l *Lab) MemoNoteByID(ctx context.Context, id string) (domain.MemoNote, error) {
	var data string
	if err := l.db.QueryRowContext(ctx, "SELECT payload_json FROM memos WHERE id=?", id).Scan(&data); err != nil {
		return domain.MemoNote{}, dbError(err)
	}
	var n domain.MemoNote
	err := json.Unmarshal([]byte(data), &n)
	return n, err
}
func (l *Lab) ListMemoNotes(ctx context.Context, user string) ([]domain.MemoNote, error) {
	rows, err := l.db.QueryContext(ctx, "SELECT payload_json FROM memos WHERE user_id=? ORDER BY pinned DESC,updated_seconds DESC,updated_nanos DESC,id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MemoNote{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		var n domain.MemoNote
		if err := json.Unmarshal([]byte(data), &n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

type VersionedMemo struct {
	Note     domain.MemoNote `json:"note"`
	Revision int64           `json:"revision"`
}

func (l *Lab) MemoFor(ctx context.Context, owner, id string) (VersionedMemo, error) {
	var data string
	var out VersionedMemo
	err := l.db.QueryRowContext(ctx, "SELECT payload_json,revision FROM memos WHERE user_id=? AND id=?", owner, id).Scan(&data, &out.Revision)
	if err != nil {
		return out, dbError(err)
	}
	err = json.Unmarshal([]byte(data), &out.Note)
	return out, err
}

// EditMemo is prototype-only optimistic concurrency; the web API is not wired to
// it. It updates the selected typed record while retaining unknown JSON fields.
func (l *Lab) EditMemo(ctx context.Context, actor string, n domain.MemoNote, expected int64) (int64, error) {
	if actor == "" || n.UserID != actor || n.ID == "" || expected < 1 {
		return 0, domain.ErrInvalidInput
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var old string
	var revision int64
	if err := tx.QueryRowContext(ctx, "SELECT payload_json,revision FROM memos WHERE user_id=? AND id=?", actor, n.ID).Scan(&old, &revision); err != nil {
		return 0, dbError(err)
	}
	if revision != expected {
		return 0, domain.ErrConflict
	}
	var original map[string]json.RawMessage
	if err := json.Unmarshal([]byte(old), &original); err != nil {
		return 0, err
	}
	data, err := json.Marshal(n)
	if err != nil {
		return 0, err
	}
	var known map[string]json.RawMessage
	json.Unmarshal(data, &known)
	for _, key := range []string{"folder_id", "deleted_at"} {
		delete(original, key)
	}
	for key, value := range known {
		original[key] = value
	}
	data, err = json.Marshal(original)
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE memos SET folder_id=?,title=?,updated_seconds=?,updated_nanos=?,pinned=?,deleted=?,revision=revision+1,payload_json=? WHERE user_id=? AND id=? AND revision=?", nullID(n.FolderID), n.Title, n.UpdatedAt.Unix(), n.UpdatedAt.Nanosecond(), n.Pinned, n.DeletedAt != nil, string(data), actor, n.ID, expected)
	if err != nil {
		return 0, dbError(err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if changed != 1 {
		return 0, domain.ErrConflict
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return expected + 1, nil
}

type PairResult struct {
	MemoID   string `json:"memo_id"`
	TodoID   string `json:"todo_id"`
	Replayed bool   `json:"replayed"`
}

// CreateMemoAndTodo commits note + todo + ownership-safe link + idempotency
// receipt together. No external events/files are claimed to share this SQL tx.
func (l *Lab) CreateMemoAndTodo(ctx context.Context, actor, key string, n domain.MemoNote, t domain.TodoItem) (PairResult, error) {
	if actor == "" || n.UserID != actor || t.UserID != actor || n.ID == "" || t.ID == "" || len(key) < 8 || len(key) > 80 {
		return PairResult{}, domain.ErrInvalidInput
	}
	request, err := json.Marshal(struct {
		Note domain.MemoNote
		Todo domain.TodoItem
	}{n, t})
	if err != nil {
		return PairResult{}, err
	}
	digest := sha256.Sum256(request)
	hash := hex.EncodeToString(digest[:])
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return PairResult{}, err
	}
	defer tx.Rollback()
	var oldHash string
	out := PairResult{}
	err = tx.QueryRowContext(ctx, "SELECT payload_sha256,memo_id,todo_id FROM commands WHERE user_id=? AND command_id=?", actor, key).Scan(&oldHash, &out.MemoID, &out.TodoID)
	if err == nil {
		if oldHash != hash {
			return PairResult{}, domain.ErrConflict
		}
		out.Replayed = true
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PairResult{}, err
	}
	data, err := json.Marshal(n)
	if err != nil {
		return PairResult{}, err
	}
	if err := insertMemo(ctx, tx, n, data); err != nil {
		return PairResult{}, err
	}
	data, err = json.Marshal(t)
	if err != nil {
		return PairResult{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO todos(id,user_id,list_id,payload_json) VALUES(?,?,?,?)", t.ID, actor, t.ListID, string(data)); err != nil {
		return PairResult{}, dbError(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO memo_todo_links(user_id,memo_id,todo_id) VALUES(?,?,?)", actor, n.ID, t.ID); err != nil {
		return PairResult{}, dbError(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO commands(user_id,command_id,payload_sha256,memo_id,todo_id) VALUES(?,?,?,?,?)", actor, key, hash, n.ID, t.ID); err != nil {
		return PairResult{}, dbError(err)
	}
	if err := tx.Commit(); err != nil {
		return PairResult{}, err
	}
	return PairResult{MemoID: n.ID, TodoID: t.ID}, nil
}
