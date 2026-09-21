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

func TestLedgerValidationIsolationAndPersistence(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	input := SaveLedgerInput{Kind: "expense", Amount: 1234, Date: "2026-09-22", Category: "餐饮", Account: "现金", Note: "午餐"}
	first, err := s.SaveLedger(ctx, "alice", "entry-00000001", input)
	if err != nil || first.Revision != 1 {
		t.Fatal(first, err)
	}
	retry, err := s.SaveLedger(ctx, "alice", first.ID, input)
	if err != nil || retry.Revision != 1 {
		t.Fatal("retry duplicated", retry, err)
	}
	changed := input
	changed.Amount = 100
	if _, err = s.SaveLedger(ctx, "alice", first.ID, changed); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("expected conflict", err)
	}
	others, _ := s.ListLedger(ctx, "bob")
	if len(others) != 0 {
		t.Fatal("account leak")
	}
	if _, err = s.SaveLedger(ctx, "bob", first.ID, input); err != nil {
		t.Fatal("owner scoped IDs", err)
	}
	input.Revision = 1
	input.Archived = true
	if _, err = s.SaveLedger(ctx, "alice", first.ID, input); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "ledger.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err = restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	rows, _ := restored.ListLedger(ctx, "alice")
	if len(rows) != 1 || !rows[0].Archived || rows[0].Amount != 1234 {
		t.Fatal(rows)
	}
	input.Revision = 2
	input.Archived = false
	s = New(restored, nil, nil)
	if _, err = s.SaveLedger(ctx, "alice", first.ID, input); err != nil {
		t.Fatal("restore", err)
	}
	for _, amount := range []int64{-1, 0, 10000000001} {
		bad := input
		bad.Amount = amount
		if _, err = s.SaveLedger(ctx, "alice", "bad-00000001", bad); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("bad amount", amount, err)
		}
	}
	for _, date := range []string{"2026-02-30", "1999-01-01", "2101-01-01"} {
		bad := input
		bad.Date = date
		if _, err = s.SaveLedger(ctx, "alice", "bad-00000001", bad); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("bad date", date, err)
		}
	}
	budget := SaveLedgerInput{Kind: "budget", Amount: 500000, Date: "2026-09-01"}
	if _, err = s.SaveLedger(ctx, "alice", "random-budget", budget); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("budget ID validation", err)
	}
	if _, err = s.SaveLedger(ctx, "alice", "budget-2026-09", budget); err != nil {
		t.Fatal(err)
	}
	budget.Amount = 600000
	if _, err = s.SaveLedger(ctx, "alice", "budget-2026-09", budget); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate budget must conflict", err)
	}
}

func TestLedgerConcurrentRetry(t *testing.T) {
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.SaveLedger(ctx, "alice", "entry-concurrent", SaveLedgerInput{Kind: "income", Amount: 100, Date: "2026-09-22", Category: "工资", Account: "现金"})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	rows, _ := s.ListLedger(ctx, "alice")
	if len(rows) != 1 || rows[0].Revision != 1 {
		t.Fatal(rows)
	}
}
