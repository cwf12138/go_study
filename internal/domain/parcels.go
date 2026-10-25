package domain

import "time"

type Parcel struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	Title      string    `json:"title"`
	Carrier    string    `json:"carrier"`
	Location   string    `json:"location"`
	PickupCode string    `json:"pickup_code"`
	Tracking   string    `json:"tracking"`
	Deadline   string    `json:"deadline"`
	Note       string    `json:"note"`
	Status     string    `json:"status"`
	Deleted    bool      `json:"deleted"`
	Revision   int       `json:"revision"`
	PickedAt   time.Time `json:"picked_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
