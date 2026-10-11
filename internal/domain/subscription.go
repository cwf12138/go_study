package domain

import "time"

type Subscription struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Name         string    `json:"name"`
	Category     string    `json:"category"`
	AmountCents  int64     `json:"amount_cents"`
	Cycle        string    `json:"cycle"`
	AnchorDate   string    `json:"anchor_date"`
	PaidCycles   int       `json:"paid_cycles"`
	LastPaidDate string    `json:"last_paid_date"`
	State        string    `json:"state"`
	Note         string    `json:"note"`
	Deleted      bool      `json:"deleted"`
	Revision     int       `json:"revision"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
