package service

import (
	"container/heap"
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

var searchSources = []string{"memos", "todos", "tasks", "calendar", "moods", "inventory", "bookmarks", "care", "fitness", "goals"}

type SearchInput struct {
	Query           string   `json:"query"`
	Sources         []string `json:"sources"`
	From            string   `json:"from"`
	To              string   `json:"to"`
	IncludeArchived bool     `json:"include_archived"`
	Sort            string   `json:"sort"`
	Page            int      `json:"page"`
	PageSize        int      `json:"page_size"`
}
type searchDocument struct {
	domain.SearchHit
	body string
}

func searchStamp(updated, created time.Time) time.Time {
	if updated.IsZero() {
		return created
	}
	return updated
}
func searchExcerpt(body string, terms []string) string {
	plain := strings.Join(strings.Fields(body), " ")
	runes := []rune(plain)
	if len(runes) <= 180 {
		return plain
	}
	lower := strings.ToLower(plain)
	position := -1
	for _, term := range terms {
		if i := strings.Index(lower, term); i >= 0 && (position < 0 || i < position) {
			position = i
		}
	}
	start := 0
	if position >= 0 {
		start = utf8.RuneCountInString(lower[:position]) - 45
		if start < 0 {
			start = 0
		}
	}
	if start+180 > len(runes) {
		start = len(runes) - 180
	}
	end := start + 180
	value := string(runes[start:end])
	if start > 0 {
		value = "…" + value
	}
	if end < len(runes) {
		value += "…"
	}
	return value
}
func matchSearch(doc searchDocument, query string, terms []string) (domain.SearchHit, bool) {
	title, body, tags := strings.ToLower(doc.Title), strings.ToLower(doc.body), strings.ToLower(strings.Join(doc.Tags, " "))
	score := 0
	field := "内容"
	for _, term := range terms {
		switch {
		case strings.Contains(title, term):
			score += 30
			field = "标题"
		case strings.Contains(tags, term):
			score += 15
			if field != "标题" {
				field = "标签"
			}
		case strings.Contains(body, term):
			score += 5
		default:
			return domain.SearchHit{}, false
		}
	}
	if title == query {
		score += 220
	} else if strings.HasPrefix(title, query) {
		score += 160
	} else if strings.Contains(title, query) {
		score += 100
	}
	hit := doc.SearchHit
	hit.Snippet = searchExcerpt(doc.body, terms)
	hit.Score = score
	hit.MatchField = field
	return hit, true
}
func betterSearch(a, b domain.SearchHit, sortBy string) bool {
	if sortBy != "newest" && a.Score != b.Score {
		return a.Score > b.Score
	}
	if !a.UpdatedAt.Equal(b.UpdatedAt) {
		return a.UpdatedAt.After(b.UpdatedAt)
	}
	if a.Source != b.Source {
		return a.Source < b.Source
	}
	return a.ID < b.ID
}

type searchHeap struct {
	items  []domain.SearchHit
	sortBy string
}

func (h searchHeap) Len() int           { return len(h.items) }
func (h searchHeap) Less(i, j int) bool { return betterSearch(h.items[j], h.items[i], h.sortBy) }
func (h searchHeap) Swap(i, j int)      { h.items[i], h.items[j] = h.items[j], h.items[i] }
func (h *searchHeap) Push(x any)        { h.items = append(h.items, x.(domain.SearchHit)) }
func (h *searchHeap) Pop() any {
	n := len(h.items)
	x := h.items[n-1]
	h.items = h.items[:n-1]
	return x
}

// Search scans current account data on demand. Four bounded source workers and
// a 500-hit heap avoid maintaining a second, potentially stale private index.
func (s *Service) Search(ctx context.Context, user string, in SearchInput) (domain.SearchResult, error) {
	in.Query = strings.TrimSpace(in.Query)
	zero := domain.SearchResult{}
	terms := strings.Fields(strings.ToLower(in.Query))
	if user == "" || in.Query == "" || utf8.RuneCountInString(in.Query) > 80 || len(terms) > 8 || strings.ContainsRune(in.Query, 0) {
		return zero, fitnessBad("请输入 1–80 字的关键词，空格分隔最多 8 个词")
	}
	if in.From != "" {
		if _, e := subscriptionDate(in.From); e != nil {
			return zero, fitnessBad("无效的起始日期")
		}
	}
	if in.To != "" {
		if _, e := subscriptionDate(in.To); e != nil {
			return zero, fitnessBad("无效的结束日期")
		}
	}
	if in.From != "" && in.To != "" && in.From > in.To {
		return zero, fitnessBad("起始日期不能晚于结束日期")
	}
	if in.Sort == "" {
		in.Sort = "relevance"
	}
	if in.Sort != "relevance" && in.Sort != "newest" {
		return zero, fitnessBad("不支持的排序")
	}
	if in.Page == 0 {
		in.Page = 1
	}
	if in.PageSize == 0 {
		in.PageSize = 20
	}
	if in.Page < 1 || in.Page > 1000 || in.PageSize < 1 || in.PageSize > 30 {
		return zero, fitnessBad("无效页码或分页大小")
	}
	if len(in.Sources) > len(searchSources) {
		return zero, fitnessBad("来源过多")
	}
	if len(in.Sources) == 0 {
		in.Sources = append([]string{}, searchSources...)
	}
	sources := []string{}
	seen := map[string]bool{}
	for _, source := range in.Sources {
		if !nutritionOne(source, searchSources...) {
			return zero, fitnessBad("不支持的搜索来源")
		}
		if !seen[source] {
			sources = append(sources, source)
			seen[source] = true
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	docs := make(chan searchDocument, 32)
	jobs := make(chan string, len(sources))
	warnings := make(chan string, len(sources))
	for _, source := range sources {
		jobs <- source
	}
	close(jobs)
	var wg sync.WaitGroup
	workers := 4
	if len(sources) < workers {
		workers = len(sources)
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for source := range jobs {
				if ctx.Err() != nil {
					return
				}
				if e := s.searchSource(ctx, user, source, func(owner string, doc searchDocument) bool {
					if ctx.Err() != nil {
						return false
					}
					if owner != user || doc.Archived && !in.IncludeArchived {
						return true
					}
					if in.From != "" || in.To != "" {
						if doc.UpdatedAt.IsZero() {
							return true
						}
						date := doc.UpdatedAt.In(calendarLocation).Format(calendarDateLayout)
						if in.From != "" && date < in.From || in.To != "" && date > in.To {
							return true
						}
					}
					select {
					case docs <- doc:
						return true
					case <-ctx.Done():
						return false
					}
				}); e != nil {
					warnings <- source
				}
			}
		}()
	}
	go func() { wg.Wait(); close(docs); close(warnings) }()
	result := domain.SearchResult{Query: in.Query, Items: []domain.SearchHit{}, Counts: map[string]int{}, Warnings: []string{}, Page: in.Page, PageSize: in.PageSize}
	for _, source := range sources {
		result.Counts[source] = 0
	}
	best := &searchHeap{sortBy: in.Sort}
	heap.Init(best)
collect:
	for {
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case doc, ok := <-docs:
			if !ok {
				break collect
			}
			if hit, matched := matchSearch(doc, strings.ToLower(in.Query), terms); matched {
				result.Total++
				result.Counts[hit.Source]++
				if best.Len() < 500 {
					heap.Push(best, hit)
				} else if betterSearch(hit, best.items[0], in.Sort) {
					heap.Pop(best)
					heap.Push(best, hit)
				}
			}
		}
	}
	if ctx.Err() != nil {
		return zero, ctx.Err()
	}
	for source := range warnings {
		result.Warnings = append(result.Warnings, source)
	}
	sort.Strings(result.Warnings)
	if len(result.Warnings) == len(sources) {
		return result, fmt.Errorf("all search sources unavailable")
	}
	sort.Slice(best.items, func(i, j int) bool { return betterSearch(best.items[i], best.items[j], in.Sort) })
	result.Available = len(best.items)
	result.Truncated = result.Total > result.Available
	pages := (result.Available + in.PageSize - 1) / in.PageSize
	if pages < 1 {
		pages = 1
	}
	if result.Page > pages {
		result.Page = pages
	}
	start := (result.Page - 1) * in.PageSize
	end := start + in.PageSize
	if end > len(best.items) {
		end = len(best.items)
	}
	result.Items = append(result.Items, best.items[start:end]...)
	return result, nil
}
