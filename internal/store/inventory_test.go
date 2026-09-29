package store

import (
	"context"
	"errors"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"testing"
)

func TestInventoryCapacityIncludesArchived(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	for i := 0; i < 1000; i++ {
		row := domain.InventoryItem{ID: fmt.Sprintf("item-%08d", i), UserID: "a", Name: "stored", Archived: true}
		if _, err := m.SaveInventory(ctx, row, 0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.SaveInventory(ctx, domain.InventoryItem{ID: "item-extra", UserID: "a"}, 0); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("missing cap", err)
	}
	if _, err := m.SaveInventory(ctx, domain.InventoryItem{ID: "item-extra", UserID: "b"}, 0); err != nil {
		t.Fatal("other owner affected", err)
	}
	if _, err := m.SaveInventory(ctx, domain.InventoryItem{ID: "item-00000000", UserID: "a", Name: "updated"}, 1); err != nil {
		t.Fatal("cannot edit at limit", err)
	}
	if _, err := m.SaveInventory(ctx, domain.InventoryItem{ID: "item-missing", UserID: "b"}, 2); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing record updated", err)
	}
}
