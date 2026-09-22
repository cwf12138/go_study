package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"testing"
)

func TestProjectLifecycleAndIsolation(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := SaveProjectInput{Title: "Trip", Color: "#537e78", Cards: []domain.ProjectCard{{ID: "card-00000001", Title: "Tickets", Status: "todo", Priority: "normal", Checks: []domain.ProjectCheck{{Title: "Compare"}}}}}
	p, err := s.SaveProject(ctx, "alice", "project-00000001", in)
	if err != nil || p.Revision != 1 {
		t.Fatal(p, err)
	}
	retry, err := s.SaveProject(ctx, "alice", p.ID, in)
	if err != nil || retry.Revision != 1 {
		t.Fatal("retry not idempotent", err)
	}
	p.Cards[0].Checks[0].Title = "mutated return"
	rows, _ := s.ListProjects(ctx, "alice")
	if rows[0].Cards[0].Checks[0].Title != "Compare" {
		t.Fatal("returned slice aliases store")
	}
	rows[0].Cards[0].Title = "mutated list"
	rows, _ = s.ListProjects(ctx, "alice")
	if rows[0].Cards[0].Title != "Tickets" {
		t.Fatal("list aliases store")
	}
	others, _ := s.ListProjects(ctx, "bob")
	if len(others) != 0 {
		t.Fatal("account leak")
	}
	in.Title = "Changed"
	if _, err = s.SaveProject(ctx, "alice", p.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("missing conflict", err)
	}
	in.Revision = 1
	in.Cards[0].Status = "done"
	in.Cards[0].Checks[0].Done = true
	in.Cards[0].Archived = true
	if _, err = s.SaveProject(ctx, "alice", p.ID, in); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "projects.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err = restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	rows, _ = restored.ListProjects(ctx, "alice")
	if len(rows) != 1 || rows[0].Revision != 2 || !rows[0].Cards[0].Archived || !rows[0].Cards[0].Checks[0].Done {
		t.Fatal(rows)
	}
	in.Revision = 2
	in.Cards[0].Archived = false
	if _, err = New(restored, nil, nil).SaveProject(ctx, "alice", p.ID, in); err != nil {
		t.Fatal(err)
	}
	in.Cards = append(in.Cards, in.Cards[0])
	if _, err = s.SaveProject(ctx, "alice", p.ID, in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("duplicate cards accepted", err)
	}
	in.Cards = in.Cards[:1]
	in.Cards[0].Due = "2026-02-30"
	if _, err = s.SaveProject(ctx, "alice", p.ID, in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("bad date accepted", err)
	}
}
