package domain

import "time"

type ShoppingItem struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Quantity  string    `json:"quantity"`
	Note      string    `json:"note"`
	Frequent  bool      `json:"frequent"`
	Purchased bool      `json:"purchased"`
	Deleted   bool      `json:"deleted"`
	Revision  int       `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
