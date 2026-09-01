package service

import (
	"context"
	"errors"
	"testing"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestKnowledgeNotesBuildBacklinksAndGraph(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)

	channel, err := svc.CreateKnowledgeNote(ctx, "user-1", SaveKnowledgeNoteInput{
		Title: "Go Channel", Content: "channel 用于 goroutine 之间的通信。", Tags: []string{"Go", "并发"}, Pinned: true,
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeNote(channel): %v", err)
	}
	selectNote, err := svc.CreateKnowledgeNote(ctx, "user-1", SaveKnowledgeNoteInput{
		Title: "Select", Content: "通过 [[Go Channel]] 等待多个通信操作，也可以关联 [[Context]]。", Tags: []string{"Go"},
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeNote(select): %v", err)
	}

	detail, err := svc.KnowledgeNote(ctx, "user-1", selectNote.Note.ID)
	if err != nil {
		t.Fatalf("KnowledgeNote: %v", err)
	}
	if len(detail.OutgoingLinks) != 1 || detail.OutgoingLinks[0].TargetID != channel.Note.ID {
		t.Fatalf("resolved outgoing links = %#v", detail.OutgoingLinks)
	}
	if len(detail.UnresolvedLinks) != 1 || detail.UnresolvedLinks[0].TargetTitle != "Context" {
		t.Fatalf("unresolved links = %#v", detail.UnresolvedLinks)
	}

	channelDetail, err := svc.KnowledgeNote(ctx, "user-1", channel.Note.ID)
	if err != nil || len(channelDetail.Backlinks) != 1 || channelDetail.Backlinks[0].SourceID != selectNote.Note.ID {
		t.Fatalf("backlinks = %#v, err = %v", channelDetail.Backlinks, err)
	}
	graph, err := svc.KnowledgeGraph(ctx, "user-1")
	if err != nil || len(graph.Nodes) != 2 || len(graph.Edges) != 1 || graph.UnresolvedCount != 1 || graph.OrphanCount != 0 {
		t.Fatalf("KnowledgeGraph = %#v, err = %v", graph, err)
	}
	results, err := svc.ListKnowledgeNotes(ctx, "user-1", ListKnowledgeNotesInput{Query: "通信", Tag: "go"})
	if err != nil || len(results) != 2 || results[0].ID != channel.Note.ID {
		t.Fatalf("knowledge search = %#v, err = %v", results, err)
	}
}

func TestKnowledgeNoteTitleUniquenessOwnershipAndDelete(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	created, err := svc.CreateKnowledgeNote(ctx, "owner", SaveKnowledgeNoteInput{Title: "Context", Content: "取消与超时"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateKnowledgeNote(ctx, "owner", SaveKnowledgeNoteInput{Title: " context "}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate title error = %v, want conflict", err)
	}
	if err := svc.DeleteKnowledgeNote(ctx, "another-user", created.Note.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("foreign delete error = %v, want forbidden", err)
	}
	if err := svc.DeleteKnowledgeNote(ctx, "owner", created.Note.ID); err != nil {
		t.Fatalf("DeleteKnowledgeNote: %v", err)
	}
	if _, err := svc.KnowledgeNote(ctx, "owner", created.Note.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("deleted note error = %v, want not found", err)
	}
}
