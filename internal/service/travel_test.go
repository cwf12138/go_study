package service

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func travelFixture() SaveTravelPlanInput {
	return SaveTravelPlanInput{Title: "杭州周末", Destination: "杭州", StartDate: "2026-10-01", EndDate: "2026-10-03", BudgetCents: 100000,
		Stops:   []domain.TravelStop{{ID: "stop-00000001", Title: "西湖散步", Date: "2026-10-01", Time: "10:00", Minutes: 60, Category: "sight", EstimatedCents: 1234}},
		Packing: []domain.TravelPack{{ID: "pack-00000001", Title: "充电器", Category: "electronics", Quantity: 1}}}
}

func TestTravelLifecycleAndSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := travelFixture()
	p, err := s.SaveTravelPlan(ctx, "alice", "travel-00000001", in)
	if err != nil || p.Revision != 1 {
		t.Fatal(p, err)
	}
	retry, err := s.SaveTravelPlan(ctx, "alice", p.ID, in)
	if err != nil || retry.Revision != 1 || !retry.UpdatedAt.Equal(p.UpdatedAt) {
		t.Fatal("retry must be idempotent", retry, err)
	}
	in.Stops[0].Title = "input mutation"
	in.Packing[0].Title = "input mutation"
	p.Stops[0].Title = "return mutation"
	rows, _ := s.ListTravelPlans(ctx, "alice")
	if rows[0].Stops[0].Title != "西湖散步" || rows[0].Packing[0].Title != "充电器" {
		t.Fatal("slice alias")
	}
	rows[0].Packing[0].Title = "list mutation"
	rows, _ = s.ListTravelPlans(ctx, "alice")
	if rows[0].Packing[0].Title != "充电器" {
		t.Fatal("list alias")
	}
	rows, _ = s.ListTravelPlans(ctx, "bob")
	if len(rows) != 0 {
		t.Fatal("account leak")
	}
	in = travelFixture()
	in.Title = "updated"
	if _, err = s.SaveTravelPlan(ctx, "alice", p.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal(err)
	}
	// The same identifier in another account must not expose or alter Alice's plan.
	if _, err = s.SaveTravelPlan(ctx, "bob", p.ID, in); err != nil {
		t.Fatal(err)
	}
	in.Revision = 1
	in.Archived = true
	in.Stops[0].Done = true
	in.Stops[0].SpentCents = 990
	in.Packing[0].Packed = true
	saved, err := s.SaveTravelPlan(ctx, "alice", p.ID, in)
	if err != nil || saved.Revision != 2 || !saved.CreatedAt.Equal(p.CreatedAt) {
		t.Fatal(saved, err)
	}
	file := filepath.Join(t.TempDir(), "travel.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err = restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	rows, _ = restored.ListTravelPlans(ctx, "alice")
	if len(rows) != 1 || rows[0].Revision != 2 || !rows[0].Archived || !rows[0].Stops[0].Done || !rows[0].Packing[0].Packed || rows[0].Stops[0].SpentCents != 990 {
		t.Fatal(rows)
	}
	in.Revision = 2
	in.Archived = false
	if _, err = New(restored, nil, nil).SaveTravelPlan(ctx, "alice", p.ID, in); err != nil {
		t.Fatal(err)
	}
}

func TestTravelValidation(t *testing.T) {
	tests := map[string]func(*SaveTravelPlanInput){
		"blank title":            func(p *SaveTravelPlanInput) { p.Title = "  " },
		"invalid day":            func(p *SaveTravelPlanInput) { p.StartDate = "2026-02-30" },
		"invalid year":           func(p *SaveTravelPlanInput) { p.StartDate = "1999-12-31" },
		"too many days":          func(p *SaveTravelPlanInput) { p.EndDate = "2026-11-01" },
		"reversed dates":         func(p *SaveTravelPlanInput) { p.EndDate = "2026-09-30" },
		"outside range":          func(p *SaveTravelPlanInput) { p.Stops[0].Date = "2026-10-04" },
		"negative cost":          func(p *SaveTravelPlanInput) { p.Stops[0].SpentCents = -1 },
		"budget limit":           func(p *SaveTravelPlanInput) { p.BudgetCents = 100000001 },
		"estimate limit":         func(p *SaveTravelPlanInput) { p.Stops[0].EstimatedCents = 100000001 },
		"overnight":              func(p *SaveTravelPlanInput) { p.Stops[0].Time = "23:30" },
		"bad time":               func(p *SaveTravelPlanInput) { p.Stops[0].Time = "25:00" },
		"loose time":             func(p *SaveTravelPlanInput) { p.Stops[0].Time = "9:00" },
		"zero duration":          func(p *SaveTravelPlanInput) { p.Stops[0].Minutes = 0 },
		"long duration":          func(p *SaveTravelPlanInput) { p.Stops[0].Minutes = 1441 },
		"unknown category":       func(p *SaveTravelPlanInput) { p.Stops[0].Category = "script" },
		"duplicate stop":         func(p *SaveTravelPlanInput) { p.Stops = append(p.Stops, p.Stops[0]) },
		"duplicate across lists": func(p *SaveTravelPlanInput) { p.Packing[0].ID = p.Stops[0].ID },
		"quantity":               func(p *SaveTravelPlanInput) { p.Packing[0].Quantity = 0 },
		"pack category":          func(p *SaveTravelPlanInput) { p.Packing[0].Category = "invalid" },
		"pack title":             func(p *SaveTravelPlanInput) { p.Packing[0].Title = " " },
		"negative revision":      func(p *SaveTravelPlanInput) { p.Revision = -1 },
		"many stops":             func(p *SaveTravelPlanInput) { p.Stops = make([]domain.TravelStop, 201) },
		"many items":             func(p *SaveTravelPlanInput) { p.Packing = make([]domain.TravelPack, 101) },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			p := travelFixture()
			change(&p)
			_, err := New(store.NewMemory(), nil, nil).SaveTravelPlan(context.Background(), "alice", "travel-00000001", p)
			if !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatal(err)
			}
		})
	}
	p := travelFixture()
	p.EndDate = "2026-10-31"
	p.Stops[0].Time = "23:00"
	if _, err := New(store.NewMemory(), nil, nil).SaveTravelPlan(context.Background(), "alice", "travel-00000001", p); err != nil {
		t.Fatal("31 days and midnight endpoint should be allowed", err)
	}
	p = travelFixture()
	p.StartDate = "2028-02-29"
	p.EndDate = "2028-02-29"
	p.Stops = nil
	p.Packing = nil
	if _, err := New(store.NewMemory(), nil, nil).SaveTravelPlan(context.Background(), "alice", "travel-00000001", p); err != nil {
		t.Fatal("leap day", err)
	}
}

func TestTravelConcurrentWriters(t *testing.T) {
	ctx := context.Background()
	s := New(store.NewMemory(), nil, nil)
	if _, err := s.SaveTravelPlan(ctx, "alice", "travel-00000001", travelFixture()); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p := travelFixture()
			p.Revision = 1
			p.Title = fmt.Sprint("writer-", i)
			_, err := s.SaveTravelPlan(ctx, "alice", "travel-00000001", p)
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, domain.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal(success, conflicts)
	}
}

func TestTravelPlanLimitAndMissingRevision(t *testing.T) {
	ctx := context.Background()
	s := New(store.NewMemory(), nil, nil)
	p := travelFixture()
	p.Revision = 2
	if _, err := s.SaveTravelPlan(ctx, "alice", "missing-000001", p); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	p.Revision = 0
	p.Archived = true
	for i := 0; i < 50; i++ {
		if _, err := s.SaveTravelPlan(ctx, "alice", fmt.Sprintf("travel-%08d", i), p); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SaveTravelPlan(ctx, "alice", "travel-overlimit", p); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal(err)
	}
	if _, err := s.SaveTravelPlan(ctx, "bob", "travel-overlimit", p); err != nil {
		t.Fatal(err)
	}
}

func TestTravelPersonalExport(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	if err := repo.CreateUser(ctx, domain.User{ID: "alice", Email: "travel-export@example.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveTravelPlan(ctx, "alice", "travel-00000001", travelFixture()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveTravelPlan(ctx, "bob", "travel-00000002", travelFixture()); err != nil {
		t.Fatal(err)
	}
	bundle, err := s.ExportUserData(ctx, "alice")
	if err != nil || len(bundle.TravelPlans) != 1 || bundle.Counts["travel_plans"] != 1 || bundle.TravelPlans[0].UserID != "alice" {
		t.Fatal(bundle.TravelPlans, err)
	}
}
