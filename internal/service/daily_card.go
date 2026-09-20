package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"hash/fnv"
	"math/big"
	"time"
	"unicode/utf8"
)

// New draws use a simple fortune label. Existing saved draws remain unchanged.
var dailyCardTexts = [][4]string{
	{"大吉", "心有所盼，今日多一份明朗。", "", ""},
	{"中吉", "从容向前，美好正在慢慢靠近。", "", ""},
	{"小吉", "平常的一天，也藏着小小欢喜。", "", ""},
	{"吉", "愿你所行顺意，所遇温柔。", "", ""},
	{"末吉", "不必着急，好事值得慢慢等待。", "", ""},
}

// Present today's legacy draw using the new vocabulary without rerolling or
// overwriting the saved original. ID hashing also supports cards without a number.
func currentDailyPresentation(card domain.Exploration) domain.Exploration {
	if card.Body == "" {
		return card
	}
	for _, text := range dailyCardTexts {
		if card.Title == text[0] {
			return card
		}
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(card.ID))
	index := int(h.Sum32() % uint32(len(dailyCardTexts)))
	if card.SignNumber > 0 {
		index = (card.SignNumber - 1) % len(dailyCardTexts)
	}
	text := dailyCardTexts[index]
	card.Title, card.Body, card.Action, card.Prompt = text[0], text[1], "", ""
	card.SignNumber = index + 1
	return card
}

func (s *Service) dailyBase(user, date string) (domain.Exploration, error) {
	zone, _ := time.LoadLocation("Asia/Shanghai")
	now := s.now()
	if date == "" {
		date = now.In(zone).Format("2006-01-02")
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Format("2006-01-02") != date || date < "2026-01-01" || date > now.In(zone).Format("2006-01-02") {
		return domain.Exploration{}, fmt.Errorf("%w: 日签日期须在 2026-01-01 至今天之间", domain.ErrInvalidInput)
	}
	return domain.Exploration{ID: user + ":daily:" + date, UserID: user, Kind: "daily", Date: date, CreatedAt: now.UTC()}, nil
}

// The atomic store operation returns the first draw even for concurrent requests.
func (s *Service) DrawDailyCard(ctx context.Context, user string) (domain.Exploration, error) {
	card, err := s.DailyCard(ctx, user, "")
	if err != nil || card.Body != "" {
		return card, err
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(dailyCardTexts))))
	if err != nil {
		return card, err
	}
	v := dailyCardTexts[n.Int64()]
	card.Title, card.Body, card.Action, card.Prompt = v[0], v[1], v[2], v[3]
	card.SignNumber = int(n.Int64()) + 1
	return s.repo.SaveDailyCard(ctx, card, nil, nil)
}
func (s *Service) DailyCard(ctx context.Context, user, date string) (domain.Exploration, error) {
	card, err := s.dailyBase(user, date)
	if err != nil {
		return card, err
	}
	items, err := s.repo.ListExplorations(ctx, user)
	if err != nil {
		return card, err
	}
	for _, v := range items {
		if v.ID == card.ID && v.Kind == "daily" {
			if v.Date == s.now().In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02") {
				return currentDailyPresentation(v), nil
			}
			return v, nil
		}
	}
	return card, nil
}
func (s *Service) SaveDailyCard(ctx context.Context, user, date string, favorite *bool, reflection *string) (domain.Exploration, error) {
	if favorite == nil && reflection == nil {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	if reflection != nil && utf8.RuneCountInString(*reflection) > 3000 {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	card, err := s.DailyCard(ctx, user, date)
	if err != nil {
		return card, err
	}
	if card.Body == "" {
		return card, fmt.Errorf("%w: 请先抽签，往日未抽签不可补抽", domain.ErrInvalidState)
	}
	return s.repo.SaveDailyCard(ctx, card, favorite, reflection)
}
