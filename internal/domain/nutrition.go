package domain

import "time"

// NutritionCard is an original meal assembly suggestion, not a nutrient analysis.
type NutritionPart struct {
	Role string `json:"role"`
	Text string `json:"text"`
}
type NutritionCard struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Slots     []string        `json:"slots"`
	Channels  []string        `json:"channels"`
	Goals     []string        `json:"goals"`
	PlantOnly bool            `json:"plant_only"`
	Allergens []string        `json:"allergens"`
	Parts     []NutritionPart `json:"parts"`
	Reason    string          `json:"reason"`
	Tip       string          `json:"tip"`
}
type NutritionPreferences struct {
	Goal      string   `json:"goal"`
	Channel   string   `json:"channel"`
	Slot      string   `json:"slot"`
	PlantOnly bool     `json:"plant_only"`
	Avoid     []string `json:"avoid"`
	Exclude   string   `json:"exclude"`
}
type NutritionEntry struct {
	ID          string                `json:"id"`
	UserID      string                `json:"user_id"`
	Kind        string                `json:"kind"`
	CardID      string                `json:"card_id"`
	Card        *NutritionCard        `json:"card,omitempty"`
	Preferences *NutritionPreferences `json:"preferences,omitempty"`
	Date        string                `json:"date"`
	Slot        string                `json:"slot"`
	State       string                `json:"state"`
	Note        string                `json:"note"`
	Deleted     bool                  `json:"deleted"`
	Revision    int                   `json:"revision"`
	CreatedAt   time.Time             `json:"created_at"`
	UpdatedAt   time.Time             `json:"updated_at"`
}
