package domain

import "time"

type SplitMember struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type SplitShare struct {
	MemberID    string `json:"member_id"`
	AmountCents int64  `json:"amount_cents"`
}
type SplitExpense struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Date        string       `json:"date"`
	PaidBy      string       `json:"paid_by"`
	AmountCents int64        `json:"amount_cents"`
	Mode        string       `json:"mode"`
	Shares      []SplitShare `json:"shares"`
}
type SplitGroup struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	Title     string         `json:"title"`
	Date      string         `json:"date"`
	Note      string         `json:"note"`
	Members   []SplitMember  `json:"members"`
	Expenses  []SplitExpense `json:"expenses"`
	State     string         `json:"state"`
	Deleted   bool           `json:"deleted"`
	Revision  int            `json:"revision"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}
type SplitBalance struct {
	MemberID   string `json:"member_id"`
	PaidCents  int64  `json:"paid_cents"`
	ShareCents int64  `json:"share_cents"`
	NetCents   int64  `json:"net_cents"`
}
type SplitTransfer struct {
	From        string `json:"from"`
	To          string `json:"to"`
	AmountCents int64  `json:"amount_cents"`
}
type SplitReport struct {
	TotalCents int64           `json:"total_cents"`
	Balances   []SplitBalance  `json:"balances"`
	Transfers  []SplitTransfer `json:"transfers"`
}
type SplitView struct {
	SplitGroup
	Report SplitReport `json:"report"`
}
