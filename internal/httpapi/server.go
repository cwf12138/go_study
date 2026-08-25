package httpapi

import (
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
}

func NewHandler(svc *service.Service, tokens *security.TokenManager, bus *event.Bus, logger *slog.Logger) http.Handler {
	s := &Server{service: svc, bus: bus, logger: logger, started: time.Now()}
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", s.health)
	root.HandleFunc("GET /readyz", s.ready)
	root.HandleFunc("POST /api/v1/auth/register", s.register)
	root.HandleFunc("POST /api/v1/auth/login", s.login)

	private := http.NewServeMux()
	private.HandleFunc("GET /api/v1/me", s.me)
	private.HandleFunc("POST /api/v1/goals", s.createGoal)
	private.HandleFunc("GET /api/v1/goals", s.listGoals)
	private.HandleFunc("PATCH /api/v1/goals/{goal_id}/status", s.changeGoalStatus)
	private.HandleFunc("POST /api/v1/tasks", s.createTask)
	private.HandleFunc("GET /api/v1/tasks", s.listTasks)
	private.HandleFunc("PATCH /api/v1/tasks/{task_id}/status", s.changeTaskStatus)
	private.HandleFunc("POST /api/v1/decks", s.createDeck)
	private.HandleFunc("GET /api/v1/decks", s.listDecks)
	private.HandleFunc("POST /api/v1/decks/{deck_id}/cards", s.createCard)
	private.HandleFunc("GET /api/v1/cards/due", s.dueCards)
	private.HandleFunc("POST /api/v1/cards/{card_id}/reviews", s.reviewCard)
	private.HandleFunc("POST /api/v1/focus-sessions", s.startFocus)
	private.HandleFunc("PATCH /api/v1/focus-sessions/{session_id}/finish", s.finishFocus)
	private.HandleFunc("GET /api/v1/dashboard", s.dashboard)
	private.HandleFunc("GET /api/v1/events/stream", s.events)
	root.Handle("/api/v1/", authenticate(tokens, private))

	var handler http.Handler = root
	handler = accessLog(logger, handler)
	handler = recoverPanic(logger, handler)
	handler = requestContext(handler)
	handler = securityHeaders(handler)
	return handler
}
