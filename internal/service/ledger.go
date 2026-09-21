package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveLedgerInput struct {
	Kind     string `json:"kind"`
	Amount   int64  `json:"amount"`
	Date     string `json:"date"`
	Category string `json:"category"`
	Account  string `json:"account"`
	Note     string `json:"note"`
	Archived bool   `json:"archived"`
	Revision int    `json:"revision"`
}

var ledgerID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)

func (s *Service) ListLedger(ctx context.Context, user string) ([]domain.LedgerEntry, error) {
	return s.repo.ListLedger(ctx, user)
}
func (s *Service) SaveLedger(ctx context.Context, user, id string, in SaveLedgerInput) (domain.LedgerEntry, error) {
	bad := func(msg string) (domain.LedgerEntry, error) {
		return domain.LedgerEntry{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, msg)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("记录标识或版本无效")
	}
	if in.Kind != "expense" && in.Kind != "income" && in.Kind != "budget" {
		return bad("账目类型无效")
	}
	if in.Amount < 1 || in.Amount > 10000000000 {
		return bad("金额须大于零且不超过一亿元，使用整数分")
	}
	d, err := time.Parse("2006-01-02", in.Date)
	if err != nil || d.Format("2006-01-02") != in.Date || d.Year() < 2000 || d.Year() > 2100 {
		return bad("日期须在 2000–2100 年之间")
	}
	in.Category = strings.TrimSpace(in.Category)
	in.Account = strings.TrimSpace(in.Account)
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Category) > 24 || utf8.RuneCountInString(in.Account) > 24 || utf8.RuneCountInString(in.Note) > 500 {
		return bad("分类和账户最多 24 字，备注最多 500 字")
	}
	if in.Kind == "budget" {
		if id != "budget-"+in.Date[:7] || d.Day() != 1 {
			return bad("每月预算必须使用固定月份标识")
		}
		in.Category = ""
		in.Account = ""
		in.Note = ""
	} else {
		if strings.HasPrefix(id, "budget-") || in.Category == "" || in.Account == "" {
			return bad("请填写分类与账户，账目不得使用预算标识")
		}
	}
	now := s.now().UTC()
	return s.repo.SaveLedger(ctx, domain.LedgerEntry{ID: id, UserID: user, Kind: in.Kind, Amount: in.Amount, Date: in.Date, Category: in.Category, Account: in.Account, Note: in.Note, Archived: in.Archived, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
