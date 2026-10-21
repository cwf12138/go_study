package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

type SaveSplitInput struct {
	Title    string                `json:"title"`
	Date     string                `json:"date"`
	Note     string                `json:"note"`
	Members  []domain.SplitMember  `json:"members"`
	Expenses []domain.SplitExpense `json:"expenses"`
	State    string                `json:"state"`
	Deleted  bool                  `json:"deleted"`
	Revision int                   `json:"revision"`
}

func splitBad(message string) error { return fmt.Errorf("%w: %s", domain.ErrInvalidInput, message) }

func splitText(value string, max int, required, multiline bool) bool {
	if !utf8.ValidString(value) || !fitnessText(value, max, required) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\r' || r == '\t')) {
			return false
		}
	}
	return true
}

// NormalizeSplit uses integer cents exclusively. Remainders go to eligible
// members in group order, not request order, so retries produce identical shares.
func NormalizeSplit(in SaveSplitInput) (SaveSplitInput, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	if !splitText(in.Title, 80, true, false) || !splitText(in.Note, 1000, false, true) || in.Revision < 0 || in.Revision > 1000000 {
		return in, splitBad("名称限 80 字，备注限 1000 字，请检查版本")
	}
	if _, e := subscriptionDate(in.Date); e != nil {
		return in, splitBad("请选择有效的账单日期（2000–2100 年）")
	}
	if in.State != "open" && in.State != "settled" {
		return in, splitBad("不支持的账单状态")
	}
	if len(in.Members) < 2 || len(in.Members) > 20 || len(in.Expenses) > 100 {
		return in, splitBad("每个账单支持 2–20 人、最多 100 笔费用")
	}
	in.Members = append([]domain.SplitMember{}, in.Members...)
	members := map[string]bool{}
	names := map[string]bool{}
	for i, m := range in.Members {
		m.Name = strings.TrimSpace(m.Name)
		lower := strings.ToLower(m.Name)
		if !ledgerID.MatchString(m.ID) || members[m.ID] || !splitText(m.Name, 30, true, false) || names[lower] {
			return in, splitBad("成员名称须唯一且不超过 30 字，标识不能重复")
		}
		members[m.ID] = true
		names[lower] = true
		in.Members[i] = m
	}
	in.Expenses = append([]domain.SplitExpense{}, in.Expenses...)
	ids := map[string]bool{}
	for i, expense := range in.Expenses {
		expense.Title = strings.TrimSpace(expense.Title)
		if !ledgerID.MatchString(expense.ID) || ids[expense.ID] || !splitText(expense.Title, 80, true, false) || !members[expense.PaidBy] || expense.AmountCents < 1 || expense.AmountCents > 100000000 || (expense.Mode != "equal" && expense.Mode != "exact") || len(expense.Shares) < 1 || len(expense.Shares) > len(members) {
			return in, splitBad("请检查费用名称、付款人、金额（0.01–1,000,000 元）与分摊方式")
		}
		if _, e := subscriptionDate(expense.Date); e != nil {
			return in, splitBad("费用日期无效")
		}
		ids[expense.ID] = true
		shares := map[string]int64{}
		var total int64
		for _, share := range expense.Shares {
			if _, exists := shares[share.MemberID]; exists || !members[share.MemberID] || share.AmountCents < 0 || share.AmountCents > 100000000 {
				return in, splitBad("分摊成员或金额无效，不能重复选择成员")
			}
			shares[share.MemberID] = share.AmountCents
			total += share.AmountCents
		}
		if expense.Mode == "exact" && total != expense.AmountCents {
			return in, splitBad("自定义分摊之和必须等于这笔费用金额")
		}
		out := []domain.SplitShare{}
		remainder := expense.AmountCents % int64(len(shares))
		for _, m := range in.Members {
			if amount, ok := shares[m.ID]; ok {
				if expense.Mode == "equal" {
					amount = expense.AmountCents / int64(len(shares))
					if remainder > 0 {
						amount++
						remainder--
					}
				}
				out = append(out, domain.SplitShare{MemberID: m.ID, AmountCents: amount})
			}
		}
		expense.Shares = out
		in.Expenses[i] = expense
	}
	if in.State == "settled" && len(in.Expenses) == 0 {
		return in, splitBad("空账单无需结清，先记一笔费用吧")
	}
	return in, nil
}

// SplitSummary is a deterministic greedy netting plan, not a claim of a
// globally minimal transfer count. It conserves every cent, using <= n-1 edges.
func SplitSummary(row domain.SplitGroup) domain.SplitReport {
	report := domain.SplitReport{Balances: []domain.SplitBalance{}, Transfers: []domain.SplitTransfer{}}
	index := map[string]int{}
	for i, m := range row.Members {
		index[m.ID] = i
		report.Balances = append(report.Balances, domain.SplitBalance{MemberID: m.ID})
	}
	for _, e := range row.Expenses {
		report.TotalCents += e.AmountCents
		report.Balances[index[e.PaidBy]].PaidCents += e.AmountCents
		for _, share := range e.Shares {
			report.Balances[index[share.MemberID]].ShareCents += share.AmountCents
		}
	}
	type party struct {
		id     string
		amount int64
	}
	debtors, creditors := []party{}, []party{}
	for i := range report.Balances {
		b := &report.Balances[i]
		b.NetCents = b.PaidCents - b.ShareCents
		if b.NetCents > 0 {
			creditors = append(creditors, party{b.MemberID, b.NetCents})
		} else if b.NetCents < 0 {
			debtors = append(debtors, party{b.MemberID, -b.NetCents})
		}
	}
	for _, list := range [][]party{debtors, creditors} {
		sort.SliceStable(list, func(i, j int) bool { return list[i].amount > list[j].amount })
	}
	for i, j := 0, 0; i < len(debtors) && j < len(creditors); {
		amount := debtors[i].amount
		if creditors[j].amount < amount {
			amount = creditors[j].amount
		}
		report.Transfers = append(report.Transfers, domain.SplitTransfer{From: debtors[i].id, To: creditors[j].id, AmountCents: amount})
		debtors[i].amount -= amount
		creditors[j].amount -= amount
		if debtors[i].amount == 0 {
			i++
		}
		if creditors[j].amount == 0 {
			j++
		}
	}
	return report
}
func (s *Service) ListSplits(ctx context.Context, user string) ([]domain.SplitView, error) {
	rows, e := s.repo.ListSplits(ctx, user)
	if e != nil {
		return nil, e
	}
	out := []domain.SplitView{}
	for _, row := range rows {
		out = append(out, domain.SplitView{SplitGroup: row, Report: SplitSummary(row)})
	}
	return out, nil
}
func (s *Service) SaveSplit(ctx context.Context, user, id string, in SaveSplitInput) (domain.SplitView, error) {
	var zero domain.SplitView
	if user == "" || !ledgerID.MatchString(id) {
		return zero, splitBad("无效账单标识")
	}
	in, e := NormalizeSplit(in)
	if e != nil {
		return zero, e
	}
	now := s.now().UTC()
	old, e := s.repo.SplitByID(ctx, user, id)
	if e != nil && !errors.Is(e, domain.ErrNotFound) {
		return zero, e
	}
	if errors.Is(e, domain.ErrNotFound) {
		if in.Revision != 0 {
			return zero, domain.ErrNotFound
		}
		if in.Deleted || in.State != "open" {
			return zero, splitBad("新账单必须处于未结清状态")
		}
		old = domain.SplitGroup{CreatedAt: now}
	}
	sameMoney := reflect.DeepEqual(old.Members, in.Members) && reflect.DeepEqual(old.Expenses, in.Expenses)
	samePayload := sameMoney && old.Title == in.Title && old.Date == in.Date && old.Note == in.Note && old.State == in.State && old.Deleted == in.Deleted
	if old.Revision != 0 && old.Revision != in.Revision && !(old.Revision == in.Revision+1 && samePayload) {
		return zero, fmt.Errorf("%w: 账单已更新，请先核对最新版本", domain.ErrConflict)
	}
	if old.Deleted && (!sameMoney || old.Title != in.Title || old.Date != in.Date || old.Note != in.Note || old.State != in.State) {
		return zero, splitBad("请先恢复回收站中的账单，再进行修改")
	}
	if old.State == "settled" && !sameMoney {
		return zero, splitBad("请先重新打开已结清账单，再修改成员或费用")
	}
	row := domain.SplitGroup{ID: id, UserID: user, Title: in.Title, Date: in.Date, Note: in.Note, Members: in.Members, Expenses: in.Expenses, State: in.State, Deleted: in.Deleted, CreatedAt: old.CreatedAt, UpdatedAt: now}
	saved, e := s.repo.SaveSplit(ctx, row, in.Revision)
	if e != nil {
		return zero, e
	}
	return domain.SplitView{SplitGroup: saved, Report: SplitSummary(saved)}, nil
}
