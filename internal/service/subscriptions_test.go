package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestSubscriptionDue(t *testing.T) {
	for _, test := range []struct {
		anchor, cycle string
		n             int
		want          string
	}{
		{"2026-01-31", "monthly", 1, "2026-02-28"}, {"2026-01-31", "monthly", 2, "2026-03-31"},
		{"2024-02-29", "yearly", 1, "2025-02-28"}, {"2024-02-29", "yearly", 4, "2028-02-29"},
		{"2026-11-30", "quarterly", 1, "2027-02-28"}, {"2026-11-30", "quarterly", 2, "2027-05-30"},
		{"2026-12-28", "weekly", 1, "2027-01-04"}, {"2026-10-11", "monthly", 0, "2026-10-11"},
	} {
		got, err := SubscriptionDue(test.anchor, test.cycle, test.n)
		if err != nil || got != test.want {
			t.Fatalf("%+v: got %s/%v", test, got, err)
		}
	}
	for _, test := range []struct {
		date, cycle string
		n           int
	}{{"2026-02-29", "monthly", 0}, {"2100-12-31", "monthly", 1}, {"2026-10-11", "x", 0}, {"2026-10-11", "weekly", -1}} {
		if _, err := SubscriptionDue(test.date, test.cycle, test.n); err == nil {
			t.Fatalf("accepted %+v", test)
		}
	}
}

func TestSubscriptionLifecycleAndSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 10, 11, 5, 0, 0, 0, time.UTC) }
	in := SaveSubscriptionInput{Name: "云空间", Category: "软件", AmountCents: 1800, Cycle: "monthly", AnchorDate: "2026-09-30", State: "active"}
	first, err := svc.SaveSubscription(ctx, "alice", "subscribe-01", in)
	if err != nil || first.Revision != 1 {
		t.Fatal(first, err)
	}
	retry, err := svc.SaveSubscription(ctx, "alice", first.ID, in)
	if err != nil || retry != first {
		t.Fatal("retry", retry, err)
	}
	rows, _ := svc.ListSubscriptions(ctx, "bob")
	if len(rows) != 0 {
		t.Fatal("account leak")
	}
	if _, err = svc.SaveSubscription(ctx, "bob", first.ID, in); err != nil {
		t.Fatal(err)
	}
	in.Revision = 1
	in.PaidCycles = 1
	in.LastPaidDate = "2026-10-11"
	paid, err := svc.SaveSubscription(ctx, "alice", first.ID, in)
	if err != nil || paid.Revision != 2 {
		t.Fatal(paid, err)
	}
	retry, err = svc.SaveSubscription(ctx, "alice", first.ID, in)
	if err != nil || retry != paid {
		t.Fatal("paid retry", retry, err)
	}
	in.Note = "stale editor"
	if _, err = svc.SaveSubscription(ctx, "alice", first.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("conflict", err)
	}
	in.Revision = 2
	in.Deleted = true
	deleted, err := svc.SaveSubscription(ctx, "alice", first.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "subscriptions.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	rows, _ = loaded.ListSubscriptions(ctx, "alice")
	if len(rows) != 1 || rows[0] != deleted {
		t.Fatal("snapshot", rows)
	}
	in.Revision = 3
	in.Deleted = false
	in.State = "paused"
	row, err := New(loaded, nil, nil).SaveSubscription(ctx, "alice", first.ID, in)
	if err != nil || row.Deleted || row.State != "paused" || row.CreatedAt != first.CreatedAt {
		t.Fatal("restore", row, err)
	}
	if err = repo.CreateUser(ctx, domain.User{ID: "alice", Name: "A", Email: "a@example.com"}); err != nil {
		t.Fatal(err)
	}
	data, err := svc.ExportUserData(ctx, "alice")
	if err != nil || len(data.Subscriptions) != 1 || data.Counts["subscriptions"] != 1 {
		t.Fatal("export", data.Counts, err)
	}
}

func TestSubscriptionValidation(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC) }
	valid := SaveSubscriptionInput{Name: "Music", AmountCents: 1000, Cycle: "monthly", AnchorDate: "2026-10-11", State: "active"}
	for _, change := range []func(*SaveSubscriptionInput){func(v *SaveSubscriptionInput) { v.Name = "" }, func(v *SaveSubscriptionInput) { v.AmountCents = -1 }, func(v *SaveSubscriptionInput) { v.AmountCents = 100000001 }, func(v *SaveSubscriptionInput) { v.Cycle = "daily" }, func(v *SaveSubscriptionInput) { v.State = "unknown" }, func(v *SaveSubscriptionInput) { v.AnchorDate = "2026-02-30" }, func(v *SaveSubscriptionInput) { v.PaidCycles = -1 }, func(v *SaveSubscriptionInput) { v.LastPaidDate = "2026-10-12" }, func(v *SaveSubscriptionInput) { v.Revision = -1 }} {
		in := valid
		change(&in)
		if _, err := svc.SaveSubscription(context.Background(), "u", "subscribe-01", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("accepted", in, err)
		}
	}
}
