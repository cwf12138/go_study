package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type CreateWordBookInput struct {
	Name          string
	Description   string
	Language      string
	DailyNewLimit int
}

func (s *Service) EnsureDefaultWordBook(ctx context.Context, userID string) (domain.WordBook, error) {
	books, err := s.repo.ListWordBooks(ctx, userID)
	if err != nil {
		return domain.WordBook{}, err
	}
	if len(books) > 0 {
		return books[0], nil
	}
	now := s.now().UTC()
	book := domain.WordBook{ID: platform.NewID(), UserID: userID, Name: "我的词书", Language: "en", DailyNewLimit: 15, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateWordBook(ctx, book); err != nil {
		return domain.WordBook{}, err
	}
	return book, nil
}

func (s *Service) ListWordBooks(ctx context.Context, userID string) ([]domain.WordBook, error) {
	if _, err := s.EnsureDefaultWordBook(ctx, userID); err != nil {
		return nil, err
	}
	return s.repo.ListWordBooks(ctx, userID)
}

func (s *Service) CreateWordBook(ctx context.Context, userID string, input CreateWordBookInput) (domain.WordBook, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Language = strings.ToLower(strings.TrimSpace(input.Language))
	if input.Name == "" || len(input.Name) > 100 || len(input.Description) > 1000 {
		return domain.WordBook{}, fmt.Errorf("%w: invalid word book name or description", domain.ErrInvalidInput)
	}
	if input.Language == "" {
		input.Language = "en"
	}
	if input.DailyNewLimit == 0 {
		input.DailyNewLimit = 15
	}
	if input.DailyNewLimit < 1 || input.DailyNewLimit > 100 {
		return domain.WordBook{}, fmt.Errorf("%w: daily_new_limit must be between 1 and 100", domain.ErrInvalidInput)
	}
	books, err := s.repo.ListWordBooks(ctx, userID)
	if err != nil {
		return domain.WordBook{}, err
	}
	for _, book := range books {
		if strings.EqualFold(book.Name, input.Name) {
			return domain.WordBook{}, fmt.Errorf("%w: word book name already exists", domain.ErrConflict)
		}
	}
	now := s.now().UTC()
	book := domain.WordBook{ID: platform.NewID(), UserID: userID, Name: input.Name, Description: input.Description, Language: input.Language, DailyNewLimit: input.DailyNewLimit, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateWordBook(ctx, book); err != nil {
		return domain.WordBook{}, err
	}
	s.publish("word_book.created", userID, book.ID, nil)
	return book, nil
}

type CreateVocabularyWordInput struct {
	Term               string
	Phonetic           string
	Definition         string
	Example            string
	ExampleTranslation string
	Notes              string
	Tags               []string
}

func (s *Service) CreateVocabularyWord(ctx context.Context, userID, bookID string, input CreateVocabularyWordInput) (domain.VocabularyWord, error) {
	book, err := s.repo.WordBookByID(ctx, bookID)
	if err != nil {
		return domain.VocabularyWord{}, err
	}
	if err := requireOwner(book.UserID, userID); err != nil {
		return domain.VocabularyWord{}, err
	}
	input.Term = strings.TrimSpace(input.Term)
	input.Definition = strings.TrimSpace(input.Definition)
	input.Phonetic = strings.TrimSpace(input.Phonetic)
	input.Example = strings.TrimSpace(input.Example)
	input.ExampleTranslation = strings.TrimSpace(input.ExampleTranslation)
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Term == "" || input.Definition == "" || len(input.Term) > 160 || len(input.Definition) > 3000 || len(input.Example) > 3000 || len(input.Notes) > 4000 {
		return domain.VocabularyWord{}, fmt.Errorf("%w: term and definition are required", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	word := domain.VocabularyWord{
		ID: platform.NewID(), UserID: userID, BookID: book.ID, Term: input.Term, Phonetic: input.Phonetic,
		Definition: input.Definition, Example: input.Example, ExampleTranslation: input.ExampleTranslation,
		Notes: input.Notes, Tags: cleanTags(input.Tags), Stage: domain.VocabularyNew, EaseFactor: 2.5,
		DueAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateVocabularyWord(ctx, word); err != nil {
		return domain.VocabularyWord{}, err
	}
	s.publish("vocabulary_word.created", userID, word.ID, map[string]any{"book_id": book.ID})
	return word, nil
}

func (s *Service) ListVocabularyWords(ctx context.Context, userID, bookID, query string, stage domain.VocabularyStage) ([]domain.VocabularyWord, error) {
	if bookID != "" {
		book, err := s.repo.WordBookByID(ctx, bookID)
		if err != nil {
			return nil, err
		}
		if err := requireOwner(book.UserID, userID); err != nil {
			return nil, err
		}
	}
	if stage != "" && stage != domain.VocabularyNew && stage != domain.VocabularyLearning && stage != domain.VocabularyReviewing && stage != domain.VocabularyMastered {
		return nil, fmt.Errorf("%w: unsupported vocabulary stage", domain.ErrInvalidInput)
	}
	items, err := s.repo.ListVocabularyWords(ctx, userID, bookID)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	result := make([]domain.VocabularyWord, 0, len(items))
	for _, word := range items {
		if stage != "" && word.Stage != stage {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(word.Term), query) && !strings.Contains(strings.ToLower(word.Definition), query) {
			continue
		}
		result = append(result, word)
	}
	return result, nil
}

func (s *Service) VocabularyQueue(ctx context.Context, userID, bookID string, limit int) ([]domain.VocabularyWord, error) {
	book, err := s.repo.WordBookByID(ctx, bookID)
	if err != nil {
		return nil, err
	}
	if err := requireOwner(book.UserID, userID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	items, err := s.repo.ListVocabularyWords(ctx, userID, book.ID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	startToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	todayReviews, err := s.repo.ListVocabularyReviews(ctx, userID, startToday)
	if err != nil {
		return nil, err
	}
	bookWordIDs := make(map[string]struct{}, len(items))
	for _, word := range items {
		bookWordIDs[word.ID] = struct{}{}
	}
	newWordsReviewedToday := make(map[string]struct{})
	for _, review := range todayReviews {
		if _, belongsToBook := bookWordIDs[review.WordID]; review.WasNew && belongsToBook {
			newWordsReviewedToday[review.WordID] = struct{}{}
		}
	}
	queue := make([]domain.VocabularyWord, 0, limit)
	newCount := len(newWordsReviewedToday)
	for _, word := range items {
		if word.DueAt.After(now) {
			continue
		}
		if word.Stage == domain.VocabularyNew {
			if newCount >= book.DailyNewLimit {
				continue
			}
			newCount++
		}
		queue = append(queue, word)
	}
	sort.SliceStable(queue, func(i, j int) bool {
		if queue[i].Stage != queue[j].Stage {
			return queue[i].Stage != domain.VocabularyNew
		}
		return queue[i].DueAt.Before(queue[j].DueAt)
	})
	if len(queue) > limit {
		queue = queue[:limit]
	}
	return queue, nil
}

func (s *Service) ReviewVocabularyWord(ctx context.Context, userID, wordID string, rating domain.ReviewRating, mode string) (domain.VocabularyWord, domain.VocabularyReview, error) {
	if rating < domain.RatingAgain || rating > domain.RatingEasy {
		return domain.VocabularyWord{}, domain.VocabularyReview{}, fmt.Errorf("%w: rating must be between 1 and 4", domain.ErrInvalidInput)
	}
	word, err := s.repo.VocabularyWordByID(ctx, wordID)
	if err != nil {
		return domain.VocabularyWord{}, domain.VocabularyReview{}, err
	}
	if err := requireOwner(word.UserID, userID); err != nil {
		return domain.VocabularyWord{}, domain.VocabularyReview{}, err
	}
	mode = strings.TrimSpace(mode)
	if mode == "" {
		mode = "flashcard"
	}
	if mode != "flashcard" && mode != "spelling" {
		return domain.VocabularyWord{}, domain.VocabularyReview{}, fmt.Errorf("%w: mode must be flashcard or spelling", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	wasNew := word.Stage == domain.VocabularyNew
	word = ScheduleVocabularyReview(word, rating, now)
	review := domain.VocabularyReview{ID: platform.NewID(), UserID: userID, WordID: word.ID, Rating: rating, Mode: mode, WasNew: wasNew, ReviewedAt: now, NextDueAt: word.DueAt}
	if err := s.repo.ApplyVocabularyReview(ctx, word, review); err != nil {
		return domain.VocabularyWord{}, domain.VocabularyReview{}, err
	}
	s.publish("vocabulary_word.reviewed", userID, word.ID, map[string]any{"rating": rating, "mode": mode, "next_due_at": word.DueAt})
	return word, review, nil
}

func ScheduleVocabularyReview(word domain.VocabularyWord, rating domain.ReviewRating, now time.Time) domain.VocabularyWord {
	if word.EaseFactor < 1.3 {
		word.EaseFactor = 1.3
	}
	switch rating {
	case domain.RatingAgain:
		word.Lapses++
		word.Repetitions = 0
		word.IntervalDays = 0
		word.EaseFactor = math.Max(1.3, word.EaseFactor-0.2)
		word.Stage = domain.VocabularyLearning
		word.DueAt = now.Add(10 * time.Minute)
	case domain.RatingHard:
		word.Repetitions++
		word.IntervalDays = max(1, int(math.Round(float64(max(1, word.IntervalDays))*1.2)))
		word.EaseFactor = math.Max(1.3, word.EaseFactor-0.15)
		word.Stage = domain.VocabularyLearning
		word.DueAt = now.AddDate(0, 0, word.IntervalDays)
	default:
		word.Repetitions++
		if word.Repetitions == 1 {
			word.IntervalDays = map[domain.ReviewRating]int{domain.RatingGood: 1, domain.RatingEasy: 4}[rating]
		} else if word.Repetitions == 2 && rating == domain.RatingGood {
			word.IntervalDays = 3
		} else {
			modifier := 1.0
			if rating == domain.RatingEasy {
				modifier = 1.3
				word.EaseFactor += 0.15
			}
			word.IntervalDays = max(1, int(math.Round(float64(max(1, word.IntervalDays))*word.EaseFactor*modifier)))
		}
		word.DueAt = now.AddDate(0, 0, word.IntervalDays)
		if word.IntervalDays >= 21 {
			word.Stage = domain.VocabularyMastered
		} else if word.Repetitions >= 2 {
			word.Stage = domain.VocabularyReviewing
		} else {
			word.Stage = domain.VocabularyLearning
		}
	}
	word.LastReviewedAt = &now
	word.UpdatedAt = now
	return word
}

func (s *Service) VocabularyOverview(ctx context.Context, userID, bookID string) (domain.VocabularyOverview, error) {
	words, err := s.ListVocabularyWords(ctx, userID, bookID, "", "")
	if err != nil {
		return domain.VocabularyOverview{}, err
	}
	now := s.now().UTC()
	startToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	reviews, err := s.repo.ListVocabularyReviews(ctx, userID, startToday.AddDate(0, 0, -365))
	if err != nil {
		return domain.VocabularyOverview{}, err
	}
	result := domain.VocabularyOverview{Total: len(words)}
	for _, word := range words {
		switch word.Stage {
		case domain.VocabularyNew:
			result.New++
		case domain.VocabularyLearning:
			result.Learning++
		case domain.VocabularyReviewing:
			result.Reviewing++
		case domain.VocabularyMastered:
			result.Mastered++
		}
		if !word.DueAt.After(now) {
			result.DueToday++
		}
	}
	correct := 0
	days := make(map[string]bool)
	for _, review := range reviews {
		if bookID != "" {
			word, wordErr := s.repo.VocabularyWordByID(ctx, review.WordID)
			if wordErr != nil || word.BookID != bookID {
				continue
			}
		}
		day := review.ReviewedAt.UTC().Format("2006-01-02")
		days[day] = true
		if !review.ReviewedAt.Before(startToday) {
			result.ReviewedToday++
			if review.Rating > domain.RatingAgain {
				correct++
			}
		}
	}
	if result.ReviewedToday > 0 {
		result.AccuracyToday = math.Round(float64(correct)*1000/float64(result.ReviewedToday)) / 10
	}
	for day := startToday; days[day.Format("2006-01-02")]; day = day.AddDate(0, 0, -1) {
		result.StudyStreak++
	}
	return result, nil
}

func (s *Service) DeleteVocabularyWord(ctx context.Context, userID, wordID string) error {
	word, err := s.repo.VocabularyWordByID(ctx, wordID)
	if err != nil {
		return err
	}
	if err := requireOwner(word.UserID, userID); err != nil {
		return err
	}
	if err := s.repo.DeleteVocabularyWord(ctx, wordID); err != nil {
		return err
	}
	s.publish("vocabulary_word.deleted", userID, wordID, nil)
	return nil
}
