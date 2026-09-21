package domain

import "time"

// Amount is integer fen (CNY), never a floating-point balance.
type LedgerEntry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Kind      string    `json:"kind"`
	Amount    int64     `json:"amount"`
	Date      string    `json:"date"`
	Category  string    `json:"category"`
	Account   string    `json:"account"`
	Note      string    `json:"note"`
	Archived  bool      `json:"archived"`
	Revision  int       `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
