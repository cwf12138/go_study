package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestFetchEnglishSourceParsesAndClassifiesRSS(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><rss version="2.0"><channel><item><title>Science &amp; careful reading</title><link>https://example.com/story</link><description><![CDATA[<p>Researchers created a practical system that helps communities understand complicated climate information and make better long-term decisions.</p>]]></description><pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate></item></channel></rss>`))
	}))
	defer server.Close()

	items, err := fetchEnglishSource(context.Background(), server.Client(), englishFeedSource{Name: "Test Science", URL: server.URL, Homepage: "https://example.com", Category: "science"})
	if err != nil || len(items) != 1 {
		t.Fatalf("fetchEnglishSource count=%d err=%v", len(items), err)
	}
	if items[0].Title != "Science & careful reading" || items[0].Summary == "" || items[0].Category != "science" || items[0].Difficulty == "" {
		t.Fatalf("article = %#v", items[0])
	}
}

func TestEnglishReadingWorkflowAndOverview(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	article := domain.EnglishArticle{ID: "article-1", Title: "A better way to learn", Summary: "Small deliberate steps make difficult skills easier to practise.", Source: "StudyFlow Reading Lab", Category: "learning", Difficulty: "B1", ReadingMinutes: 2, WordCount: 10, Offline: true}
	reading, err := svc.SaveEnglishReading(ctx, "user-1", SaveEnglishReadingInput{Article: article, Status: "saved"})
	if err != nil || reading.Status != "saved" {
		t.Fatalf("SaveEnglishReading reading=%#v err=%v", reading, err)
	}
	status, notes, words := "completed", "The main idea is consistency.", []string{"deliberate", "Consistency", "deliberate"}
	reading, err = svc.UpdateEnglishReading(ctx, "user-1", reading.ID, UpdateEnglishReadingInput{Status: &status, Notes: &notes, NewWords: &words})
	if err != nil || reading.CompletedAt == nil || len(reading.NewWords) != 2 {
		t.Fatalf("UpdateEnglishReading reading=%#v err=%v", reading, err)
	}
	overview, err := svc.EnglishOverview(ctx, "user-1")
	if err != nil || overview.Completed != 1 || overview.CompletedThisWeek != 1 || overview.ReadingMinutes != 2 || overview.NewWords != 2 || overview.StreakDays != 1 {
		t.Fatalf("EnglishOverview=%#v err=%v", overview, err)
	}
}
