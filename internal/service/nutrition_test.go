package service

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestNutritionCatalogue(t *testing.T) {
	catalog := NutritionCatalog()
	if len(catalog) != 24 {
		t.Fatal("unexpected meal count", len(catalog))
	}
	ids := map[string]bool{}
	for _, c := range catalog {
		if ids[c.ID] || c.ID == "" || c.Title == "" || c.Reason == "" || c.Tip == "" || len(c.Parts) != 3 || len(c.Channels) == 0 || len(c.Slots) == 0 || c.Allergens == nil {
			t.Fatal("invalid catalogue", c)
		}
		ids[c.ID] = true
		for _, key := range c.Allergens {
			if !nutritionOne(key, "milk", "egg", "soy", "wheat", "peanut", "nuts", "fish", "shellfish", "sesame") {
				t.Fatal("allergen", key)
			}
			if c.PlantOnly && nutritionOne(key, "milk", "egg", "fish", "shellfish") {
				t.Fatal("plant-only card contains animal ingredient", c)
			}
		}
	}
	catalog[0].Parts[0].Text = "changed"
	if NutritionCatalog()[0].Parts[0].Text == "changed" {
		t.Fatal("catalogue aliases mutable data")
	}
}

func TestNutritionPersistenceAndOwnership(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, calendarLocation)
	svc.now = func() time.Time { return now }
	prefs := SaveNutritionInput{Kind: "preference", Preferences: &domain.NutritionPreferences{Goal: "training", Slot: "lunch", Channel: "canteen", Avoid: []string{"soy", "milk", "soy"}, Exclude: " 牛肉 "}}
	for i := 0; i < 2; i++ {
		row, e := svc.SaveNutrition(ctx, "alice", "nutrition-preferences", prefs)
		if e != nil || row.Revision != 1 || !reflect.DeepEqual(row.Preferences.Avoid, []string{"milk", "soy"}) || row.Preferences.Exclude != "牛肉" {
			t.Fatal("preference retry", row, e)
		}
		row.Preferences.Avoid[0] = "mutated"
	}
	fav := SaveNutritionInput{Kind: "favorite", CardID: "rice-chicken"}
	row, e := svc.SaveNutrition(ctx, "alice", "nutrition-favorite-rice-chicken", fav)
	if e != nil || row.Card == nil {
		t.Fatal(e)
	}
	row.Card.Parts[0].Text = "mutated"
	saved, _ := repo.NutritionByID(ctx, "alice", row.ID)
	if saved.Card.Parts[0].Text == "mutated" {
		t.Fatal("returned snapshot aliases store")
	}
	fav.Deleted = true
	fav.Revision = 1
	deleted, e := svc.SaveNutrition(ctx, "alice", row.ID, fav)
	if e != nil || !deleted.Deleted {
		t.Fatal("archive", e)
	}
	fav.Deleted = false
	fav.Revision = 2
	if _, e = svc.SaveNutrition(ctx, "alice", row.ID, fav); e != nil {
		t.Fatal("restore", e)
	}
	plan := SaveNutritionInput{Kind: "plan", CardID: "rice-chicken", Date: "2026-10-18", Slot: "lunch", State: "planned", Note: "<b>keep as text</b>"}
	for i := 0; i < 2; i++ {
		row, e = svc.SaveNutrition(ctx, "alice", "nutrition-plan-one", plan)
		if e != nil || row.Revision != 1 {
			t.Fatal("plan retry", row, e)
		}
	}
	plan.Revision = 1
	plan.State = "eaten"
	row, e = svc.SaveNutrition(ctx, "alice", row.ID, plan)
	if e != nil || row.State != "eaten" {
		t.Fatal("mark eaten", e)
	}
	if _, e = svc.SaveNutrition(ctx, "alice", row.ID, SaveNutritionInput{Kind: "plan", CardID: "rice-chicken", Date: "2026-10-18", Slot: "lunch", State: "planned", Revision: 1}); !errors.Is(e, domain.ErrConflict) {
		t.Fatal("stale write", e)
	}
	other, e := svc.ListNutrition(ctx, "bob")
	if e != nil || len(other) != 0 {
		t.Fatal("list isolation", other, e)
	}
	if _, e = repo.NutritionByID(ctx, "bob", row.ID); !errors.Is(e, domain.ErrNotFound) {
		t.Fatal("owner isolation", e)
	}
	if _, e = svc.SaveNutrition(ctx, "bob", row.ID, plan); !errors.Is(e, domain.ErrNotFound) {
		t.Fatal("cross-owner write", e)
	}
	file := filepath.Join(t.TempDir(), "snapshot.json")
	if e = repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	restored := store.NewMemory()
	if e = restored.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	back, e := restored.NutritionByID(ctx, "alice", row.ID)
	if e != nil || !reflect.DeepEqual(row, back) {
		t.Fatal("snapshot", e)
	}
	if e = repo.CreateUser(ctx, domain.User{ID: "alice", Name: "Nutrition", Email: "nutrition@example.test"}); e != nil {
		t.Fatal(e)
	}
	exported, e := svc.ExportUserData(ctx, "alice")
	if e != nil || len(exported.Nutrition) != 3 || exported.Counts["nutrition"] != 3 {
		t.Fatal("personal export", e)
	}
}

func TestNutritionValidationAndConcurrentPlans(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 10, 18, 12, 0, 0, 0, calendarLocation) }
	for _, in := range []SaveNutritionInput{
		{Kind: "session"}, {Kind: "favorite", CardID: "missing"}, {Kind: "favorite", CardID: "rice-chicken"},
		{Kind: "plan", CardID: "oat-milk", Date: "2026-10-18", Slot: "dinner", State: "planned"},
		{Kind: "plan", CardID: "rice-chicken", Date: "2026-02-30", Slot: "lunch", State: "planned"},
		{Kind: "plan", CardID: "rice-chicken", Date: "2026-10-19", Slot: "lunch", State: "eaten"},
		{Kind: "plan", CardID: "rice-chicken", Date: "2026-10-18", Slot: "lunch", State: "done"},
		{Kind: "preference", Preferences: &domain.NutritionPreferences{Goal: "fasting", Channel: "any", Slot: "lunch"}},
	} {
		if _, e := svc.SaveNutrition(ctx, "alice", "nutrition-invalid", in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal("invalid input accepted", in, e)
		}
	}
	if _, e := svc.SaveNutrition(ctx, "alice", "nutrition-preferences", SaveNutritionInput{Kind: "preference", Preferences: &domain.NutritionPreferences{Goal: "balanced", Channel: "any", Slot: "lunch", Avoid: []string{"unknown"}}}); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal("unknown allergen accepted", e)
	}
	input := SaveNutritionInput{Kind: "plan", CardID: "rice-chicken", Date: "2026-10-18", Slot: "lunch", State: "planned"}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"nutrition-plan-one", "nutrition-plan-two"} {
		wg.Add(1)
		go func(id string) { defer wg.Done(); _, e := svc.SaveNutrition(ctx, "alice", id, input); results <- e }(id)
	}
	wg.Wait()
	close(results)
	ok, conflicts := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, domain.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatal("concurrent duplicate plans", ok, conflicts)
	}
	rows, _ := svc.ListNutrition(ctx, "alice")
	input.Revision = rows[0].Revision
	input.Deleted = true
	if _, e := svc.SaveNutrition(ctx, "alice", rows[0].ID, input); e != nil {
		t.Fatal(e)
	}
	input.Revision = 0
	input.Deleted = false
	if _, e := svc.SaveNutrition(ctx, "alice", "nutrition-plan-new", input); e != nil {
		t.Fatal("new plan after removal", e)
	}
	input.Revision = 2
	if _, e := svc.SaveNutrition(ctx, "alice", rows[0].ID, input); !errors.Is(e, domain.ErrConflict) {
		t.Fatal("restore created duplicate", e)
	}
}
