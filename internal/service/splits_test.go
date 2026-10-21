package service

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func splitFixture() SaveSplitInput {
	return SaveSplitInput{Title: "周末聚餐", Date: "2026-10-21", State: "open", Members: []domain.SplitMember{{ID: "member-alice", Name: "小林"}, {ID: "member-bravo", Name: "小王"}, {ID: "member-cindy", Name: "小陈"}}, Expenses: []domain.SplitExpense{{ID: "expense-dinner", Title: "晚饭", Date: "2026-10-21", PaidBy: "member-alice", AmountCents: 10000, Mode: "equal", Shares: []domain.SplitShare{{MemberID: "member-cindy"}, {MemberID: "member-bravo"}, {MemberID: "member-alice"}}}, {ID: "expense-taxi", Title: "打车", Date: "2026-10-21", PaidBy: "member-bravo", AmountCents: 6000, Mode: "equal", Shares: []domain.SplitShare{{MemberID: "member-bravo"}, {MemberID: "member-cindy"}}}}}
}
func cloneSplitInput(in SaveSplitInput) SaveSplitInput {
	b, _ := json.Marshal(in)
	var out SaveSplitInput
	_ = json.Unmarshal(b, &out)
	return out
}
func TestSplitArithmeticAndConservation(t *testing.T) {
	in, e := NormalizeSplit(splitFixture())
	if e != nil {
		t.Fatal(e)
	}
	if got := in.Expenses[0].Shares; got[0].MemberID != "member-alice" || got[0].AmountCents != 3334 || got[1].AmountCents != 3333 || got[2].AmountCents != 3333 {
		t.Fatal(got)
	}
	report := SplitSummary(domain.SplitGroup{Members: in.Members, Expenses: in.Expenses})
	if report.TotalCents != 16000 || len(report.Transfers) != 2 || report.Balances[0].NetCents != 6666 || report.Balances[1].NetCents != -333 || report.Balances[2].NetCents != -6333 {
		t.Fatal(report)
	}
	rng := rand.New(rand.NewSource(21))
	for iteration := 0; iteration < 500; iteration++ {
		input := splitFixture()
		input.Expenses = nil
		for j := 0; j < 1+rng.Intn(25); j++ {
			expense := splitFixture().Expenses[0]
			expense.ID = "expense-" + time.Unix(int64(j), 0).Format("150405")
			expense.AmountCents = int64(1 + rng.Intn(100000000))
			expense.PaidBy = input.Members[rng.Intn(len(input.Members))].ID
			expense.Shares = nil
			for _, m := range input.Members {
				if rng.Intn(2) == 0 {
					expense.Shares = append(expense.Shares, domain.SplitShare{MemberID: m.ID})
				}
			}
			if len(expense.Shares) == 0 {
				expense.Shares = []domain.SplitShare{{MemberID: input.Members[0].ID}}
			}
			input.Expenses = append(input.Expenses, expense)
		}
		normalized, e := NormalizeSplit(input)
		if e != nil {
			t.Fatal(e)
		}
		r := SplitSummary(domain.SplitGroup{Members: normalized.Members, Expenses: normalized.Expenses})
		net := map[string]int64{}
		var sum int64
		for _, b := range r.Balances {
			net[b.MemberID] = b.NetCents
			sum += b.NetCents
		}
		if sum != 0 || len(r.Transfers) > len(input.Members)-1 {
			t.Fatal(r)
		}
		for _, x := range r.Transfers {
			if x.AmountCents <= 0 || x.From == x.To {
				t.Fatal(x)
			}
			net[x.From] += x.AmountCents
			net[x.To] -= x.AmountCents
		}
		for _, v := range net {
			if v != 0 {
				t.Fatal("money not conserved", r, net)
			}
		}
	}
}
func TestSplitValidation(t *testing.T) {
	mutations := []func(*SaveSplitInput){func(i *SaveSplitInput) { i.Members[1].Name = i.Members[0].Name }, func(i *SaveSplitInput) { i.Members[1].ID = i.Members[0].ID }, func(i *SaveSplitInput) { i.Members = i.Members[:1] }, func(i *SaveSplitInput) { i.Date = "2026-02-30" }, func(i *SaveSplitInput) { i.Expenses[0].PaidBy = "not-in-group" }, func(i *SaveSplitInput) { i.Expenses[0].AmountCents = 0 }, func(i *SaveSplitInput) { i.Expenses[0].AmountCents = 100000001 }, func(i *SaveSplitInput) { i.Expenses[0].Mode = "weighted" }, func(i *SaveSplitInput) { i.Expenses[0].Shares[0].MemberID = "not-in-group" }, func(i *SaveSplitInput) { i.Expenses[0].Shares[0].AmountCents = -1 }, func(i *SaveSplitInput) { i.Expenses[0].Shares = i.Expenses[0].Shares[:0] }, func(i *SaveSplitInput) { i.Expenses[0].Mode = "exact" }, func(i *SaveSplitInput) { i.Expenses[1].ID = i.Expenses[0].ID }, func(i *SaveSplitInput) { i.Expenses = nil; i.State = "settled" }}
	for index, change := range mutations {
		in := cloneSplitInput(splitFixture())
		change(&in)
		if _, e := NormalizeSplit(in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal(index, e)
		}
	}
	in := splitFixture()
	in.Expenses = in.Expenses[:1]
	in.Expenses[0].Mode = "exact"
	in.Expenses[0].Shares = []domain.SplitShare{{MemberID: in.Members[0].ID, AmountCents: 9999}, {MemberID: in.Members[1].ID, AmountCents: 1}}
	if _, e := NormalizeSplit(in); e != nil {
		t.Fatal(e)
	}
	in.Expenses[0].Mode = "equal"
	in.Expenses[0].AmountCents = 1
	in.Expenses[0].Shares = []domain.SplitShare{{MemberID: in.Members[0].ID}, {MemberID: in.Members[1].ID}, {MemberID: in.Members[2].ID}}
	got, e := NormalizeSplit(in)
	if e != nil || got.Expenses[0].Shares[0].AmountCents != 1 || got.Expenses[0].Shares[2].AmountCents != 0 {
		t.Fatal(got, e)
	}
}
func TestSplitStorageRetryIsolationAndSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	in := splitFixture()
	row, e := s.SaveSplit(ctx, "alice", "group-weekend", in)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.SaveSplit(ctx, "alice", row.ID, in)
	if e != nil || !reflect.DeepEqual(row, again) {
		t.Fatal("immutable retry", again, e)
	}
	row.Members[0].Name = "tampered"
	row.Expenses[0].Shares[0].AmountCents = 999
	list, e := s.ListSplits(ctx, "alice")
	if e != nil || list[0].Members[0].Name == "tampered" || list[0].Expenses[0].Shares[0].AmountCents == 999 {
		t.Fatal("aliasing", list, e)
	}
	if rows, e := s.ListSplits(ctx, "bob"); e != nil || len(rows) != 0 {
		t.Fatal(rows, e)
	}
	if _, e := repo.SplitByID(ctx, "bob", row.ID); !errors.Is(e, domain.ErrNotFound) {
		t.Fatal(e)
	}
	in.Revision = 1
	in.State = "settled"
	settled, e := s.SaveSplit(ctx, "alice", row.ID, in)
	if e != nil {
		t.Fatal(e)
	}
	if _, e := s.SaveSplit(ctx, "alice", row.ID, in); e != nil {
		t.Fatal("settlement retry", e)
	}
	in.Revision = 2
	in.Expenses[0].AmountCents++
	if _, e := s.SaveSplit(ctx, "alice", row.ID, in); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal("settled money edit", e)
	}
	in = splitFixture()
	in.Revision = 2
	in.State = "open"
	reopen, e := s.SaveSplit(ctx, "alice", row.ID, in)
	if e != nil || reopen.State != "open" {
		t.Fatal(reopen, e)
	}
	in.Revision = 1
	in.Title = "stale"
	if _, e := s.SaveSplit(ctx, "alice", row.ID, in); !errors.Is(e, domain.ErrConflict) {
		t.Fatal("stale", e)
	}
	in = splitFixture()
	in.Revision = 3
	in.Deleted = true
	deleted, e := s.SaveSplit(ctx, "alice", row.ID, in)
	if e != nil || !deleted.Deleted {
		t.Fatal(deleted, e)
	}
	in.Revision = 4
	in.Title = "edit-trash"
	if _, e := s.SaveSplit(ctx, "alice", row.ID, in); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal(e)
	}
	in.Title = "周末聚餐"
	in.Deleted = false
	restored, e := s.SaveSplit(ctx, "alice", row.ID, in)
	if e != nil || restored.Deleted {
		t.Fatal(restored, e)
	}
	file := filepath.Join(t.TempDir(), "snapshot.json")
	if e := repo.SaveJSON(file); e != nil {
		t.Fatal(e)
	}
	loaded := store.NewMemory()
	if e := loaded.LoadJSON(file); e != nil {
		t.Fatal(e)
	}
	rows, e := loaded.ListSplits(ctx, "alice")
	if e != nil || len(rows) != 1 || rows[0].Revision != 5 {
		t.Fatal(rows, e)
	}
	if settled.State != "settled" {
		t.Fatal(settled)
	}
	if e := repo.CreateUser(ctx, domain.User{ID: "alice", Name: "AA", Email: "aa@example.test"}); e != nil {
		t.Fatal(e)
	}
	data, e := s.ExportUserData(ctx, "alice")
	if e != nil || len(data.Splits) != 1 || data.Counts["splits"] != 1 {
		t.Fatal(data.Splits, e)
	}
}
