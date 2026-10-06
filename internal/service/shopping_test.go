package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"sync"
	"testing"
)

func TestShoppingLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := SaveShoppingInput{Name: " 牛奶 ", Quantity: "2盒", Frequent: true}
	first, err := s.SaveShopping(ctx, "alice", "item-00001", in)
	if err != nil || first.Name != "牛奶" || first.Revision != 1 {
		t.Fatal(first, err)
	}
	retry, err := s.SaveShopping(ctx, "alice", first.ID, in)
	if err != nil || retry != first {
		t.Fatal("retry", retry, err)
	}
	if _, err = s.SaveShopping(ctx, "alice", "item-00002", in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate", err)
	}
	if _, err = s.SaveShopping(ctx, "bob", first.ID, in); err != nil {
		t.Fatal("owner isolation", err)
	}
	rows, _ := s.ListShopping(ctx, "charlie")
	if len(rows) != 0 {
		t.Fatal("account leak")
	}
	in.Revision = 1
	in.Purchased = true
	done, err := s.SaveShopping(ctx, "alice", first.ID, in)
	if err != nil || !done.Purchased {
		t.Fatal(done, err)
	}
	in.Revision = 2
	in.Purchased = false
	again, err := s.SaveShopping(ctx, "alice", first.ID, in)
	if err != nil || again.Purchased || !again.CreatedAt.Equal(first.CreatedAt) {
		t.Fatal(again, err)
	}
	in.Revision = 3
	in.Deleted = true
	removed, err := s.SaveShopping(ctx, "alice", first.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shopping.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	rows, _ = loaded.ListShopping(ctx, "alice")
	if len(rows) != 1 || rows[0] != removed {
		t.Fatal(rows)
	}
	in.Revision = 4
	in.Deleted = false
	if _, err = New(loaded, nil, nil).SaveShopping(ctx, "alice", first.ID, in); err != nil {
		t.Fatal("undo delete", err)
	}
	in.Revision = 1
	in.Note = "stale"
	if _, err = s.SaveShopping(ctx, "alice", first.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale edit", err)
	}
}
func TestShoppingConcurrentDuplicate(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, id := range []string{"item-00001", "item-00002"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, err := s.SaveShopping(context.Background(), "u", id, SaveShoppingInput{Name: "牛奶"})
			errs <- err
		}(id)
	}
	wg.Wait()
	close(errs)
	ok, conflict := 0, 0
	for err := range errs {
		if err == nil {
			ok++
		} else if errors.Is(err, domain.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal(ok, conflict)
	}
}
func TestShoppingValidation(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	for _, in := range []SaveShoppingInput{{Name: " "}, {Name: "a\nb"}, {Name: "a", Revision: -1}, {Name: "a", Quantity: string(make([]byte, 31))}, {Name: "a", Note: string(make([]byte, 501))}} {
		if _, err := s.SaveShopping(context.Background(), "u", "item-00001", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(in, err)
		}
	}
	if _, err := s.SaveShopping(context.Background(), "u", "item-00001", SaveShoppingInput{Name: "Milk"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveShopping(context.Background(), "u", "item-00002", SaveShoppingInput{Name: " milk "}); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("case normalization", err)
	}
}
