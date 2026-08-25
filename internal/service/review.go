package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

func (s *Service) CreateDeck(ctx context.Context, userID, name, description string) (domain.Deck, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 {
		return domain.Deck{}, fmt.Errorf("%w: deck name is required", domain.ErrInvalidInput)
	}
	deck := domain.Deck{ID: platform.NewID(), UserID: userID, Name: name, Description: strings.TrimSpace(description), CreatedAt: s.now().UTC()}
	if err := s.repo.CreateDeck(ctx, deck); err != nil {
		return domain.Deck{}, err
	}
	s.publish("deck.created", userID, deck.ID, nil)
	return deck, nil
}

func (s *Service) ListDecks(ctx context.Context, userID string) ([]domain.Deck, error) {
	return s.repo.ListDecks(ctx, userID)
}

func (s *Service) CreateCard(ctx context.Context, userID, deckID, prompt, answer string) (domain.Card, error) {
	prompt, answer = strings.TrimSpace(prompt), strings.TrimSpace(answer)
	if prompt == "" || answer == "" || len(prompt) > 2000 || len(answer) > 5000 {
		return domain.Card{}, fmt.Errorf("%w: prompt and answer are required", domain.ErrInvalidInput)
	}
	deck, err := s.repo.DeckByID(ctx, deckID)
	if err != nil {
		return domain.Card{}, err
	}
	if err := requireOwner(deck.UserID, userID); err != nil {
		return domain.Card{}, err
	}
	now := s.now().UTC()
	card := domain.Card{
		ID: platform.NewID(), UserID: userID, DeckID: deckID, Prompt: prompt, Answer: answer,
		EaseFactor: 2.5, DueAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateCard(ctx, card); err != nil {
		return domain.Card{}, err
	}
	s.publish("card.created", userID, card.ID, map[string]any{"deck_id": deckID})
	return card, nil
}

func (s *Service) DueCards(ctx context.Context, userID string, limit int) ([]domain.Card, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return s.repo.ListDueCards(ctx, userID, s.now().UTC(), limit)
}

func (s *Service) ReviewCard(ctx context.Context, userID, cardID string, rating domain.ReviewRating) (domain.Card, domain.Review, error) {
	if rating < domain.RatingAgain || rating > domain.RatingEasy {
		return domain.Card{}, domain.Review{}, fmt.Errorf("%w: rating must be between 1 and 4", domain.ErrInvalidInput)
	}
	card, err := s.repo.CardByID(ctx, cardID)
	if err != nil {
		return domain.Card{}, domain.Review{}, err
	}
	if err := requireOwner(card.UserID, userID); err != nil {
		return domain.Card{}, domain.Review{}, err
	}
	now := s.now().UTC()
	card = ScheduleNextReview(card, rating, now)
	review := domain.Review{
		ID: platform.NewID(), UserID: userID, CardID: card.ID,
		Rating: rating, ReviewedAt: now, NextDueAt: card.DueAt,
	}
	if err := s.repo.ApplyReview(ctx, card, review); err != nil {
		return domain.Card{}, domain.Review{}, err
	}
	s.publish("card.reviewed", userID, card.ID, map[string]any{"rating": rating, "next_due_at": card.DueAt})
	return card, review, nil
}

// ScheduleNextReview is deterministic and independent of infrastructure,
// making the learning algorithm straightforward to study and test.
func ScheduleNextReview(card domain.Card, rating domain.ReviewRating, now time.Time) domain.Card {
	if card.EaseFactor < 1.3 {
		card.EaseFactor = 1.3
	}
	if rating == domain.RatingAgain {
		card.Repetitions = 0
		card.IntervalDays = 1
		card.EaseFactor = math.Max(1.3, card.EaseFactor-0.20)
	} else {
		card.Repetitions++
		switch card.Repetitions {
		case 1:
			card.IntervalDays = 1
		case 2:
			card.IntervalDays = 6
		default:
			modifier := 1.0
			if rating == domain.RatingHard {
				modifier = 0.8
			} else if rating == domain.RatingEasy {
				modifier = 1.3
			}
			card.IntervalDays = max(1, int(math.Round(float64(card.IntervalDays)*card.EaseFactor*modifier)))
		}
		switch rating {
		case domain.RatingHard:
			card.EaseFactor = math.Max(1.3, card.EaseFactor-0.15)
		case domain.RatingEasy:
			card.EaseFactor += 0.15
		}
	}
	card.DueAt = now.AddDate(0, 0, card.IntervalDays)
	card.UpdatedAt = now
	return card
}
