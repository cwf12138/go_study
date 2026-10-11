package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func mealInput() SaveMealInput {
	return SaveMealInput{Kind: "recipe", Title: "番茄炒蛋", Category: "家常菜", Minutes: 15, Servings: 2, Ingredients: []domain.MealIngredient{{Name: "番茄", Quantity: "2个"}, {Name: "鸡蛋", Quantity: "3个"}, {Name: "盐", Quantity: "适量"}}, Steps: []string{"切好番茄。", "炒至熟透。"}}
}
func TestMealsLifecycleSnapshotAndExport(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	in := mealInput()
	first, err := svc.SaveMeal(ctx, "alice", "recipe-01", in)
	if err != nil || first.Revision != 1 {
		t.Fatal(first, err)
	}
	// Neither the input nor a returned value may alias repository slices.
	in.Ingredients[0].Name = "改动输入"
	first.Steps[0] = "改动返回"
	in = mealInput()
	row, err := svc.SaveMeal(ctx, "alice", "recipe-01", in)
	if err != nil || row.Revision != 1 || row.Ingredients[0].Name != "番茄" || row.Steps[0] != "切好番茄。" {
		t.Fatal("retry or alias", row, err)
	}
	rows, _ := svc.ListMeals(ctx, "bob")
	if len(rows) != 0 {
		t.Fatal("account leak")
	}
	plan := SaveMealInput{Kind: "plan", RecipeID: row.ID, Date: "2026-10-11", Slot: "dinner"}
	p, err := svc.SaveMeal(ctx, "alice", "plan-0001", plan)
	if err != nil || p.Title != row.Title {
		t.Fatal(p, err)
	}
	retry, err := svc.SaveMeal(ctx, "alice", p.ID, plan)
	if err != nil || !reflect.DeepEqual(p, retry) {
		t.Fatal("plan retry", retry, err)
	}
	if _, err = svc.SaveMeal(ctx, "alice", "plan-0002", plan); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate dish", err)
	}
	if _, err = svc.SaveMeal(ctx, "bob", "plan-0001", plan); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("cross-account recipe", err)
	}
	in.Revision = row.Revision
	in.Deleted = true
	if _, err = svc.SaveMeal(ctx, "alice", row.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("dangling reference", err)
	}
	plan.Revision = p.Revision
	plan.Cooked = true
	p, err = svc.SaveMeal(ctx, "alice", p.ID, plan)
	if err != nil || !p.Cooked {
		t.Fatal(p, err)
	}
	plan.Cooked = false
	if _, err = svc.SaveMeal(ctx, "alice", p.ID, plan); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale write", err)
	}
	path := filepath.Join(t.TempDir(), "meals.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	before, _ := repo.ListMeals(ctx, "alice")
	after, _ := loaded.ListMeals(ctx, "alice")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("snapshot mismatch", after)
	}
	if err = repo.CreateUser(ctx, domain.User{ID: "alice", Name: "A", Email: "meal@example.com"}); err != nil {
		t.Fatal(err)
	}
	export, err := svc.ExportUserData(ctx, "alice")
	if err != nil || export.Counts["meals"] != 2 || len(export.Meals) != 2 {
		t.Fatal("export", export.Counts, err)
	}
	plan.Revision = p.Revision
	plan.Deleted = true
	if _, err = svc.SaveMeal(ctx, "alice", p.ID, plan); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.SaveMeal(ctx, "alice", row.ID, in); err != nil {
		t.Fatal("delete unreferenced recipe", err)
	}
}

func TestMealsShoppingAtomicAndConcurrent(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	if _, err := svc.SaveMeal(ctx, "alice", "recipe-01", mealInput()); err != nil {
		t.Fatal(err)
	}
	in := MealShoppingInput{IDs: []string{"recipe-01"}, Have: []string{"盐"}}
	bad := in
	bad.IDs = []string{"recipe-01", "missing-01"}
	if _, err := svc.CollectMealShopping(ctx, "alice", bad); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	rows, _ := svc.ListShopping(ctx, "alice")
	if len(rows) != 0 {
		t.Fatal("partial batch committed")
	}
	if _, err := svc.CollectMealShopping(ctx, "bob", in); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("account isolation", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.CollectMealShopping(ctx, "alice", in); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	rows, _ = svc.ListShopping(ctx, "alice")
	if len(rows) != 2 {
		t.Fatal("duplicates", rows)
	}
	result, err := svc.CollectMealShopping(ctx, "alice", in)
	if err != nil || result.Added != 0 || result.Existing != 2 {
		t.Fatal("retry", result, err)
	}
	for _, row := range rows {
		if row.Quantity != "按菜谱" || row.Note == "" {
			t.Fatal("quantity/notes", row)
		}
	}
}

func TestMealValidation(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	for _, change := range []func(*SaveMealInput){func(v *SaveMealInput) { v.Title = "" }, func(v *SaveMealInput) { v.Minutes = 0 }, func(v *SaveMealInput) { v.Servings = 21 }, func(v *SaveMealInput) { v.Steps = nil }, func(v *SaveMealInput) { v.Ingredients = []domain.MealIngredient{{Name: "盐"}, {Name: "盐"}} }, func(v *SaveMealInput) { v.Kind = "other" }, func(v *SaveMealInput) { v.Revision = -1 }} {
		in := mealInput()
		change(&in)
		if _, err := svc.SaveMeal(ctx, "alice", "recipe-01", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("invalid accepted", in, err)
		}
	}
	for _, date := range []string{"2026-02-29", "1999-12-31", "2101-01-01"} {
		if _, err := svc.SaveMeal(ctx, "alice", "plan-001", SaveMealInput{Kind: "plan", RecipeID: "recipe-01", Date: date, Slot: "dinner"}); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(date, err)
		}
	}
	if _, err := svc.CollectMealShopping(ctx, "alice", MealShoppingInput{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal(err)
	}
}
