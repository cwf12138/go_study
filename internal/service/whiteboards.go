package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

type SaveWhiteboardInput struct {
	Title    string             `json:"title"`
	Nodes    []domain.BoardNode `json:"nodes"`
	Deleted  bool               `json:"deleted"`
	Revision int                `json:"revision"`
}

func boardText(value string, max int, multiline bool) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > max {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t' || r == '\r')) {
			return false
		}
	}
	return true
}
func boardNumber(v, low, high float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= low && v <= high
}
func ValidateBoard(in SaveWhiteboardInput) error {
	bad := func() error {
		return fmt.Errorf("%w: 请检查白板名称、图形、颜色和画布范围（1600×1000）", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Title) == "" || !boardText(in.Title, 80, false) || in.Revision < 0 || in.Revision > 1000000 || len(in.Nodes) > 250 {
		return bad()
	}
	ids := map[string]bool{}
	points := 0
	for _, n := range in.Nodes {
		if !ledgerID.MatchString(n.ID) || ids[n.ID] || !boardText(n.Text, 1000, true) || n.FontSize < 14 || n.FontSize > 40 || !nutritionOne(n.Color, "#344054", "#5578dd", "#438568", "#bf7053", "#f5dfa1", "#d8e7fa", "#ddd8f3", "#d5e9d9", "#efd6d6") {
			return bad()
		}
		ids[n.ID] = true
		if !boardNumber(n.X, 0, 1600) || !boardNumber(n.Y, 0, 1000) || !boardNumber(n.W, 0, 1600) || !boardNumber(n.H, 0, 1000) {
			return bad()
		}
		switch n.Kind {
		case "note", "text", "rect", "ellipse":
			if n.W < 20 || n.H < 20 || n.X+n.W > 1600 || n.Y+n.H > 1000 || len(n.Points) != 0 {
				return bad()
			}
		case "path", "arrow":
			if len(n.Points) < 2 || len(n.Points) > 1000 || n.Kind == "arrow" && len(n.Points) != 2 {
				return bad()
			}
			for _, p := range n.Points {
				if !boardNumber(p.X, 0, 1600) || !boardNumber(p.Y, 0, 1000) {
					return bad()
				}
			}
		default:
			return bad()
		}
		points += len(n.Points)
		if points > 30000 {
			return bad()
		}
	}
	return nil
}
func (s *Service) ListWhiteboards(ctx context.Context, user string) ([]domain.Whiteboard, error) {
	return s.repo.ListWhiteboards(ctx, user)
}
func (s *Service) SaveWhiteboard(ctx context.Context, user, id string, in SaveWhiteboardInput) (domain.Whiteboard, error) {
	if user == "" || !ledgerID.MatchString(id) {
		return domain.Whiteboard{}, domain.ErrInvalidInput
	}
	in.Title = strings.TrimSpace(in.Title)
	if e := ValidateBoard(in); e != nil {
		return domain.Whiteboard{}, e
	}
	now := s.now().UTC()
	return s.repo.SaveWhiteboard(ctx, domain.Whiteboard{ID: id, UserID: user, Title: in.Title, Nodes: in.Nodes, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
