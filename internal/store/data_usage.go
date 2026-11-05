package store

import (
	"context"
	"reflect"

	"github.com/example/studyflow/internal/domain"
)

type CollectionUsage struct {
	Key          string `json:"key"`
	Count        int    `json:"count"`
	PersonalJSON bool   `json:"personal_json"`
}

type AccountUsage struct {
	Objects     int               `json:"objects"`
	Collections []CollectionUsage `json:"collections"`
}

type usageSource struct {
	key          string
	rows         any
	personalJSON bool
}

// Explicit registry: account counts do not read snapshot files, serialize note
// bodies, initialize defaults, or include another user's records. Caller holds mu.
func (m *Memory) usageSources() []usageSource {
	return []usageSource{
		{"memos", m.memoNotes, true}, {"memo_folders", m.memoFolders, true},
		{"action_links", m.actionLinks, true},
		{"todo_imports", m.todoImports, true}, {"calendar_commands", m.calendarCommands, true},
		{"todos", m.todos, true}, {"todo_lists", m.todoLists, true}, {"calendar_events", m.calendarEvents, true}, {"important_days", m.importantDays, true},
		{"text_clips", m.textClips, true}, {"parcels", m.parcels, true}, {"inventory", m.inventory, true}, {"shopping", m.shopping, true}, {"bookmarks", m.bookmarks, true},
		{"subscriptions", m.subscriptions, true}, {"ledger", m.ledger, true}, {"meals", m.meals, true},
		{"moods", m.moods, true}, {"focus_sessions", m.sessions, true}, {"fitness", m.fitness, true}, {"nutrition", m.nutrition, true}, {"care", m.care, true}, {"habits", m.habits, true},
		{"goals", m.goals, true}, {"tasks", m.tasks, true}, {"word_books", m.wordBooks, true}, {"vocabulary_words", m.words, true}, {"vocabulary_reviews", m.wordReviews, true},
		{"planner_preferences", m.plannerPrefs, true}, {"plan_blocks", m.planBlocks, true}, {"planner_reports", m.plannerReports, true}, {"weekly_reflections", m.weeklyReflections, true},
		{"english_readings", m.englishReadings, true}, {"ebook_readings", m.ebookReadings, true}, {"classical_studies", m.classicalStudies, true},
		{"explorations", m.explorations, true}, {"keepsakes", m.keepsakes, true},
		{"projects", m.projects, true}, {"travel_plans", m.travelPlans, true}, {"splits", m.splits, true}, {"whiteboards", m.whiteboards, true}, {"knowledge_notes", m.knowledgeNotes, false},
	}
}

func (m *Memory) AccountUsage(ctx context.Context, user string) (AccountUsage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.users[user]; !ok {
		return AccountUsage{}, domain.ErrNotFound
	}
	out := AccountUsage{Collections: []CollectionUsage{}}
	for _, s := range m.usageSources() {
		if err := ctx.Err(); err != nil {
			return AccountUsage{}, err
		}
		n := 0
		seen := 0
		rows := reflect.ValueOf(s.rows).MapRange()
		for rows.Next() {
			seen++
			if seen%256 == 0 {
				if err := ctx.Err(); err != nil {
					return AccountUsage{}, err
				}
			}
			// Only inspect the exported owner field of typed domain records.
			// No Interface/JSON conversion of record content is performed.
			if rows.Value().FieldByName("UserID").String() == user {
				n++
			}
		}
		out.Collections = append(out.Collections, CollectionUsage{Key: s.key, Count: n, PersonalJSON: s.personalJSON})
		out.Objects += n
	}
	return out, nil
}
