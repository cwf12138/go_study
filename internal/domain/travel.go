package domain

import "time"

type TravelStop struct {
	ID             string `json:"id"`
	Date           string `json:"date"`
	Time           string `json:"time"`
	Minutes        int    `json:"minutes"`
	Title          string `json:"title"`
	Location       string `json:"location"`
	Category       string `json:"category"`
	Notes          string `json:"notes"`
	EstimatedCents int64  `json:"estimated_cents"`
	SpentCents     int64  `json:"spent_cents"`
	Done           bool   `json:"done"`
}

type TravelPack struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Category string `json:"category"`
	Quantity int    `json:"quantity"`
	Packed   bool   `json:"packed"`
}

// Dates/times are destination-local wall time, not UTC instants.
// Money is integer CNY cents; array order is the user's itinerary order.
type TravelPlan struct {
	ID          string       `json:"id"`
	UserID      string       `json:"user_id"`
	Title       string       `json:"title"`
	Destination string       `json:"destination"`
	StartDate   string       `json:"start_date"`
	EndDate     string       `json:"end_date"`
	Notes       string       `json:"notes"`
	BudgetCents int64        `json:"budget_cents"`
	Archived    bool         `json:"archived"`
	Stops       []TravelStop `json:"stops"`
	Packing     []TravelPack `json:"packing"`
	Revision    int          `json:"revision"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}
