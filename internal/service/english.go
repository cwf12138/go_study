package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type englishFeedSource struct{ Name, URL, Homepage, Category string }
type englishCacheEntry struct {
	feed      domain.EnglishFeed
	expiresAt time.Time
}
type englishFetchResult struct {
	source   englishFeedSource
	articles []domain.EnglishArticle
	err      error
}

var englishHTMLTags = regexp.MustCompile(`<[^>]*>`)
var englishSources = []englishFeedSource{
	{Name: "BBC World", URL: "https://feeds.bbci.co.uk/news/world/rss.xml", Homepage: "https://www.bbc.com/news/world", Category: "world"},
	{Name: "BBC Science", URL: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", Homepage: "https://www.bbc.com/news/science_and_environment", Category: "science"},
	{Name: "BBC Technology", URL: "https://feeds.bbci.co.uk/news/technology/rss.xml", Homepage: "https://www.bbc.com/news/technology", Category: "technology"},
	{Name: "NASA JPL", URL: "https://www.jpl.nasa.gov/feeds/news/", Homepage: "https://www.jpl.nasa.gov/news/", Category: "science"},
}

type rssDocument struct {
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
	Entries []rssItem `xml:"entry"`
}
type rssItem struct {
	Title       string `xml:"title"`
	Description string `xml:"description"`
	Summary     string `xml:"summary"`
	Links       []struct {
		Text string `xml:",chardata"`
		Href string `xml:"href,attr"`
		Rel  string `xml:"rel,attr"`
	} `xml:"link"`
	GUID      string `xml:"guid"`
	PubDate   string `xml:"pubDate"`
	Published string `xml:"published"`
	Updated   string `xml:"updated"`
}

func (s *Service) EnglishFeed(ctx context.Context, refresh bool) (domain.EnglishFeed, error) {
	now := s.now().UTC()
	if !refresh {
		s.englishMu.RLock()
		cached := s.englishCache
		s.englishMu.RUnlock()
		if !cached.expiresAt.IsZero() && now.Before(cached.expiresAt) {
			return cached.feed, nil
		}
	}
	requestCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 5 * time.Second}
	results := make(chan englishFetchResult, len(englishSources))
	for _, source := range englishSources {
		go func(source englishFeedSource) {
			articles, err := fetchEnglishSource(requestCtx, client, source)
			results <- englishFetchResult{source: source, articles: articles, err: err}
		}(source)
	}
	feed := domain.EnglishFeed{Articles: []domain.EnglishArticle{}, Sources: []domain.EnglishSourceStatus{}, FetchedAt: now}
	for range englishSources {
		result := <-results
		feed.Sources = append(feed.Sources, domain.EnglishSourceStatus{Name: result.source.Name, URL: result.source.Homepage, Available: result.err == nil, Count: len(result.articles)})
		feed.Articles = append(feed.Articles, result.articles...)
	}
	sort.Slice(feed.Sources, func(i, j int) bool { return feed.Sources[i].Name < feed.Sources[j].Name })
	sort.Slice(feed.Articles, func(i, j int) bool { return feed.Articles[i].PublishedAt.After(feed.Articles[j].PublishedAt) })
	if len(feed.Articles) == 0 {
		feed.Degraded = true
		feed.Articles = offlineEnglishArticles(now)
	}
	if len(feed.Articles) > 48 {
		feed.Articles = feed.Articles[:48]
	}
	s.englishMu.Lock()
	s.englishCache = englishCacheEntry{feed: feed, expiresAt: now.Add(20 * time.Minute)}
	s.englishMu.Unlock()
	return feed, nil
}

func fetchEnglishSource(ctx context.Context, client *http.Client, source englishFeedSource) ([]domain.EnglishArticle, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "StudyFlow/1.0 (+local learning RSS reader)")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("feed returned %s", resp.Status)
	}
	var document rssDocument
	if err := xml.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&document); err != nil {
		return nil, err
	}
	items := document.Channel.Items
	if len(items) == 0 {
		items = document.Entries
	}
	articles := make([]domain.EnglishArticle, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		link := ""
		for _, candidate := range item.Links {
			if strings.TrimSpace(candidate.Text) != "" {
				link = strings.TrimSpace(candidate.Text)
				break
			}
			if candidate.Href != "" && (candidate.Rel == "" || candidate.Rel == "alternate") {
				link = candidate.Href
				break
			}
		}
		if link == "" {
			link = strings.TrimSpace(item.GUID)
		}
		parsed, err := url.Parse(link)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			continue
		}
		title := cleanEnglishText(item.Title, 240)
		summary := item.Description
		if summary == "" {
			summary = item.Summary
		}
		summary = cleanEnglishText(summary, 900)
		if title == "" || summary == "" {
			continue
		}
		if _, exists := seen[link]; exists {
			continue
		}
		seen[link] = struct{}{}
		published := parseEnglishTime(item.PubDate, item.Published, item.Updated)
		words := englishWordCount(title + " " + summary)
		articles = append(articles, domain.EnglishArticle{ID: englishArticleID(link), Title: title, Summary: summary, URL: link, Source: source.Name, SourceURL: source.Homepage, Category: source.Category, Difficulty: englishDifficulty(summary), PublishedAt: published, ReadingMinutes: max(1, (words+179)/180), WordCount: words})
	}
	if len(articles) == 0 {
		return nil, fmt.Errorf("feed contains no usable articles")
	}
	if len(articles) > 16 {
		articles = articles[:16]
	}
	return articles, nil
}

func cleanEnglishText(value string, limit int) string {
	value = englishHTMLTags.ReplaceAllString(value, " ")
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func parseEnglishTime(values ...string) time.Time {
	formats := []string{time.RFC1123Z, time.RFC1123, time.RFC3339, time.RFC822Z, time.RFC822}
	for _, value := range values {
		for _, format := range formats {
			if parsed, err := time.Parse(format, strings.TrimSpace(value)); err == nil {
				return parsed.UTC()
			}
		}
	}
	return time.Time{}
}

func englishArticleID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:10])
}
func englishWordCount(value string) int {
	return len(strings.FieldsFunc(value, func(r rune) bool { return !unicode.IsLetter(r) && r != '\'' }))
}
func englishDifficulty(value string) string {
	words := strings.Fields(value)
	if len(words) == 0 {
		return "B1"
	}
	long, sentences := 0, 0
	for _, word := range words {
		if len([]rune(strings.Trim(word, ".,:;!?()\"'"))) >= 9 {
			long++
		}
		if strings.ContainsAny(word, ".!?") {
			sentences++
		}
	}
	if sentences == 0 {
		sentences = 1
	}
	average := len(words) / sentences
	ratio := float64(long) / float64(len(words))
	if average >= 24 || ratio >= .24 {
		return "C1"
	}
	if average >= 17 || ratio >= .15 {
		return "B2"
	}
	return "B1"
}

func offlineEnglishArticles(now time.Time) []domain.EnglishArticle {
	items := []struct{ title, summary, category, level string }{
		{"Why Small Habits Are Easier to Keep", "A useful habit does not need to feel impressive. When an action is small, the cost of starting becomes lower. Repeating it at a stable time also gives the brain a clear cue. The real goal is not one perfect study session, but a system that makes returning easier tomorrow.", "learning", "B1"},
		{"How Curiosity Improves Deep Reading", "Strong readers do more than collect facts. They pause to predict, question, and connect each idea with something they already know. This active process may feel slower, yet it creates a richer mental model and makes the article easier to recall later.", "learning", "B2"},
		{"The Hidden Cost of Constant Context Switching", "Moving rapidly between messages, documents, and difficult problems creates cognitive residue. Part of our attention remains attached to the previous task, so the next task receives fewer mental resources. Protecting even a short uninterrupted block can therefore improve both speed and accuracy.", "technology", "C1"},
	}
	articles := make([]domain.EnglishArticle, 0, len(items))
	for index, item := range items {
		words := englishWordCount(item.summary)
		link := fmt.Sprintf("studyflow://english-lab/%d", index+1)
		articles = append(articles, domain.EnglishArticle{ID: englishArticleID(link), Title: item.title, Summary: item.summary, Source: "StudyFlow Reading Lab", Category: item.category, Difficulty: item.level, PublishedAt: now.Add(-time.Duration(index) * time.Hour), ReadingMinutes: max(1, (words+179)/180), WordCount: words, Offline: true})
	}
	return articles
}

type SaveEnglishReadingInput struct {
	Article  domain.EnglishArticle
	Notes    string
	NewWords []string
	Status   string
}
type UpdateEnglishReadingInput struct {
	Notes    *string
	NewWords *[]string
	Status   *string
}

func (s *Service) SaveEnglishReading(ctx context.Context, userID string, input SaveEnglishReadingInput) (domain.EnglishReading, error) {
	article, notes, words, status, err := validateEnglishReading(input.Article, input.Notes, input.NewWords, input.Status)
	if err != nil {
		return domain.EnglishReading{}, err
	}
	existing, err := s.repo.ListEnglishReadings(ctx, userID)
	if err != nil {
		return domain.EnglishReading{}, err
	}
	for _, reading := range existing {
		if reading.Article.ID == article.ID {
			return reading, nil
		}
	}
	now := s.now().UTC()
	reading := domain.EnglishReading{ID: platform.NewID(), UserID: userID, Article: article, Status: status, Notes: notes, NewWords: words, SavedAt: now, UpdatedAt: now}
	if status == "completed" {
		reading.CompletedAt = &now
	}
	if err := s.repo.CreateEnglishReading(ctx, reading); err != nil {
		return domain.EnglishReading{}, err
	}
	s.publish("english_reading.saved", userID, reading.ID, map[string]any{"article_id": article.ID, "status": status})
	return reading, nil
}

func (s *Service) UpdateEnglishReading(ctx context.Context, userID, id string, input UpdateEnglishReadingInput) (domain.EnglishReading, error) {
	reading, err := s.repo.EnglishReadingByID(ctx, id)
	if err != nil {
		return domain.EnglishReading{}, err
	}
	if err := requireOwner(reading.UserID, userID); err != nil {
		return domain.EnglishReading{}, err
	}
	if input.Notes != nil {
		reading.Notes = strings.TrimSpace(*input.Notes)
		if utf8.RuneCountInString(reading.Notes) > 4000 {
			return domain.EnglishReading{}, fmt.Errorf("%w: notes exceed 4000 characters", domain.ErrInvalidInput)
		}
	}
	if input.NewWords != nil {
		reading.NewWords = cleanEnglishWords(*input.NewWords)
		if len(reading.NewWords) > 100 {
			return domain.EnglishReading{}, fmt.Errorf("%w: too many new words", domain.ErrInvalidInput)
		}
	}
	if input.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*input.Status))
		if status != "saved" && status != "completed" {
			return domain.EnglishReading{}, fmt.Errorf("%w: status must be saved or completed", domain.ErrInvalidInput)
		}
		reading.Status = status
		if status == "completed" && reading.CompletedAt == nil {
			now := s.now().UTC()
			reading.CompletedAt = &now
		}
		if status == "saved" {
			reading.CompletedAt = nil
		}
	}
	reading.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateEnglishReading(ctx, reading); err != nil {
		return domain.EnglishReading{}, err
	}
	return reading, nil
}

func (s *Service) DeleteEnglishReading(ctx context.Context, userID, id string) error {
	reading, err := s.repo.EnglishReadingByID(ctx, id)
	if err != nil {
		return err
	}
	if err := requireOwner(reading.UserID, userID); err != nil {
		return err
	}
	return s.repo.DeleteEnglishReading(ctx, id)
}
func (s *Service) ListEnglishReadings(ctx context.Context, userID string) ([]domain.EnglishReading, error) {
	return s.repo.ListEnglishReadings(ctx, userID)
}

func (s *Service) EnglishOverview(ctx context.Context, userID string) (domain.EnglishOverview, error) {
	items, err := s.repo.ListEnglishReadings(ctx, userID)
	if err != nil {
		return domain.EnglishOverview{}, err
	}
	now := s.now().In(time.Local)
	weekStart := now.AddDate(0, 0, -int((int(now.Weekday())+6)%7))
	weekStart = time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, now.Location())
	overview := domain.EnglishOverview{}
	days := map[string]struct{}{}
	for _, item := range items {
		if item.Status == "saved" {
			overview.Saved++
		}
		if item.Status == "completed" {
			overview.Completed++
			overview.ReadingMinutes += item.Article.ReadingMinutes
			overview.NewWords += len(item.NewWords)
			if item.CompletedAt != nil {
				completedAt := item.CompletedAt.In(time.Local)
				days[completedAt.Format("2006-01-02")] = struct{}{}
				if !completedAt.Before(weekStart) {
					overview.CompletedThisWeek++
				}
			}
		}
	}
	for day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()); ; day = day.AddDate(0, 0, -1) {
		if _, ok := days[day.Format("2006-01-02")]; !ok {
			break
		}
		overview.StreakDays++
	}
	return overview, nil
}

func validateEnglishReading(article domain.EnglishArticle, notes string, words []string, status string) (domain.EnglishArticle, string, []string, string, error) {
	article.Title = cleanEnglishText(article.Title, 240)
	article.Summary = cleanEnglishText(article.Summary, 900)
	article.Source = cleanEnglishText(article.Source, 100)
	article.Category = strings.ToLower(strings.TrimSpace(article.Category))
	article.Difficulty = strings.ToUpper(strings.TrimSpace(article.Difficulty))
	if article.ID == "" || article.Title == "" || article.Summary == "" || article.Source == "" {
		return article, "", nil, "", fmt.Errorf("%w: article metadata is incomplete", domain.ErrInvalidInput)
	}
	if !article.Offline {
		parsed, err := url.Parse(article.URL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return article, "", nil, "", fmt.Errorf("%w: article URL must be https", domain.ErrInvalidInput)
		}
	}
	notes = strings.TrimSpace(notes)
	if utf8.RuneCountInString(notes) > 4000 {
		return article, "", nil, "", fmt.Errorf("%w: notes exceed 4000 characters", domain.ErrInvalidInput)
	}
	words = cleanEnglishWords(words)
	if len(words) > 100 {
		return article, "", nil, "", fmt.Errorf("%w: too many new words", domain.ErrInvalidInput)
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		status = "saved"
	}
	if status != "saved" && status != "completed" {
		return article, "", nil, "", fmt.Errorf("%w: status must be saved or completed", domain.ErrInvalidInput)
	}
	return article, notes, words, status, nil
}
func cleanEnglishWords(words []string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, word := range words {
		word = strings.ToLower(strings.Trim(strings.TrimSpace(word), ".,;:!?()[]{}\"'"))
		if word == "" {
			continue
		}
		if _, ok := seen[word]; ok {
			continue
		}
		seen[word] = struct{}{}
		result = append(result, word)
	}
	return result
}
