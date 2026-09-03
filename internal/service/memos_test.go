package service

import (
	"context"
	"errors"
	"testing"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestMemoLifecycleSearchAndChecklist(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	folder, err := svc.CreateMemoFolder(ctx, "owner", SaveMemoFolderInput{Name: "灵感", Color: "violet"})
	if err != nil {
		t.Fatal(err)
	}
	note, err := svc.CreateMemoNote(ctx, "owner", SaveMemoNoteInput{FolderID: folder.ID, Title: "旅行准备", Content: "- [x] 订票\n- [ ] 收拾行李", Tags: []string{"生活", "清单"}, Color: "yellow", Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	items, err := svc.ListMemoNotes(ctx, "owner", ListMemoNotesInput{View: "checklists", Query: "行李", Tag: "清单"})
	if err != nil || len(items) != 1 || items[0].ChecklistDone != 1 || items[0].ChecklistTotal != 2 {
		t.Fatalf("checklist search = %#v, error = %v", items, err)
	}
	overview, err := svc.MemoOverview(ctx, "owner")
	if err != nil || overview.Total != 1 || overview.Pinned != 1 || overview.ChecklistNotes != 1 || overview.Folders != 1 {
		t.Fatalf("overview = %#v, error = %v", overview, err)
	}
	if err := svc.TrashMemoNote(ctx, "owner", note.ID); err != nil {
		t.Fatal(err)
	}
	trash, _ := svc.ListMemoNotes(ctx, "owner", ListMemoNotesInput{View: "trash"})
	if len(trash) != 1 {
		t.Fatalf("trash = %#v", trash)
	}
	if _, err := svc.RestoreMemoNote(ctx, "owner", note.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.TrashMemoNote(ctx, "owner", note.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteMemoNotePermanently(ctx, "owner", note.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MemoNote(ctx, "owner", note.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("permanently deleted note error = %v", err)
	}
}

func TestMemoOwnershipAndFolderDeleteKeepsNotes(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	folder, _ := svc.CreateMemoFolder(ctx, "owner", SaveMemoFolderInput{Name: "工作"})
	note, _ := svc.CreateMemoNote(ctx, "owner", SaveMemoNoteInput{FolderID: folder.ID, Content: "会议纪要"})
	if _, err := svc.UpdateMemoNote(ctx, "other", note.ID, UpdateMemoNoteInput{}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("foreign update error = %v", err)
	}
	if err := svc.DeleteMemoFolder(ctx, "owner", folder.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.MemoNote(ctx, "owner", note.ID)
	if err != nil || loaded.FolderID != "" {
		t.Fatalf("note after folder deletion = %#v, error = %v", loaded, err)
	}
}
