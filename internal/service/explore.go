package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"
)

type ExploreInput struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Body     string    `json:"body"`
	Mood     string    `json:"mood"`
	UnlockAt time.Time `json:"unlock_at"`
	Minutes  int       `json:"minutes"`
	Budget   int       `json:"budget"`
	Place    string    `json:"place"`
}
type lifeChallenge struct {
	title, body, place string
	minutes, budget    int
}

var lifeChallenges = []lifeChallenge{
	{"寻找三种绿色", "在身边找出三种不同的绿色，为它们起一个名字。不要采摘或打扰他人。", "outdoor", 10, 0},
	{"给天空一张肖像", "在安全的地方观察天空五分钟，记录云的形状和此刻的感受。", "outdoor", 5, 0},
	{"走一条熟悉的新路", "在熟悉、安全的区域换一条散步路线，发现一个之前没注意到的细节。", "outdoor", 20, 0},
	{"听见城市", "在安全的步行区域停留，辨认五种声音。保持对交通的注意。", "outdoor", 10, 0},
	{"给未来留一个角落", "整理桌面上的五件物品，给一件喜欢的东西留出展示位置。", "indoor", 10, 0},
	{"一首歌的时间", "完整听一首喜欢的歌，不同时刷手机，写下你最喜欢的一刻。", "indoor", 5, 0},
	{"画一张不完美的画", "用纸笔画出手边的杯子，不擦除线条，也不用追求画得像。", "indoor", 10, 0},
	{"给旧物写简介", "选择一件用了很久的物品，写下它来到你身边的故事。", "indoor", 15, 0},
	{"一封谢谢", "给愿意联系的人写一句具体的感谢。可以只写下来，不必发送。", "indoor", 5, 0},
	{"记忆中的菜单", "写下童年最喜欢的一道菜，回忆它的味道、场景和一起吃饭的人。", "indoor", 10, 0},
	{"明信片漫游", "在附近商店寻找一张喜欢的明信片；预算内才购买，也可以自己画一张。", "outdoor", 30, 20},
	{"小小的花期", "在预算内选一枝花，或观察一株现有植物，记录它今天的样子。", "outdoor", 20, 20},
}

func (s *Service) ListExplorations(ctx context.Context, user string) ([]domain.Exploration, error) {
	items, err := s.repo.ListExplorations(ctx, user)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i] = s.explorationView(items[i])
	}
	return items, nil
}
func (s *Service) explorationView(e domain.Exploration) domain.Exploration {
	e.Locked = e.Kind == "letter" && s.now().Before(e.UnlockAt)
	if e.Locked {
		e.Body = ""
	}
	return e
}
func (s *Service) CreateExploration(ctx context.Context, user, kind string, in ExploreInput) (domain.Exploration, error) {
	// Client-generated ID makes retries idempotent, including random draws.
	if len(in.ID) < 16 || len(in.ID) > 80 || strings.ContainsAny(in.ID, "/\\ \n\r") {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	items, err := s.repo.ListExplorations(ctx, user)
	if err != nil {
		return domain.Exploration{}, err
	}
	for _, e := range items {
		if e.ID == in.ID {
			if e.Kind != kind {
				return domain.Exploration{}, domain.ErrConflict
			}
			return s.explorationView(e), nil
		}
	}
	now := s.now().UTC()
	e := domain.Exploration{ID: in.ID, UserID: user, Kind: kind, CreatedAt: now}
	if kind == "letter" {
		in.Title = strings.TrimSpace(in.Title)
		in.Body = strings.TrimSpace(in.Body)
		if in.Title == "" || utf8.RuneCountInString(in.Title) > 120 || in.Body == "" || utf8.RuneCountInString(in.Body) > 12000 || utf8.RuneCountInString(in.Mood) > 40 || !in.UnlockAt.After(now) || in.UnlockAt.After(now.AddDate(10, 0, 0)) {
			return e, fmt.Errorf("%w: 请填写标题、正文，并选择未来十年内的解锁时间", domain.ErrInvalidInput)
		}
		e.Title = in.Title
		e.Body = in.Body
		e.Mood = in.Mood
		e.UnlockAt = in.UnlockAt.UTC()
	} else if kind == "challenge" {
		if (in.Place != "any" && in.Place != "indoor" && in.Place != "outdoor") || in.Minutes < 5 || in.Minutes > 120 || in.Budget < 0 || in.Budget > 100 {
			return e, domain.ErrInvalidInput
		}
		candidates := []lifeChallenge{}
		fresh := []lifeChallenge{}
		seen := map[string]bool{}
		for _, old := range items {
			if old.Kind == "challenge" {
				seen[old.Title] = true
			}
		}
		for _, c := range lifeChallenges {
			if c.minutes <= in.Minutes && c.budget <= in.Budget && (in.Place == "any" || in.Place == c.place) {
				candidates = append(candidates, c)
				if !seen[c.title] {
					fresh = append(fresh, c)
				}
			}
		}
		if len(fresh) > 0 {
			candidates = fresh
		}
		if len(candidates) == 0 {
			return e, fmt.Errorf("%w: 没有符合条件的挑战，请放宽条件", domain.ErrInvalidInput)
		}
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(candidates))))
		if err != nil {
			return e, err
		}
		c := candidates[index.Int64()]
		e.Title = c.title
		e.Body = c.body
		e.Place = c.place
		e.Minutes = c.minutes
		e.Budget = c.budget
	} else {
		return e, domain.ErrInvalidInput
	}
	if err = s.repo.CreateExploration(ctx, e); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			stored, readErr := s.repo.ListExplorations(ctx, user)
			if readErr != nil {
				return domain.Exploration{}, readErr
			}
			for _, item := range stored {
				if item.ID == in.ID && item.Kind == kind {
					return s.explorationView(item), nil
				}
			}
		}
		return domain.Exploration{}, err
	}
	return s.explorationView(e), nil
}
func (s *Service) CompleteExploration(ctx context.Context, user, id, reflection string) (domain.Exploration, error) {
	reflection = strings.TrimSpace(reflection)
	if utf8.RuneCountInString(reflection) > 3000 {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	return s.repo.CompleteExploration(ctx, user, id, reflection, s.now().UTC())
}
