package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestAccountUsageScopedAndReadOnly(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	for _, id := range []string{"alice", "bob"} {
		if err := m.CreateUser(ctx, domain.User{ID: id, Email: id + "@example.test", PasswordHash: "PRIVATE_PASSWORD_HASH"}); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	m.CreateMemoFolder(ctx, domain.MemoFolder{ID: "folder", UserID: "alice", Name: "PRIVATE_FOLDER"})
	m.CreateMemoNote(ctx, domain.MemoNote{ID: "note", UserID: "alice", FolderID: "folder", Content: "PRIVATE_BODY", DeletedAt: &now})
	m.CreateMemoNote(ctx, domain.MemoNote{ID: "bob-note", UserID: "bob", Content: "BOB_BODY"})
	m.SaveTextClip(ctx, domain.TextClip{ID: "same-clip", UserID: "alice", Text: "EXPIRED_PRIVATE", ExpiresAt: now.Add(-time.Hour), Deleted: true}, 0, false)
	before := m.SnapshotStatus()
	out, err := m.AccountUsage(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if out.Objects != 3 {
		t.Fatal("must include folders, trash and expired rows", out.Objects)
	}
	counts := map[string]int{}
	for _, c := range out.Collections {
		counts[c.Key] = c.Count
	}
	if counts["memos"] != 1 || counts["memo_folders"] != 1 || counts["text_clips"] != 1 || counts["planner_preferences"] != 0 {
		t.Fatal("wrong scope or defaults were initialized")
	}
	b, _ := json.Marshal(out)
	for _, s := range []string{"alice", "bob", "PRIVATE_", "BOB_BODY", "PASSWORD"} {
		if strings.Contains(string(b), s) {
			t.Fatal("usage leaked record/account content")
		}
	}
	if !reflect.DeepEqual(before, m.SnapshotStatus()) {
		t.Fatal("usage modified persistence status")
	}
	if _, err := m.AccountUsage(ctx, "unknown"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := m.AccountUsage(cancelled, "alice"); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation ignored", err)
	}
}

func TestUsageRegistryCoversEveryAccountCollection(t *testing.T) {
	m := NewMemory()
	registered := map[reflect.Type]int{}
	keys := map[string]bool{}
	for _, source := range m.usageSources() {
		typ := reflect.TypeOf(source.rows)
		registered[typ]++
		if keys[source.key] {
			t.Fatal("duplicate collection key")
		}
		keys[source.key] = true
		if f, ok := typ.Elem().FieldByName("UserID"); !ok || f.Type.Kind() != reflect.String {
			t.Fatal("unsupported owner type", source.key)
		}
	}
	typ := reflect.TypeOf(m).Elem()
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if f.Type.Kind() != reflect.Map || f.Type.Elem().Kind() != reflect.Struct {
			continue
		}
		if _, ok := f.Type.Elem().FieldByName("UserID"); ok && registered[f.Type] != 1 {
			t.Fatalf("account collection %s must be registered once", f.Name)
		}
	}
}
