package store

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"
)

// SnapshotInspection is an offline structural check, not a complete validation of
// every module's business rules. It does not load, migrate, recover or write data.
type SnapshotInspection struct {
	Version           int            `json:"version"`
	SavedAt           time.Time      `json:"saved_at"`
	Accounts          int            `json:"accounts"`
	Records           map[string]int `json:"records"`
	MissingReferences int            `json:"missing_references"`
	UserIDs           []string       `json:"-"` // Only used to check private attachment ownership.
}

func InspectSnapshot(data []byte) (SnapshotInspection, error) {
	s, err := decodeSnapshot(data)
	if err != nil {
		return SnapshotInspection{}, errors.New("invalid or unsupported snapshot")
	}
	if s.SavedAt.IsZero() {
		return SnapshotInspection{}, errors.New("snapshot has no save timestamp")
	}
	out := SnapshotInspection{Version: s.Version, SavedAt: s.SavedAt, Accounts: len(s.Users), Records: map[string]int{}}
	users, emails := map[string]bool{}, map[string]bool{}
	for _, u := range s.Users {
		email := strings.ToLower(strings.TrimSpace(u.Email))
		if u.ID == "" || users[u.ID] || email == "" || emails[email] || u.PasswordHash == "" {
			return SnapshotInspection{}, errors.New("snapshot has missing or duplicate account identity/credentials")
		}
		users[u.ID], emails[email] = true, true
		out.UserIDs = append(out.UserIDs, u.ID)
	}
	// Reflection deliberately walks the typed snapshot, so new collections with
	// UserID/ID fields automatically receive ownership/duplicate checks.
	value := reflect.ValueOf(s)
	owners := map[string]map[string]string{}
	scoped := map[string]bool{}
	for _, name := range []string{"TextClips", "Parcels", "ImportantDays", "Bookmarks", "Subscriptions", "Meals", "Fitness", "Care", "Splits", "Whiteboards", "Nutrition", "Shopping", "Inventory", "TravelPlans", "Projects", "Ledger"} {
		scoped[name] = true
	}
	for i := 0; i < value.NumField(); i++ {
		rows := value.Field(i)
		if rows.Kind() != reflect.Slice || value.Type().Field(i).Name == "Users" {
			continue
		}
		name := value.Type().Field(i).Name
		out.Records[strings.Split(value.Type().Field(i).Tag.Get("json"), ",")[0]] = rows.Len()
		owners[name] = map[string]string{}
		for j := 0; j < rows.Len(); j++ {
			row := rows.Index(j)
			user := row.FieldByName("UserID")
			if !user.IsValid() || !users[user.String()] {
				return SnapshotInspection{}, fmt.Errorf("snapshot %s contains an unknown owner", name)
			}
			key := ""
			if id := row.FieldByName("ID"); id.IsValid() {
				if id.String() == "" {
					return SnapshotInspection{}, fmt.Errorf("snapshot %s contains a missing or duplicate ID", name)
				}
				key = id.String()
				if scoped[name] {
					key = user.String() + ":" + key
				}
			}
			// Match the actual repository's natural keys, including collections
			// without IDs, so a restore cannot silently collapse distinct rows.
			switch name {
			case "PlannerPrefs":
				key = user.String()
			case "Moods":
				key = moodKey(user.String(), row.FieldByName("Date").String())
			case "PlannerReports":
				key = plannerReportKey(user.String(), row.FieldByName("WeekStart").String())
			case "WeeklyReflections":
				key = weeklyReflectionKey(user.String(), row.FieldByName("WeekStart").String())
			case "ClassicalStudies":
				key = classicalStudyKey(user.String(), row.FieldByName("WorkID").String())
			}
			if key == "" || owners[name][key] != "" {
				return SnapshotInspection{}, fmt.Errorf("snapshot %s contains a duplicate storage key", name)
			}
			owners[name][key] = user.String()
		}
	}
	for _, ref := range []struct{ from, field, to string }{
		{"Tasks", "GoalID", "Goals"}, {"Todos", "ListID", "TodoLists"},
		{"MemoNotes", "FolderID", "MemoFolders"}, {"Words", "BookID", "WordBooks"},
		{"ActionLinks", "MemoID", "MemoNotes"}, {"ActionLinks", "TodoID", "Todos"},
		{"Todos", "MemoActionID", "ActionLinks"}, {"Sessions", "TodoID", "Todos"}, {"Sessions", "MemoActionID", "ActionLinks"},
		{"WordReviews", "WordID", "Words"}, {"Sessions", "TaskID", "Tasks"},
		{"Sessions", "PlanBlockID", "PlanBlocks"},
	} {
		rows := value.FieldByName(ref.from)
		for i := 0; i < rows.Len(); i++ {
			row := rows.Index(i)
			id := row.FieldByName(ref.field).String()
			if id == "" {
				continue
			}
			owner := owners[ref.to][id]
			if owner == "" {
				out.MissingReferences++ // Historical records can outlive deleted targets.
			} else if owner != row.FieldByName("UserID").String() {
				return SnapshotInspection{}, errors.New("snapshot contains a cross-account reference")
			}
		}
	}
	return out, nil
}
