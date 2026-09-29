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

func TestInventoryLifecycleIsolationSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := SaveInventoryInput{Name: "耳机", Category: "数码设备", Location: "书房", Quantity: 1, Price: 19990, PurchasedOn: "2026-09-01", WarrantyUntil: "2027-09-01", Borrower: "朋友", ReturnOn: "2026-10-01"}
	first, err := s.SaveInventory(ctx, "alice", "item-000001", in)
	if err != nil || first.Revision != 1 {
		t.Fatal(first, err)
	}
	retry, err := s.SaveInventory(ctx, "alice", first.ID, in)
	if err != nil || retry.Revision != 1 {
		t.Fatal("retry", retry, err)
	}
	changed := in
	changed.Location = "客厅"
	if _, err = s.SaveInventory(ctx, "alice", first.ID, changed); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("missing conflict", err)
	}
	others, _ := s.ListInventory(ctx, "bob")
	if len(others) != 0 {
		t.Fatal("account leak")
	}
	if _, err = s.SaveInventory(ctx, "bob", first.ID, in); err != nil {
		t.Fatal("ID ownership", err)
	}
	in.Revision = 1
	in.Archived = true
	if _, err = s.SaveInventory(ctx, "alice", first.ID, in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("borrowed item archived", err)
	}
	in.Borrower = ""
	in.ReturnOn = ""
	archived, err := s.SaveInventory(ctx, "alice", first.ID, in)
	if err != nil || archived.Revision != 2 || !archived.Archived {
		t.Fatal(archived, err)
	}
	file := filepath.Join(t.TempDir(), "inventory.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	rows, _ := loaded.ListInventory(ctx, "alice")
	if len(rows) != 1 || rows[0] != archived {
		t.Fatal("snapshot lost", rows)
	}
	in.Revision = 2
	in.Archived = false
	restored, err := New(loaded, nil, nil).SaveInventory(ctx, "alice", first.ID, in)
	if err != nil || restored.Archived || !restored.CreatedAt.Equal(first.CreatedAt) {
		t.Fatal("restore", restored, err)
	}
}
func TestInventoryValidation(t *testing.T) {
	tests := []struct {
		name string
		edit func(*SaveInventoryInput)
	}{
		{"empty name", func(i *SaveInventoryInput) { i.Name = " " }}, {"zero quantity", func(i *SaveInventoryInput) { i.Quantity = 0 }},
		{"negative price", func(i *SaveInventoryInput) { i.Price = -1 }}, {"huge price", func(i *SaveInventoryInput) { i.Price = 10000000001 }},
		{"invalid date", func(i *SaveInventoryInput) { i.ExpiresOn = "2026-02-30" }}, {"date range", func(i *SaveInventoryInput) { i.ExpiresOn = "2201-01-01" }},
		{"before purchase", func(i *SaveInventoryInput) { i.PurchasedOn = "2026-09-01"; i.WarrantyUntil = "2026-08-31" }},
		{"orphan return", func(i *SaveInventoryInput) { i.ReturnOn = "2026-10-01" }}, {"revision", func(i *SaveInventoryInput) { i.Revision = -1 }},
	}
	s := New(store.NewMemory(), nil, nil)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := SaveInventoryInput{Name: "item", Category: "other", Quantity: 1}
			tt.edit(&in)
			if _, err := s.SaveInventory(context.Background(), "u", "item-000001", in); !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatal(err)
			}
		})
	}
}
func TestInventoryConcurrentWrites(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	in := SaveInventoryInput{Name: "item", Category: "other", Quantity: 1}
	if _, err := s.SaveInventory(ctx, "u", "item-000001", in); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"A", "B"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			copy := in
			copy.Name = name
			copy.Revision = 1
			_, err := s.SaveInventory(ctx, "u", "item-000001", copy)
			results <- err
		}(name)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, domain.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal(success, conflict)
	}
}
