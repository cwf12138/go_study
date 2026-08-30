package httpapi

import (
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
)

type Server struct {
	service *service.Service
	bus     *event.Bus
	logger  *slog.Logger
	started time.Time
	assets  fs.FS
}

func NewHandler(svc *service.Service, tokens *security.TokenManager, bus *event.Bus, logger *slog.Logger) http.Handler {
	assets, err := frontendFS()
	if err != nil {
		panic("frontend assets are unavailable: " + err.Error())
	}
	s := &Server{service: svc, bus: bus, logger: logger, started: time.Now(), assets: assets}
	root := http.NewServeMux()
	root.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(assets))))
	root.HandleFunc("/", s.home)
	root.HandleFunc("GET /healthz", s.health)
	root.HandleFunc("GET /readyz", s.ready)
	root.HandleFunc("POST /api/v1/auth/register", s.register)
	root.HandleFunc("POST /api/v1/auth/login", s.login)

	private := http.NewServeMux()
	private.HandleFunc("GET /api/v1/me", s.me)
	private.HandleFunc("POST /api/v1/goals", s.createGoal)
	private.HandleFunc("GET /api/v1/goals", s.listGoals)
	private.HandleFunc("DELETE /api/v1/goals/{goal_id}", s.deleteGoal)
	private.HandleFunc("PATCH /api/v1/goals/{goal_id}/status", s.changeGoalStatus)
	private.HandleFunc("GET /api/v1/moods", s.listMoodEntries)
	private.HandleFunc("GET /api/v1/moods/insights", s.moodInsights)
	private.HandleFunc("PUT /api/v1/moods/{date}", s.upsertMoodEntry)
	private.HandleFunc("DELETE /api/v1/moods/{date}", s.deleteMoodEntry)
	private.HandleFunc("POST /api/v1/tasks", s.createTask)
	private.HandleFunc("GET /api/v1/tasks", s.listTasks)
	private.HandleFunc("DELETE /api/v1/tasks/{task_id}", s.deleteTask)
	private.HandleFunc("PATCH /api/v1/tasks/{task_id}/status", s.changeTaskStatus)
	private.HandleFunc("POST /api/v1/todo-lists", s.createTodoList)
	private.HandleFunc("GET /api/v1/todo-lists", s.listTodoLists)
	private.HandleFunc("DELETE /api/v1/todo-lists/{list_id}", s.deleteTodoList)
	private.HandleFunc("POST /api/v1/todos", s.createTodo)
	private.HandleFunc("GET /api/v1/todos", s.listTodos)
	private.HandleFunc("DELETE /api/v1/todos/{todo_id}", s.deleteTodo)
	private.HandleFunc("PATCH /api/v1/todos/{todo_id}/status", s.changeTodoStatus)
	private.HandleFunc("PUT /api/v1/todos/{todo_id}/my-day", s.addTodoToMyDay)
	private.HandleFunc("DELETE /api/v1/todos/{todo_id}/my-day", s.removeTodoFromMyDay)
	private.HandleFunc("PATCH /api/v1/todos/{todo_id}/steps/{step_id}", s.toggleTodoStep)
	private.HandleFunc("POST /api/v1/word-books", s.createWordBook)
	private.HandleFunc("GET /api/v1/word-books", s.listWordBooks)
	private.HandleFunc("POST /api/v1/word-books/{book_id}/words", s.createVocabularyWord)
	private.HandleFunc("GET /api/v1/words", s.listVocabularyWords)
	private.HandleFunc("GET /api/v1/words/queue", s.vocabularyQueue)
	private.HandleFunc("GET /api/v1/vocabulary/overview", s.vocabularyOverview)
	private.HandleFunc("GET /api/v1/vocabulary/catalogs", s.listVocabularyCatalogs)
	private.HandleFunc("POST /api/v1/vocabulary/catalogs/{catalog_id}/import", s.importVocabularyCatalog)
	private.HandleFunc("POST /api/v1/words/{word_id}/reviews", s.reviewVocabularyWord)
	private.HandleFunc("DELETE /api/v1/words/{word_id}", s.deleteVocabularyWord)
	private.HandleFunc("GET /api/v1/planner/preferences", s.plannerPreferences)
	private.HandleFunc("PUT /api/v1/planner/preferences", s.savePlannerPreferences)
	private.HandleFunc("GET /api/v1/planner/week", s.planWeek)
	private.HandleFunc("POST /api/v1/planner/generate", s.generatePlanWeek)
	private.HandleFunc("POST /api/v1/plan-blocks", s.createPlanBlock)
	private.HandleFunc("PATCH /api/v1/plan-blocks/{block_id}", s.updatePlanBlock)
	private.HandleFunc("PATCH /api/v1/plan-blocks/{block_id}/status", s.changePlanBlockStatus)
	private.HandleFunc("DELETE /api/v1/plan-blocks/{block_id}", s.deletePlanBlock)
	private.HandleFunc("POST /api/v1/decks", s.createDeck)
	private.HandleFunc("GET /api/v1/decks", s.listDecks)
	private.HandleFunc("POST /api/v1/decks/{deck_id}/cards", s.createCard)
	private.HandleFunc("GET /api/v1/cards/due", s.dueCards)
	private.HandleFunc("POST /api/v1/cards/{card_id}/reviews", s.reviewCard)
	private.HandleFunc("POST /api/v1/focus-sessions", s.startFocus)
	private.HandleFunc("GET /api/v1/focus-sessions/active", s.activeFocus)
	private.HandleFunc("POST /api/v1/focus-sessions/{session_id}/pause", s.pauseFocus)
	private.HandleFunc("POST /api/v1/focus-sessions/{session_id}/resume", s.resumeFocus)
	private.HandleFunc("POST /api/v1/focus-sessions/{session_id}/advance", s.advanceFocus)
	private.HandleFunc("PATCH /api/v1/focus-sessions/{session_id}/finish", s.finishFocus)
	private.HandleFunc("GET /api/v1/dashboard", s.dashboard)
	private.HandleFunc("GET /api/v1/analytics/learning", s.learningInsights)
	private.HandleFunc("GET /api/v1/reviews/weekly", s.weeklyReview)
	private.HandleFunc("PUT /api/v1/reviews/weekly/reflection", s.saveWeeklyReflection)
	private.HandleFunc("GET /api/v1/reviews/weekly/reflections", s.listWeeklyReflections)
	private.HandleFunc("POST /api/v1/knowledge/notes", s.createKnowledgeNote)
	private.HandleFunc("GET /api/v1/knowledge/notes", s.listKnowledgeNotes)
	private.HandleFunc("GET /api/v1/knowledge/notes/{note_id}", s.knowledgeNote)
	private.HandleFunc("PATCH /api/v1/knowledge/notes/{note_id}", s.updateKnowledgeNote)
	private.HandleFunc("DELETE /api/v1/knowledge/notes/{note_id}", s.deleteKnowledgeNote)
	private.HandleFunc("GET /api/v1/knowledge/graph", s.knowledgeGraph)
	private.HandleFunc("GET /api/v1/exports/data", s.exportUserData)
	private.HandleFunc("GET /api/v1/exports/learning.csv", s.exportLearningCSV)
	private.HandleFunc("GET /api/v1/exports/planner.ics", s.exportPlanCalendar)
	private.HandleFunc("GET /api/v1/events/stream", s.events)
	root.Handle("/api/v1/", authenticate(tokens, private))

	var handler http.Handler = root
	handler = accessLog(logger, handler)
	handler = recoverPanic(logger, handler)
	handler = requestContext(handler)
	handler = securityHeaders(handler)
	return handler
}
