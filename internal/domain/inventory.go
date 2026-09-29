package domain

import "time"

// Price is the total purchase cost in integer fen, not a valuation.
type InventoryItem struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Name          string    `json:"name"`
	Category      string    `json:"category"`
	Location      string    `json:"location"`
	Quantity      int       `json:"quantity"`
	Price         int64     `json:"price"`
	PurchasedOn   string    `json:"purchased_on"`
	WarrantyUntil string    `json:"warranty_until"`
	ExpiresOn     string    `json:"expires_on"`
	Borrower      string    `json:"borrower"`
	ReturnOn      string    `json:"return_on"`
	Note          string    `json:"note"`
	Archived      bool      `json:"archived"`
	Revision      int       `json:"revision"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
