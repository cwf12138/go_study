package domain

import "time"

type MealIngredient struct {
	Name     string `json:"name"`
	Quantity string `json:"quantity"`
}

// MealEntry is either a recipe or one occurrence in the meal planner.
type MealEntry struct {
	ID          string           `json:"id"`
	UserID      string           `json:"user_id"`
	Kind        string           `json:"kind"`
	Title       string           `json:"title"`
	Category    string           `json:"category"`
	Minutes     int              `json:"minutes"`
	Servings    int              `json:"servings"`
	Ingredients []MealIngredient `json:"ingredients"`
	Steps       []string         `json:"steps"`
	Note        string           `json:"note"`
	Favorite    bool             `json:"favorite"`
	RecipeID    string           `json:"recipe_id"`
	Date        string           `json:"date"`
	Slot        string           `json:"slot"`
	Cooked      bool             `json:"cooked"`
	Deleted     bool             `json:"deleted"`
	Revision    int              `json:"revision"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type MealShoppingResult struct {
	Added    int `json:"added"`
	Existing int `json:"existing"`
}
