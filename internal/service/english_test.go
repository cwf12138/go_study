package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

// Opt-in network check: exercises the same parser, headers and timeout as production.
// Kept out of ordinary tests because publisher/network availability can change.
func TestEnglishConfiguredSourcesLive(t *testing.T) {
	if os.Getenv("STUDYFLOW_TEST_ENGLISH_LIVE") != "1" {
		t.Skip("set STUDYFLOW_TEST_ENGLISH_LIVE=1 to check external feeds")
	}
	for _, source := range englishSources {
		t.Run(source.Name, func(t *testing.T) {
			articles, err := fetchEnglishSource(context.Background(), &http.Client{Timeout: 10 * time.Second}, source)
			if err != nil {
				t.Fatal(err)
			}
			if len(articles) == 0 {
				t.Fatal("no usable summaries")
			}
			t.Logf("parsed %d summaries; latest publication %s", len(articles), articles[0].PublishedAt)
		})
	}
}

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

func TestEnglishFeedRefreshFailureAndRecovery(t *testing.T) {
	var fail atomic.Bool
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if fail.Load() || r.URL.Path == "/blocked" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(`<rss><channel><item><title>Science news</title><link>https://example.com/news</link><description>New research helps people learn.</description></item></channel></rss>`))
	}))
	defer server.Close()
	original := englishSources
	englishSources = []englishFeedSource{{Name: "Working", URL: server.URL, Homepage: "https://example.com"}, {Name: "Blocked", URL: server.URL + "/blocked"}}
	t.Cleanup(func() { englishSources = original })
	svc := New(store.NewMemory(), nil, nil)
	now := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	feed, err := svc.EnglishFeed(context.Background(), false)
	if err != nil || feed.Offline || !feed.Degraded || len(feed.Articles) != 1 || feed.Sources[0].Error != "来源返回 HTTP 403" {
		t.Fatalf("partial failure: %+v, %v", feed, err)
	}
	if feed.NextRefreshAt.Sub(now) != time.Minute {
		t.Fatal("degraded feed should retry after one minute")
	}
	_, _ = svc.EnglishFeed(context.Background(), false)
	if calls.Load() != 2 {
		t.Fatal("ordinary requests should use cache")
	}
	fail.Store(true)
	now = now.Add(30 * time.Second)
	stale, err := svc.EnglishFeed(context.Background(), true)
	if err != nil || calls.Load() != 4 || stale.Offline || !stale.Sources[1].Stale || len(stale.Articles) != 1 || !stale.Sources[1].LastSuccessAt.Equal(*feed.Sources[1].LastSuccessAt) {
		t.Fatalf("manual refresh must preserve genuine last success: %+v, %v", stale, err)
	}
	now = now.Add(25 * time.Hour)
	offline, err := svc.EnglishFeed(context.Background(), false)
	if err != nil || !offline.Offline || offline.Sources[1].Stale || len(offline.Articles) == 0 || !offline.Articles[0].Offline {
		t.Fatalf("expired cache: %+v %v", offline, err)
	}
	fail.Store(false)
	recovered, err := svc.EnglishFeed(context.Background(), true)
	if err != nil || recovered.Offline || !recovered.Sources[1].Available {
		t.Fatalf("recovery: %+v %v", recovered, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = svc.EnglishFeed(ctx, true)
	if err == nil || svc.englishCache.feed.Offline {
		t.Fatal("cancellation must not replace successful cache")
	}
	englishSources = englishSources[:1]
	healthy, err := svc.EnglishFeed(context.Background(), true)
	if err != nil || healthy.Degraded || healthy.NextRefreshAt.Sub(now) != 20*time.Minute {
		t.Fatalf("healthy cache: %+v %v", healthy, err)
	}
}
