package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestRegisterCreateGoalAndAuthorization(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repository, tokens, bus)
	handler := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Ada", "email": "ada@example.com", "password": "safe-password-123",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(register.Body.Bytes(), &auth); err != nil || auth.Data.Token == "" {
		t.Fatalf("decode auth response: %v, body = %s", err, register.Body.String())
	}

	goal := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{"title": "Learn concurrency"})
	if goal.Code != http.StatusCreated {
		t.Fatalf("create goal status = %d, body = %s", goal.Code, goal.Body.String())
	}
	unauthorized := performJSON(t, handler, http.MethodGet, "/api/v1/goals", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/goals", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "Learn concurrency") {
		t.Fatalf("list goals status = %d, body = %s", list.Code, list.Body.String())
	}
	focus := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions", auth.Data.Token, map[string]any{
		"planned_minutes": 25,
	})
	if focus.Code != http.StatusCreated {
		t.Fatalf("start focus status = %d, body = %s", focus.Code, focus.Body.String())
	}
	var startedFocus struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(focus.Body.Bytes(), &startedFocus); err != nil || startedFocus.Data.ID == "" {
		t.Fatalf("decode focus response: %v, body = %s", err, focus.Body.String())
	}
	active := performJSON(t, handler, http.MethodGet, "/api/v1/focus-sessions/active", auth.Data.Token, nil)
	if active.Code != http.StatusOK || !strings.Contains(active.Body.String(), "\"status\":\"running\"") {
		t.Fatalf("active focus status = %d, body = %s", active.Code, active.Body.String())
	}
	secondFocus := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions", auth.Data.Token, map[string]any{
		"planned_minutes": 15,
	})
	if secondFocus.Code != http.StatusConflict {
		t.Fatalf("second focus status = %d, want %d", secondFocus.Code, http.StatusConflict)
	}
	paused := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions/"+startedFocus.Data.ID+"/pause", auth.Data.Token, nil)
	if paused.Code != http.StatusOK || !strings.Contains(paused.Body.String(), "\"status\":\"paused\"") {
		t.Fatalf("pause focus status = %d, body = %s", paused.Code, paused.Body.String())
	}
	resumed := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions/"+startedFocus.Data.ID+"/resume", auth.Data.Token, nil)
	if resumed.Code != http.StatusOK || !strings.Contains(resumed.Body.String(), "\"status\":\"running\"") {
		t.Fatalf("resume focus status = %d, body = %s", resumed.Code, resumed.Body.String())
	}
}

func TestListGoalsSupportsPaginationFilteringAndSorting(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("integration-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repository, tokens, bus)
	handler := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Lin", "email": "lin@example.com", "password": "safe-password-123",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(register.Body.Bytes(), &auth); err != nil {
		t.Fatalf("decode auth response: %v", err)
	}

	createGoal := func(title string) struct {
		ID        string    `json:"id"`
		CreatedAt time.Time `json:"created_at"`
	} {
		t.Helper()
		response := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{"title": title})
		if response.Code != http.StatusCreated {
			t.Fatalf("create %q status = %d, body = %s", title, response.Code, response.Body.String())
		}
		var created struct {
			Data struct {
				ID        string    `json:"id"`
				CreatedAt time.Time `json:"created_at"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode created goal: %v", err)
		}
		if created.Data.ID == "" || created.Data.CreatedAt.IsZero() {
			t.Fatalf("created goal is missing id or created_at: %s", response.Body.String())
		}
		return created.Data
	}

	alpha := createGoal("Alpha")
	_ = createGoal("Zebra")
	done := createGoal("Completed target")
	changeStatus := performJSON(t, handler, http.MethodPatch, "/api/v1/goals/"+done.ID+"/status", auth.Data.Token, map[string]any{"status": "completed"})
	if changeStatus.Code != http.StatusOK {
		t.Fatalf("complete goal status = %d, body = %s", changeStatus.Code, changeStatus.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/goals?status=active&sort=title&order=asc&page=1&page_size=1", auth.Data.Token, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list goals status = %d, body = %s", list.Code, list.Body.String())
	}
	var page struct {
		Data []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"data"`
		Meta struct {
			Count      int `json:"count"`
			Total      int `json:"total"`
			Page       int `json:"page"`
			PageSize   int `json:"page_size"`
			TotalPages int `json:"total_pages"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode paged goals: %v", err)
	}
	if len(page.Data) != 1 || page.Data[0].ID != alpha.ID || page.Data[0].Title != "Alpha" {
		t.Fatalf("unexpected first page data: %#v", page.Data)
	}
	if strings.Contains(list.Body.String(), "\"target_minutes\"") || strings.Contains(list.Body.String(), "\"progress\"") {
		t.Fatalf("goal list exposes removed progress fields: %s", list.Body.String())
	}
	if page.Meta.Count != 1 || page.Meta.Total != 2 || page.Meta.Page != 1 || page.Meta.PageSize != 1 || page.Meta.TotalPages != 2 {
		t.Fatalf("unexpected pagination metadata: %#v", page.Meta)
	}

	invalidSort := performJSON(t, handler, http.MethodGet, "/api/v1/goals?sort=priority", auth.Data.Token, nil)
	if invalidSort.Code != http.StatusBadRequest {
		t.Fatalf("invalid sort status = %d, want %d", invalidSort.Code, http.StatusBadRequest)
	}
}

func TestGoalCanBeDeletedByItsOwner(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("goal-delete-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Goal owner", "email": "goal-owner@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register goal owner failed: status = %d, body = %s", register.Code, register.Body.String())
	}
	created := performJSON(t, handler, http.MethodPost, "/api/v1/goals", auth.Data.Token, map[string]any{"title": "Remove this goal"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create goal status = %d, body = %s", created.Code, created.Body.String())
	}
	var goal struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &goal); err != nil || goal.Data.ID == "" {
		t.Fatalf("decode created goal: %v, body = %s", err, created.Body.String())
	}

	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/goals/"+goal.Data.ID, auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete goal status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/goals", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "\"total\":0") {
		t.Fatalf("list after delete status = %d, body = %s", list.Code, list.Body.String())
	}
	deletedAgain := performJSON(t, handler, http.MethodDelete, "/api/v1/goals/"+goal.Data.ID, auth.Data.Token, nil)
	if deletedAgain.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want %d", deletedAgain.Code, http.StatusNotFound)
	}
}

func TestTodoWorkflowSupportsMyDayStepsAndRecurringCompletion(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("todo-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Todo learner", "email": "todo@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register todo user failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	lists := performJSON(t, handler, http.MethodGet, "/api/v1/todo-lists", auth.Data.Token, nil)
	if lists.Code != http.StatusOK || !strings.Contains(lists.Body.String(), "\"kind\":\"inbox\"") {
		t.Fatalf("list todo lists status = %d, body = %s", lists.Code, lists.Body.String())
	}
	createdList := performJSON(t, handler, http.MethodPost, "/api/v1/todo-lists", auth.Data.Token, map[string]any{"name": "Life", "color": "#7c4dff"})
	if createdList.Code != http.StatusCreated {
		t.Fatalf("create todo list status = %d, body = %s", createdList.Code, createdList.Body.String())
	}
	var list struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createdList.Body.Bytes(), &list); err != nil || list.Data.ID == "" {
		t.Fatalf("decode todo list: %v, body = %s", err, createdList.Body.String())
	}

	today := time.Now().In(time.Local).Format("2006-01-02")
	due := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	createdTodo := performJSON(t, handler, http.MethodPost, "/api/v1/todos", auth.Data.Token, map[string]any{
		"list_id": list.Data.ID, "title": "Book dentist", "priority": "high", "due_at": due,
		"my_day_date": today, "repeat_rule": "daily", "tags": []string{"life"}, "steps": []string{"Find a clinic", "Call"},
	})
	if createdTodo.Code != http.StatusCreated {
		t.Fatalf("create todo status = %d, body = %s", createdTodo.Code, createdTodo.Body.String())
	}
	var todo struct {
		Data struct {
			ID    string `json:"id"`
			Steps []struct {
				ID string `json:"id"`
			} `json:"steps"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createdTodo.Body.Bytes(), &todo); err != nil || todo.Data.ID == "" || len(todo.Data.Steps) != 2 {
		t.Fatalf("decode todo: %v, body = %s", err, createdTodo.Body.String())
	}

	myDay := performJSON(t, handler, http.MethodGet, "/api/v1/todos?view=today&date="+today, auth.Data.Token, nil)
	if myDay.Code != http.StatusOK || !strings.Contains(myDay.Body.String(), "Book dentist") || !strings.Contains(myDay.Body.String(), "\"count\":1") {
		t.Fatalf("my day list status = %d, body = %s", myDay.Code, myDay.Body.String())
	}
	step := performJSON(t, handler, http.MethodPatch, "/api/v1/todos/"+todo.Data.ID+"/steps/"+todo.Data.Steps[0].ID, auth.Data.Token, map[string]any{"completed": true})
	if step.Code != http.StatusOK || !strings.Contains(step.Body.String(), "\"completed\":true") {
		t.Fatalf("complete todo step status = %d, body = %s", step.Code, step.Body.String())
	}
	completed := performJSON(t, handler, http.MethodPatch, "/api/v1/todos/"+todo.Data.ID+"/status", auth.Data.Token, map[string]any{"completed": true})
	if completed.Code != http.StatusOK || !strings.Contains(completed.Body.String(), "\"status\":\"completed\"") || !strings.Contains(completed.Body.String(), "\"next\"") {
		t.Fatalf("complete recurring todo status = %d, body = %s", completed.Code, completed.Body.String())
	}
	completedList := performJSON(t, handler, http.MethodGet, "/api/v1/todos?view=completed&date="+today, auth.Data.Token, nil)
	if completedList.Code != http.StatusOK || !strings.Contains(completedList.Body.String(), "Book dentist") {
		t.Fatalf("completed todo list status = %d, body = %s", completedList.Code, completedList.Body.String())
	}

	deletedList := performJSON(t, handler, http.MethodDelete, "/api/v1/todo-lists/"+list.Data.ID, auth.Data.Token, nil)
	if deletedList.Code != http.StatusNoContent {
		t.Fatalf("delete todo list status = %d, body = %s", deletedList.Code, deletedList.Body.String())
	}
	allTodos := performJSON(t, handler, http.MethodGet, "/api/v1/todos?view=all&date="+today, auth.Data.Token, nil)
	if allTodos.Code != http.StatusOK || !strings.Contains(allTodos.Body.String(), "Book dentist") {
		t.Fatalf("todos must remain after list deletion: status = %d, body = %s", allTodos.Code, allTodos.Body.String())
	}
}

func TestTaskCanBeDeletedByItsOwner(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("task-delete-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Task owner", "email": "task-owner@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register task owner failed: status = %d, body = %s", register.Code, register.Body.String())
	}
	created := performJSON(t, handler, http.MethodPost, "/api/v1/tasks", auth.Data.Token, map[string]any{"title": "Remove me", "priority": "low"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create task status = %d, body = %s", created.Code, created.Body.String())
	}
	var task struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &task); err != nil || task.Data.ID == "" {
		t.Fatalf("decode created task: %v, body = %s", err, created.Body.String())
	}
	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/tasks/"+task.Data.ID, auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete task status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/tasks", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "\"count\":0") {
		t.Fatalf("list after delete status = %d, body = %s", list.Code, list.Body.String())
	}
	deletedAgain := performJSON(t, handler, http.MethodDelete, "/api/v1/tasks/"+task.Data.ID, auth.Data.Token, nil)
	if deletedAgain.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want %d", deletedAgain.Code, http.StatusNotFound)
	}
}

func TestMoodDiaryCanBeSavedUpdatedListedAndDeleted(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("mood-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Mood learner", "email": "mood@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register mood user failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	payload := map[string]any{
		"mood": "good", "note": "完成了一次舒适的学习节奏", "activities": []string{"学习", "散步"}, "tags": []string{"go"}, "stress": 2, "energy": 4,
	}
	saved := performJSON(t, handler, http.MethodPut, "/api/v1/moods/2026-08-29", auth.Data.Token, payload)
	if saved.Code != http.StatusOK || !strings.Contains(saved.Body.String(), "\"mood\":\"good\"") {
		t.Fatalf("save mood status = %d, body = %s", saved.Code, saved.Body.String())
	}

	updated := performJSON(t, handler, http.MethodPut, "/api/v1/moods/2026-08-29", auth.Data.Token, map[string]any{
		"mood": "great", "note": "更新后的日记", "activities": []string{"学习"}, "tags": []string{}, "stress": 1, "energy": 5,
	})
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), "更新后的日记") {
		t.Fatalf("update mood status = %d, body = %s", updated.Code, updated.Body.String())
	}
	list := performJSON(t, handler, http.MethodGet, "/api/v1/moods?month=2026-08", auth.Data.Token, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "\"count\":1") || !strings.Contains(list.Body.String(), "\"mood\":\"great\"") {
		t.Fatalf("list moods status = %d, body = %s", list.Code, list.Body.String())
	}
	insights := performJSON(t, handler, http.MethodGet, "/api/v1/moods/insights?month=2026-08", auth.Data.Token, nil)
	if insights.Code != http.StatusOK || !strings.Contains(insights.Body.String(), "\"logged_days\":1") || !strings.Contains(insights.Body.String(), "\"average_mood\":5") {
		t.Fatalf("mood insights status = %d, body = %s", insights.Code, insights.Body.String())
	}
	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/moods/2026-08-29", auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete mood status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	invalid := performJSON(t, handler, http.MethodPut, "/api/v1/moods/2026-08-29", auth.Data.Token, map[string]any{
		"mood": "unknown", "stress": 2, "energy": 4,
	})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid mood status = %d, want %d", invalid.Code, http.StatusBadRequest)
	}
}

func TestVocabularyWorkflowCreatesReviewsAndDeletesWord(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("vocabulary-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Vocabulary learner", "email": "words@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register vocabulary user failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	books := performJSON(t, handler, http.MethodGet, "/api/v1/word-books", auth.Data.Token, nil)
	var bookList struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if books.Code != http.StatusOK || json.Unmarshal(books.Body.Bytes(), &bookList) != nil || len(bookList.Data) != 1 {
		t.Fatalf("list default word book failed: status = %d, body = %s", books.Code, books.Body.String())
	}
	bookID := bookList.Data[0].ID

	created := performJSON(t, handler, http.MethodPost, "/api/v1/word-books/"+bookID+"/words", auth.Data.Token, map[string]any{
		"term": "concurrency", "phonetic": "/kənˈkʌrənsi/", "definition": "并发；同时处理多个任务", "example": "Go makes concurrency easier.", "tags": []string{"go"},
	})
	var word struct {
		Data struct {
			ID    string `json:"id"`
			Stage string `json:"stage"`
		} `json:"data"`
	}
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &word) != nil || word.Data.ID == "" || word.Data.Stage != "new" {
		t.Fatalf("create vocabulary word failed: status = %d, body = %s", created.Code, created.Body.String())
	}

	queue := performJSON(t, handler, http.MethodGet, "/api/v1/words/queue?book_id="+bookID, auth.Data.Token, nil)
	if queue.Code != http.StatusOK || !strings.Contains(queue.Body.String(), "concurrency") || !strings.Contains(queue.Body.String(), `"count":1`) {
		t.Fatalf("vocabulary queue status = %d, body = %s", queue.Code, queue.Body.String())
	}
	reviewed := performJSON(t, handler, http.MethodPost, "/api/v1/words/"+word.Data.ID+"/reviews", auth.Data.Token, map[string]any{"rating": 3, "mode": "spelling"})
	if reviewed.Code != http.StatusOK || !strings.Contains(reviewed.Body.String(), `"stage":"learning"`) || !strings.Contains(reviewed.Body.String(), `"interval_days":1`) {
		t.Fatalf("review vocabulary status = %d, body = %s", reviewed.Code, reviewed.Body.String())
	}
	overview := performJSON(t, handler, http.MethodGet, "/api/v1/vocabulary/overview?book_id="+bookID, auth.Data.Token, nil)
	if overview.Code != http.StatusOK || !strings.Contains(overview.Body.String(), `"reviewed_today":1`) || !strings.Contains(overview.Body.String(), `"accuracy_today":100`) {
		t.Fatalf("vocabulary overview status = %d, body = %s", overview.Code, overview.Body.String())
	}

	deleted := performJSON(t, handler, http.MethodDelete, "/api/v1/words/"+word.Data.ID, auth.Data.Token, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete vocabulary word status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	words := performJSON(t, handler, http.MethodGet, "/api/v1/words?book_id="+bookID, auth.Data.Token, nil)
	if words.Code != http.StatusOK || !strings.Contains(words.Body.String(), `"count":0`) {
		t.Fatalf("word list after delete status = %d, body = %s", words.Code, words.Body.String())
	}
}

func TestPlannerHTTPWorkflowGeneratesScheduleAndLinksFocus(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("planner-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Planner learner", "email": "planner@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register planner user failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	windows := make([]map[string]any, 0, 7)
	for weekday := 1; weekday <= 7; weekday++ {
		windows = append(windows, map[string]any{"weekday": weekday, "start_time": "09:00", "end_time": "17:00"})
	}
	preferences := performJSON(t, handler, http.MethodPut, "/api/v1/planner/preferences", auth.Data.Token, map[string]any{
		"time_zone": "UTC", "session_minutes": 45, "break_minutes": 10, "daily_max_minutes": 240, "windows": windows,
	})
	if preferences.Code != http.StatusOK || !strings.Contains(preferences.Body.String(), `"session_minutes":45`) {
		t.Fatalf("save planner preferences status = %d, body = %s", preferences.Code, preferences.Body.String())
	}
	dueAt := "2030-09-05T17:00:00Z"
	createdTask := performJSON(t, handler, http.MethodPost, "/api/v1/tasks", auth.Data.Token, map[string]any{
		"title": "Build worker pool", "estimated_minutes": 90, "priority": "high", "due_at": dueAt,
	})
	if createdTask.Code != http.StatusCreated {
		t.Fatalf("create planner task status = %d, body = %s", createdTask.Code, createdTask.Body.String())
	}
	var task struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createdTask.Body.Bytes(), &task); err != nil || task.Data.ID == "" {
		t.Fatalf("decode planner task: %v, body = %s", err, createdTask.Body.String())
	}

	generated := performJSON(t, handler, http.MethodPost, "/api/v1/planner/generate", auth.Data.Token, map[string]any{"week_start": "2030-09-02"})
	if generated.Code != http.StatusOK {
		t.Fatalf("generate plan status = %d, body = %s", generated.Code, generated.Body.String())
	}
	var week struct {
		Data struct {
			WeekStart string `json:"week_start"`
			Blocks    []struct {
				ID       string `json:"id"`
				Kind     string `json:"kind"`
				SourceID string `json:"source_id"`
			} `json:"blocks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(generated.Body.Bytes(), &week); err != nil {
		t.Fatalf("decode generated plan: %v", err)
	}
	var blockID string
	for _, block := range week.Data.Blocks {
		if block.Kind == "task" && block.SourceID == task.Data.ID {
			blockID = block.ID
			break
		}
	}
	if blockID == "" {
		t.Fatalf("generated plan does not contain task block: %s", generated.Body.String())
	}

	started := performJSON(t, handler, http.MethodPost, "/api/v1/focus-sessions", auth.Data.Token, map[string]any{"plan_block_id": blockID})
	if started.Code != http.StatusCreated || !strings.Contains(started.Body.String(), `"plan_block_id":"`+blockID+`"`) || !strings.Contains(started.Body.String(), `"task_id":"`+task.Data.ID+`"`) {
		t.Fatalf("start focus from plan status = %d, body = %s", started.Code, started.Body.String())
	}
	var focus struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(started.Body.Bytes(), &focus); err != nil || focus.Data.ID == "" {
		t.Fatalf("decode plan focus: %v", err)
	}
	finished := performJSON(t, handler, http.MethodPatch, "/api/v1/focus-sessions/"+focus.Data.ID+"/finish", auth.Data.Token, map[string]any{"abandoned": false})
	if finished.Code != http.StatusOK {
		t.Fatalf("finish planned focus status = %d, body = %s", finished.Code, finished.Body.String())
	}
	loaded := performJSON(t, handler, http.MethodGet, "/api/v1/planner/week?week_start="+week.Data.WeekStart, auth.Data.Token, nil)
	if loaded.Code != http.StatusOK || !strings.Contains(loaded.Body.String(), `"id":"`+blockID+`"`) || !strings.Contains(loaded.Body.String(), `"status":"completed"`) || !strings.Contains(loaded.Body.String(), `"generated_at"`) {
		t.Fatalf("load completed plan status = %d, body = %s", loaded.Code, loaded.Body.String())
	}
}

func TestLearningInsightsHTTPReturnsRangeAndRejectsInvalidDays(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("analytics-http-test-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))

	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Insight learner", "email": "insight@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil || auth.Data.Token == "" {
		t.Fatalf("register insight user failed: status = %d, body = %s", register.Code, register.Body.String())
	}

	response := performJSON(t, handler, http.MethodGet, "/api/v1/analytics/learning?days=7&time_zone=UTC", auth.Data.Token, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("learning insights status = %d, body = %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			TimeZone        string `json:"time_zone"`
			Daily           []any  `json:"daily"`
			Recommendations []any  `json:"recommendations"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode learning insights: %v", err)
	}
	if envelope.Data.TimeZone != "UTC" || len(envelope.Data.Daily) != 7 || len(envelope.Data.Recommendations) == 0 {
		t.Fatalf("unexpected learning insights response: %s", response.Body.String())
	}

	invalid := performJSON(t, handler, http.MethodGet, "/api/v1/analytics/learning?days=3", auth.Data.Token, nil)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "days must be between 7 and 90") {
		t.Fatalf("invalid insights days status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
}

func TestWeeklyReviewHTTPPersistsReflection(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("weekly-review-http-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Weekly learner", "email": "weekly@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil {
		t.Fatalf("register weekly user failed: status = %d, body = %s", register.Code, register.Body.String())
	}
	shanghai, _ := time.LoadLocation("Asia/Shanghai")
	localNow := time.Now().In(shanghai)
	weekStart := localNow.AddDate(0, 0, -((int(localNow.Weekday()) + 6) % 7)).Format("2006-01-02")
	saved := performJSON(t, handler, http.MethodPut, "/api/v1/reviews/weekly/reflection", auth.Data.Token, map[string]any{
		"week_start": weekStart, "satisfaction": 4, "wins": "Kept the plan small", "challenges": "Interruptions",
		"lessons": "Protect the first timebox", "next_week_priorities": []string{"Finish chapter", "Review cards"},
	})
	if saved.Code != http.StatusOK || !strings.Contains(saved.Body.String(), `"satisfaction":4`) {
		t.Fatalf("save weekly reflection status = %d, body = %s", saved.Code, saved.Body.String())
	}
	review := performJSON(t, handler, http.MethodGet, "/api/v1/reviews/weekly?week_start="+weekStart, auth.Data.Token, nil)
	if review.Code != http.StatusOK || !strings.Contains(review.Body.String(), `"reflection_saved":true`) || !strings.Contains(review.Body.String(), `"wins":"Kept the plan small"`) {
		t.Fatalf("weekly review status = %d, body = %s", review.Code, review.Body.String())
	}
	archive := performJSON(t, handler, http.MethodGet, "/api/v1/reviews/weekly/reflections", auth.Data.Token, nil)
	if archive.Code != http.StatusOK || !strings.Contains(archive.Body.String(), `"count":1`) {
		t.Fatalf("weekly reflection archive status = %d, body = %s", archive.Code, archive.Body.String())
	}
}

func TestExportHTTPProvidesPortableFormatsWithoutPasswordHash(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("export-http-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Export learner", "email": "portable@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil {
		t.Fatalf("register export user: %s", register.Body.String())
	}

	backup := performJSON(t, handler, http.MethodGet, "/api/v1/exports/data", auth.Data.Token, nil)
	if backup.Code != http.StatusOK || !strings.Contains(backup.Header().Get("Content-Disposition"), ".json") || !strings.Contains(backup.Body.String(), `"schema_version":1`) || strings.Contains(backup.Body.String(), "safe-password-123") || strings.Contains(backup.Body.String(), "password_hash") {
		t.Fatalf("unexpected data export status=%d headers=%v body=%s", backup.Code, backup.Header(), backup.Body.String())
	}
	csvExport := performJSON(t, handler, http.MethodGet, "/api/v1/exports/learning.csv?days=7&time_zone=UTC", auth.Data.Token, nil)
	if csvExport.Code != http.StatusOK || !strings.HasPrefix(csvExport.Header().Get("Content-Type"), "text/csv") || !bytes.HasPrefix(csvExport.Body.Bytes(), []byte{0xEF, 0xBB, 0xBF}) || !strings.Contains(csvExport.Body.String(), "focus_minutes") {
		t.Fatalf("unexpected CSV export status=%d headers=%v body=%q", csvExport.Code, csvExport.Header(), csvExport.Body.String())
	}
	calendar := performJSON(t, handler, http.MethodGet, "/api/v1/exports/planner.ics", auth.Data.Token, nil)
	if calendar.Code != http.StatusOK || !strings.HasPrefix(calendar.Header().Get("Content-Type"), "text/calendar") || !strings.Contains(calendar.Body.String(), "BEGIN:VCALENDAR\r\n") || !strings.Contains(calendar.Body.String(), "END:VCALENDAR\r\n") {
		t.Fatalf("unexpected calendar export status=%d headers=%v body=%q", calendar.Code, calendar.Header(), calendar.Body.String())
	}
}

func TestVocabularyCatalogHTTPImportsAndPaginatesLargeBook(t *testing.T) {
	repository := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("catalog-http-secret-long-enough", "test", time.Hour)
	handler := NewHandler(service.New(repository, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := performJSON(t, handler, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"name": "Exam learner", "email": "exam@example.com", "password": "safe-password-123",
	})
	var auth struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if register.Code != http.StatusCreated || json.Unmarshal(register.Body.Bytes(), &auth) != nil {
		t.Fatalf("register exam user: %s", register.Body.String())
	}
	catalogs := performJSON(t, handler, http.MethodGet, "/api/v1/vocabulary/catalogs", auth.Data.Token, nil)
	if catalogs.Code != http.StatusOK || !strings.Contains(catalogs.Body.String(), `"id":"ielts"`) || !strings.Contains(catalogs.Body.String(), `"word_count":5040`) || !strings.Contains(catalogs.Body.String(), `"license":"MIT"`) {
		t.Fatalf("catalog list status=%d body=%s", catalogs.Code, catalogs.Body.String())
	}
	installed := performJSON(t, handler, http.MethodPost, "/api/v1/vocabulary/catalogs/ielts/import", auth.Data.Token, map[string]any{"daily_new_limit": 10})
	if installed.Code != http.StatusOK || !strings.Contains(installed.Body.String(), `"added":5040`) || !strings.Contains(installed.Body.String(), `"source_id":"ielts"`) {
		t.Fatalf("catalog import status=%d body=%s", installed.Code, installed.Body.String())
	}
	var imported struct {
		Data struct {
			Book struct {
				ID string `json:"id"`
			} `json:"book"`
		} `json:"data"`
	}
	if err := json.Unmarshal(installed.Body.Bytes(), &imported); err != nil || imported.Data.Book.ID == "" {
		t.Fatalf("decode catalog import: %v", err)
	}
	page := performJSON(t, handler, http.MethodGet, "/api/v1/words?book_id="+imported.Data.Book.ID+"&page=2&page_size=25", auth.Data.Token, nil)
	var paged struct {
		Data []any `json:"data"`
		Meta struct {
			Total      int `json:"total"`
			Page       int `json:"page"`
			PageSize   int `json:"page_size"`
			TotalPages int `json:"total_pages"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(page.Body.Bytes(), &paged); err != nil || page.Code != http.StatusOK || len(paged.Data) != 25 || paged.Meta.Total != 5040 || paged.Meta.Page != 2 || paged.Meta.PageSize != 25 || paged.Meta.TotalPages != 202 {
		t.Fatalf("unexpected vocabulary page status=%d meta=%+v count=%d err=%v", page.Code, paged.Meta, len(paged.Data), err)
	}
	queue := performJSON(t, handler, http.MethodGet, "/api/v1/words/queue?book_id="+imported.Data.Book.ID+"&limit=100", auth.Data.Token, nil)
	var queued struct {
		Data []any `json:"data"`
	}
	if err := json.Unmarshal(queue.Body.Bytes(), &queued); err != nil || queue.Code != http.StatusOK || len(queued.Data) != 10 {
		t.Fatalf("unexpected catalog queue status=%d count=%d err=%v", queue.Code, len(queued.Data), err)
	}
}

func performJSON(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = bytes.NewReader(data)
	}
	request := httptest.NewRequest(method, path, payload)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
