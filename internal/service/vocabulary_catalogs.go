package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/vocabdata"
)

type VocabularyCatalogSummary struct {
	vocabdata.CatalogSummary
	Installed          bool   `json:"installed"`
	InstalledBookID    string `json:"installed_book_id,omitempty"`
	InstalledWordCount int    `json:"installed_word_count"`
}

type ImportVocabularyCatalogInput struct{ DailyNewLimit int }

type VocabularyCatalogImport struct {
	CatalogID string          `json:"catalog_id"`
	Book      domain.WordBook `json:"book"`
	Added     int             `json:"added"`
	Skipped   int             `json:"skipped"`
	Total     int             `json:"total"`
}

func (s *Service) ListVocabularyCatalogs(ctx context.Context, userID string) ([]VocabularyCatalogSummary, error) {
	summaries, err := vocabdata.Summaries()
	if err != nil {
		return nil, err
	}
	books, err := s.repo.ListWordBooks(ctx, userID)
	if err != nil {
		return nil, err
	}
	result := make([]VocabularyCatalogSummary, 0, len(summaries))
	for _, summary := range summaries {
		item := VocabularyCatalogSummary{CatalogSummary: summary}
		for _, book := range books {
			if book.SourceID != summary.ID {
				continue
			}
			words, listErr := s.repo.ListVocabularyWords(ctx, userID, book.ID)
			if listErr != nil {
				return nil, listErr
			}
			item.Installed, item.InstalledBookID, item.InstalledWordCount = true, book.ID, len(words)
			break
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) ImportVocabularyCatalog(ctx context.Context, userID, catalogID string, input ImportVocabularyCatalogInput) (VocabularyCatalogImport, error) {
	catalog, err := vocabdata.Load(strings.ToLower(strings.TrimSpace(catalogID)))
	if err != nil {
		return VocabularyCatalogImport{}, fmt.Errorf("%w: unsupported vocabulary catalog", domain.ErrInvalidInput)
	}
	if input.DailyNewLimit == 0 {
		input.DailyNewLimit = 20
	}
	if input.DailyNewLimit < 1 || input.DailyNewLimit > 100 {
		return VocabularyCatalogImport{}, fmt.Errorf("%w: daily_new_limit must be between 1 and 100", domain.ErrInvalidInput)
	}
	books, err := s.repo.ListWordBooks(ctx, userID)
	if err != nil {
		return VocabularyCatalogImport{}, err
	}
	var book domain.WordBook
	for _, existing := range books {
		if existing.SourceID == catalog.ID {
			book = existing
			break
		}
	}
	now := s.now().UTC()
	if book.ID == "" {
		book = domain.WordBook{ID: platform.NewID(), UserID: userID, Name: catalog.Name, Description: catalog.Description, Language: catalog.Language, DailyNewLimit: input.DailyNewLimit, SourceID: catalog.ID, SourceName: catalog.SourceName, SourceURL: catalog.SourceURL, License: catalog.License, CreatedAt: now, UpdatedAt: now}
		if err := s.repo.CreateWordBook(ctx, book); err != nil {
			if !errors.Is(err, domain.ErrConflict) {
				return VocabularyCatalogImport{}, err
			}
			books, listErr := s.repo.ListWordBooks(ctx, userID)
			if listErr != nil {
				return VocabularyCatalogImport{}, listErr
			}
			book = domain.WordBook{}
			for _, existing := range books {
				if existing.SourceID == catalog.ID {
					book = existing
					break
				}
			}
			if book.ID == "" {
				return VocabularyCatalogImport{}, err
			}
		}
	}
	existingWords, err := s.repo.ListVocabularyWords(ctx, userID, book.ID)
	if err != nil {
		return VocabularyCatalogImport{}, err
	}
	existingTerms := make(map[string]struct{}, len(existingWords))
	for _, word := range existingWords {
		existingTerms[strings.ToLower(strings.TrimSpace(word.Term))] = struct{}{}
	}
	words := make([]domain.VocabularyWord, 0, len(catalog.Words)-len(existingWords))
	skipped := 0
	for index, source := range catalog.Words {
		key := strings.ToLower(strings.TrimSpace(source.Term))
		if _, exists := existingTerms[key]; exists {
			skipped++
			continue
		}
		definition := strings.TrimSpace(source.Translation)
		if english := strings.TrimSpace(source.EnglishDefinition); english != "" && !strings.EqualFold(english, definition) {
			definition += "\n" + english
		}
		words = append(words, domain.VocabularyWord{ID: platform.NewID(), UserID: userID, BookID: book.ID, Term: source.Term, Phonetic: source.Phonetic, Definition: definition, Notes: "来源：ECDICT（MIT）", Tags: []string{catalog.ID, "exam"}, SourceRank: index + 1, Stage: domain.VocabularyNew, EaseFactor: 2.5, DueAt: now, CreatedAt: now, UpdatedAt: now})
		existingTerms[key] = struct{}{}
	}
	if len(words) > 0 {
		if err := s.repo.CreateVocabularyWords(ctx, words); err != nil {
			if !errors.Is(err, domain.ErrConflict) {
				return VocabularyCatalogImport{}, err
			}
			current, listErr := s.repo.ListVocabularyWords(ctx, userID, book.ID)
			if listErr != nil {
				return VocabularyCatalogImport{}, listErr
			}
			result := VocabularyCatalogImport{CatalogID: catalog.ID, Book: book, Added: 0, Skipped: len(current), Total: len(current)}
			return result, nil
		}
	}
	result := VocabularyCatalogImport{CatalogID: catalog.ID, Book: book, Added: len(words), Skipped: skipped, Total: len(existingWords) + len(words)}
	s.publish("vocabulary_catalog.imported", userID, book.ID, map[string]any{"catalog_id": catalog.ID, "added": result.Added, "skipped": result.Skipped})
	return result, nil
}
