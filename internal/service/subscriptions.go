package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

type SaveSubscriptionInput struct {
	Name         string `json:"name"`
	Category     string `json:"category"`
	AmountCents  int64  `json:"amount_cents"`
	Cycle        string `json:"cycle"`
	AnchorDate   string `json:"anchor_date"`
	PaidCycles   int    `json:"paid_cycles"`
	LastPaidDate string `json:"last_paid_date"`
	State        string `json:"state"`
	Note         string `json:"note"`
	Deleted      bool   `json:"deleted"`
	Revision     int    `json:"revision"`
}

func (s *Service) ListSubscriptions(ctx context.Context, user string) ([]domain.Subscription, error) {
	return s.repo.ListSubscriptions(ctx, user)
}

func subscriptionDate(value string) (time.Time, error) {
	d, err := time.Parse("2006-01-02", value)
	if err != nil || d.Year() < 2000 || d.Year() > 2100 {
		return time.Time{}, fmt.Errorf("日期范围为 2000–2100 年")
	}
	return d, nil
}

// SubscriptionDue computes from the original anchor; it never drifts after a short month.
func SubscriptionDue(anchor, cycle string, n int) (string, error) {
	d, err := subscriptionDate(anchor)
	if err != nil || n < 0 || n > 12000 {
		return "", fmt.Errorf("无效扣费日期或周期数")
	}
	if cycle == "weekly" {
		d = d.AddDate(0, 0, 7*n)
	} else {
		step, ok := map[string]int{"monthly": 1, "quarterly": 3, "yearly": 12}[cycle]
		if !ok {
			return "", fmt.Errorf("请选择有效的扣费周期")
		}
		first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, step*n, 0)
		last := first.AddDate(0, 1, -1).Day()
		day := d.Day()
		if day > last {
			day = last
		}
		d = first.AddDate(0, 0, day-1)
	}
	result := d.Format("2006-01-02")
	_, err = subscriptionDate(result)
	return result, err
}

func (s *Service) SaveSubscription(ctx context.Context, user, id string, in SaveSubscriptionInput) (domain.Subscription, error) {
	bad := func(message string) (domain.Subscription, error) {
		return domain.Subscription{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)
	in.Note = strings.TrimSpace(in.Note)
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("无效标识或版本")
	}
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 80 || utf8.RuneCountInString(in.Category) > 30 || strings.ContainsAny(in.Name+in.Category, "\r\n") || utf8.RuneCountInString(in.Note) > 2000 {
		return bad("请填写名称（最多 80 字）、分类（30 字）与备注（2000 字），名称和分类须为单行")
	}
	if in.Category == "" {
		in.Category = "其他"
	}
	if in.AmountCents < 0 || in.AmountCents > 100000000 {
		return bad("每期金额须为 0–1,000,000 元")
	}
	if in.State != "active" && in.State != "paused" && in.State != "cancelled" {
		return bad("请选择进行中、暂停或已取消")
	}
	if _, err := SubscriptionDue(in.AnchorDate, in.Cycle, in.PaidCycles); err != nil {
		return bad(err.Error())
	}
	if in.LastPaidDate != "" {
		if _, err := subscriptionDate(in.LastPaidDate); err != nil {
			return bad(err.Error())
		}
		if in.LastPaidDate > s.now().In(calendarLocation).Format("2006-01-02") {
			return bad("确认支付日期不能晚于今天")
		}
	}
	now := s.now().UTC()
	return s.repo.SaveSubscription(ctx, domain.Subscription{ID: id, UserID: user, Name: in.Name, Category: in.Category, AmountCents: in.AmountCents, Cycle: in.Cycle, AnchorDate: in.AnchorDate, PaidCycles: in.PaidCycles, LastPaidDate: in.LastPaidDate, State: in.State, Note: in.Note, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
