package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveImportantDayInput struct {
	Title    string `json:"title"`
	Date     string `json:"date"`
	Category string `json:"category"`
	Note     string `json:"note"`
	Annual   bool   `json:"annual"`
	Pinned   bool   `json:"pinned"`
	Deleted  bool   `json:"deleted"`
	Revision int    `json:"revision"`
}

func (s *Service) ListImportantDays(ctx context.Context, user string) ([]domain.ImportantDay, error) {
	return s.repo.ListImportantDays(ctx, user)
}
func (s *Service) SaveImportantDay(ctx context.Context, user, id string, in SaveImportantDayInput) (domain.ImportantDay, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	bad := func() (domain.ImportantDay, error) {
		return domain.ImportantDay{}, fmt.Errorf("%w: 请填写有效的名称、日期和分类（名称 1–80 字，备注最多 1000 字）", domain.ErrInvalidInput)
	}
	d, err := time.Parse("2006-01-02", in.Date)
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 || in.Title == "" || utf8.RuneCountInString(in.Title) > 80 || strings.ContainsAny(in.Title, "\r\n") || utf8.RuneCountInString(in.Note) > 1000 || err != nil || d.Year() < 1900 || d.Year() > 2200 {
		return bad()
	}
	switch in.Category {
	case "birthday", "anniversary", "plan", "other":
	default:
		return bad()
	}
	now := s.now().UTC()
	return s.repo.SaveImportantDay(ctx, domain.ImportantDay{ID: id, UserID: user, Title: in.Title, Date: in.Date, Category: in.Category, Note: in.Note, Annual: in.Annual, Pinned: in.Pinned, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
