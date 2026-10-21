package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"math"
	"path/filepath"
	"reflect"
	"testing"
)

func boardFixture() SaveWhiteboardInput {
	return SaveWhiteboardInput{Title: "一张草图", Nodes: []domain.BoardNode{{ID: "note-abcdef", Kind: "note", X: 20, Y: 30, W: 240, H: 180, Color: "#f5dfa1", Text: "你好 <script>", FontSize: 24, Points: []domain.BoardPoint{}}, {ID: "path-abcdef", Kind: "path", Color: "#344054", FontSize: 24, Points: []domain.BoardPoint{{X: 20, Y: 20}, {X: 30, Y: 30}}}}}
}
func TestWhiteboardValidation(t *testing.T) {
	if e := ValidateBoard(boardFixture()); e != nil {
		t.Fatal(e)
	}
	for i, change := range []func(*SaveWhiteboardInput){func(in *SaveWhiteboardInput) { in.Title = " " }, func(in *SaveWhiteboardInput) { in.Nodes[0].X = -1 }, func(in *SaveWhiteboardInput) { in.Nodes[0].X = 1500 }, func(in *SaveWhiteboardInput) { in.Nodes[0].W = math.NaN() }, func(in *SaveWhiteboardInput) { in.Nodes[1].Points[0].Y = math.Inf(1) }, func(in *SaveWhiteboardInput) { in.Nodes[0].Color = "url(https://evil.test)" }, func(in *SaveWhiteboardInput) { in.Nodes[0].Kind = "script" }, func(in *SaveWhiteboardInput) { in.Nodes[1].ID = in.Nodes[0].ID }, func(in *SaveWhiteboardInput) { in.Nodes[0].FontSize = 500 }, func(in *SaveWhiteboardInput) { in.Nodes[0].Text = "a\x00" }, func(in *SaveWhiteboardInput) { in.Nodes[1].Points = nil }, func(in *SaveWhiteboardInput) {
		in.Nodes[1].Kind = "arrow"
		in.Nodes[1].Points = append(in.Nodes[1].Points, domain.BoardPoint{})
	}} {
		in := boardFixture()
		change(&in)
		if e := ValidateBoard(in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal(i, e)
		}
	}
}
func TestWhiteboardStorageAndExport(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := boardFixture()
	row, e := s.SaveWhiteboard(ctx, "alice", "board-abcdef", in)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.SaveWhiteboard(ctx, "alice", row.ID, in)
	if e != nil || !reflect.DeepEqual(row, again) {
		t.Fatal("retry", again, e)
	}
	row.Nodes[1].Points[0].X = 999
	rows, e := s.ListWhiteboards(ctx, "alice")
	if e != nil || rows[0].Nodes[1].Points[0].X != 20 {
		t.Fatal("aliasing", rows, e)
	}
	if rows, e := s.ListWhiteboards(ctx, "bob"); e != nil || len(rows) != 0 {
		t.Fatal("ownership", rows, e)
	}
	in.Revision = 1
	in.Deleted = true
	if _, e := s.SaveWhiteboard(ctx, "alice", "board-abcdef", in); e != nil {
		t.Fatal(e)
	}
	in.Revision = 2
	in.Title = "trash edit"
	if _, e := s.SaveWhiteboard(ctx, "alice", "board-abcdef", in); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal(e)
	}
	in.Title = "一张草图"
	in.Deleted = false
	restored, e := s.SaveWhiteboard(ctx, "alice", "board-abcdef", in)
	if e != nil || restored.Deleted {
		t.Fatal(restored, e)
	}
	in.Title = "stale"
	if _, e := s.SaveWhiteboard(ctx, "alice", "board-abcdef", in); !errors.Is(e, domain.ErrConflict) {
		t.Fatal(e)
	}
	file := filepath.Join(t.TempDir(), "boards.json")
	if e := repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	copy := store.NewMemory()
	if e := copy.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	back, e := copy.ListWhiteboards(ctx, "alice")
	if e != nil || len(back) != 1 || !reflect.DeepEqual(back[0], restored) {
		t.Fatal("snapshot", back, e)
	}
	if e := repo.CreateUser(ctx, domain.User{ID: "alice", Name: "Board", Email: "board@example.test"}); e != nil {
		t.Fatal(e)
	}
	data, e := s.ExportUserData(ctx, "alice")
	if e != nil || len(data.Whiteboards) != 1 || data.Counts["whiteboards"] != 1 {
		t.Fatal("export", e)
	}
}
