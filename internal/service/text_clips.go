package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

type SaveTextClipInput struct {
	Title    string `json:"title"`
	Text     string `json:"text"`
	TTLHours int    `json:"ttl_hours"`
	Pinned   bool   `json:"pinned"`
	Deleted  bool   `json:"deleted"`
	Revision int    `json:"revision"`
	Renew    bool   `json:"renew"`
}

func (s *Service) ListTextClips(ctx context.Context, user string) ([]domain.TextClip, error) {
	return s.repo.ListTextClips(ctx, user)
}
func (s *Service) SaveTextClip(ctx context.Context, user, id string, in SaveTextClipInput) (domain.TextClip, error) {
	bad := func(message string) (domain.TextClip, error) {
		return domain.TextClip{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("标识或版本无效")
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Text = strings.ReplaceAll(strings.ReplaceAll(in.Text, "\r\n", "\n"), "\r", "\n")
	if utf8.RuneCountInString(in.Title) > 80 || strings.IndexFunc(in.Title, unicode.IsControl) >= 0 {
		return bad("标题最多 80 字，不能包含控制字符")
	}
	if strings.TrimSpace(in.Text) == "" || utf8.RuneCountInString(in.Text) > 12000 || strings.IndexFunc(in.Text, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }) >= 0 {
		return bad("请填写 1–12000 字文字，可包含换行和制表符")
	}
	switch in.TTLHours {
	case 0, 1, 24, 168:
	default:
		return bad("有效期只能为 1 小时、1 天、7 天或一直保留")
	}
	now := s.now().UTC()
	row := domain.TextClip{ID: id, UserID: user, Title: in.Title, Text: in.Text, TTLHours: in.TTLHours, Pinned: in.Pinned, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}
	if in.TTLHours > 0 {
		row.ExpiresAt = now.Add(time.Duration(in.TTLHours) * time.Hour)
	}
	return s.repo.SaveTextClip(ctx, row, in.Revision, in.Renew)
}
func (s *Service) PurgeTextClip(ctx context.Context, user, id string, revision int) error {
	if !ledgerID.MatchString(id) || revision < 1 || revision > 1000001 {
		return domain.ErrInvalidInput
	}
	return s.repo.PurgeTextClip(ctx, user, id, revision, s.now().UTC())
}
