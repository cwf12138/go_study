package domain

import "time"

type BoardPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type BoardNode struct {
	ID       string       `json:"id"`
	Kind     string       `json:"kind"`
	X        float64      `json:"x"`
	Y        float64      `json:"y"`
	W        float64      `json:"w"`
	H        float64      `json:"h"`
	Color    string       `json:"color"`
	Text     string       `json:"text"`
	FontSize int          `json:"font_size"`
	Points   []BoardPoint `json:"points"`
}
type Whiteboard struct {
	ID        string      `json:"id"`
	UserID    string      `json:"user_id"`
	Title     string      `json:"title"`
	Nodes     []BoardNode `json:"nodes"`
	Deleted   bool        `json:"deleted"`
	Revision  int         `json:"revision"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}
