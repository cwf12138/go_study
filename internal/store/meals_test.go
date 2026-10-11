package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"testing"
	"time"
)

func TestMealShoppingCapacityIsAtomic(t *testing.T) {
	m := NewMemory()
	m.meals["alice:recipe-01"] = domain.MealEntry{ID: "recipe-01", UserID: "alice", Kind: "recipe", Ingredients: []domain.MealIngredient{{Name: "鸡蛋"}, {Name: "番茄"}}}
	for i := 0; i < 1999; i++ {
		id := fmt.Sprintf("shopping-%d", i)
		m.shopping["alice:"+id] = domain.ShoppingItem{ID: id, UserID: "alice", Name: id}
	}
	if _, err := m.CollectMealShopping(context.Background(), "alice", []string{"recipe-01"}, nil, time.Now()); err == nil {
		t.Fatal("capacity not enforced")
	}
	if len(m.shopping) != 1999 {
		t.Fatal("partially committed batch")
	}
}
