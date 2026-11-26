package service

import (
	"context"
	"fmt"
	"hash/fnv"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

func (s *Service) lockLiteratureUser(userID string) func() {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(userID))
	lock := &s.literatureWrites[hash.Sum32()%uint32(len(s.literatureWrites))]
	lock.Lock()
	return lock.Unlock
}

type literatureContentCacheEntry struct {
	content   domain.EBookContent
	expiresAt time.Time
}

var ebookMarkerPattern = regexp.MustCompile(`(?im)^\*\*\*\s*(START|END) OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$`)
var ebookChapterPattern = regexp.MustCompile(`(?i)^(chapter|book|part|volume)\s+([ivxlcdm0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b.*$`)

func (s *Service) SearchEBooks(ctx context.Context, query string) (domain.EBookCatalog, error) {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 120 {
		return domain.EBookCatalog{}, fmt.Errorf("%w: search query is too long", domain.ErrInvalidInput)
	}
	if err := ctx.Err(); err != nil {
		return domain.EBookCatalog{}, err
	}
	if query == "" {
		return domain.EBookCatalog{Items: curatedEBooks(), Provider: "Project Gutenberg · Featured"}, nil
	}

	catalog := domain.EBookCatalog{Items: filterCuratedEBooks(query), Query: query, Provider: "Project Gutenberg"}
	s.literatureMu.RLock()
	index := s.literatureIndex
	s.literatureMu.RUnlock()
	if len(index) == 0 {
		catalog.Degraded = true
		return catalog, nil
	}

	seen := make(map[string]bool, len(catalog.Items))
	for _, item := range catalog.Items {
		seen[item.ID] = true
	}
	for _, item := range index {
		if seen[item.ID] || !matchesEBook(item, query) {
			continue
		}
		catalog.Items = append(catalog.Items, item)
		seen[item.ID] = true
		if len(catalog.Items) >= 24 {
			break
		}
	}
	return catalog, nil
}

func matchesEBook(book domain.EBookCatalogItem, query string) bool {
	if strings.EqualFold(book.ID, query) || gutenbergNumber(book.ID) == query {
		return true
	}
	fields := strings.Fields(strings.ToLower(query))
	content := strings.ToLower(book.Title + " " + book.ChineseTitle + " " + strings.Join(book.Authors, " "))
	for _, word := range fields {
		if !strings.Contains(content, word) {
			return false
		}
	}
	return len(fields) > 0
}

func allowedEBookContentURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return parsed.User == nil && (parsed.Port() == "" || parsed.Port() == "443") && (host == "gutenberg.org" || host == "www.gutenberg.org")
}

func (s *Service) AddEBook(ctx context.Context, userID string, book domain.EBookCatalogItem) (domain.EBookReading, error) {
	book, err := validateEBook(book)
	if err != nil {
		return domain.EBookReading{}, err
	}
	items, err := s.repo.ListEBookReadings(ctx, userID)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if existing, ok := findEBook(items, book.ID); ok {
		return existing, nil
	}

	seeds := curatedEBooks()
	if index := slices.IndexFunc(seeds, func(item domain.EBookCatalogItem) bool { return item.ID == book.ID }); index >= 0 {
		book = seeds[index]
	} else {
		id := gutenbergNumber(book.ID)
		if err := verifyGutenbergRights(ctx, id); err != nil {
			return domain.EBookReading{}, err
		}
		trusted := gutenbergBook(id)
		book.ContentURL, book.SourceURL = trusted.ContentURL, trusted.SourceURL
		book.Included = false
	}

	defer s.lockLiteratureUser(userID)()
	items, err = s.repo.ListEBookReadings(ctx, userID)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if existing, ok := findEBook(items, book.ID); ok {
		return existing, nil
	}
	now := s.now().UTC()
	reading := domain.EBookReading{ID: platform.NewID(), UserID: userID, Book: book, Status: "reading", Bookmarks: []domain.EBookBookmark{}, Notes: []domain.EBookNote{}, AddedAt: now, LastReadAt: now, UpdatedAt: now}
	if err := s.repo.CreateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	s.publish("ebook.added", userID, reading.ID, map[string]any{"book_id": book.ID, "title": book.Title})
	return reading, nil
}

func findEBook(items []domain.EBookReading, bookID string) (domain.EBookReading, bool) {
	index := slices.IndexFunc(items, func(item domain.EBookReading) bool { return item.Book.ID == bookID })
	if index < 0 {
		return domain.EBookReading{}, false
	}
	return items[index], true
}

func validateEBook(book domain.EBookCatalogItem) (domain.EBookCatalogItem, error) {
	book.Title = cleanEnglishText(book.Title, 240)
	book.ChineseTitle = cleanEnglishText(book.ChineseTitle, 120)
	book.Summary = cleanEnglishText(book.Summary, 600)
	book.Authors = cleanBookStrings(book.Authors, 8, 120)
	book.Subjects = cleanBookStrings(book.Subjects, 8, 160)
	if gutenbergNumber(book.ID) == "" || book.Title == "" || !allowedEBookContentURL(book.ContentURL) {
		return book, fmt.Errorf("%w: invalid or unsupported ebook metadata", domain.ErrInvalidInput)
	}
	if !allowedEBookContentURL(book.SourceURL) {
		return book, fmt.Errorf("%w: invalid ebook source", domain.ErrInvalidInput)
	}
	if book.Copyright {
		return book, fmt.Errorf("%w: copyrighted titles cannot be imported", domain.ErrInvalidInput)
	}
	return book, nil
}
func cleanBookStrings(values []string, maxItems, maxLength int) []string {
	result := []string{}
	for _, value := range values {
		value = cleanEnglishText(value, maxLength)
		if value != "" {
			result = append(result, value)
		}
		if len(result) == maxItems {
			break
		}
	}
	return result
}

func (s *Service) ListEBookReadings(ctx context.Context, userID string) ([]domain.EBookReading, error) {
	return s.repo.ListEBookReadings(ctx, userID)
}
func (s *Service) EBookReading(ctx context.Context, userID, id string) (domain.EBookReading, error) {
	reading, err := s.repo.EBookReadingByID(ctx, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if err := requireOwner(reading.UserID, userID); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}
func (s *Service) DeleteEBookReading(ctx context.Context, userID, id string) error {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteEBookReading(ctx, id); err != nil {
		return err
	}
	s.publish("ebook.removed", userID, id, map[string]any{"book_id": reading.Book.ID})
	return nil
}

func (s *Service) EBookContent(ctx context.Context, userID, readingID string) (domain.EBookContent, error) {
	reading, err := s.EBookReading(ctx, userID, readingID)
	if err != nil {
		return domain.EBookContent{}, err
	}
	s.literatureMu.RLock()
	cached, ok := s.literatureContent[reading.Book.ID]
	s.literatureMu.RUnlock()
	now := s.now().UTC()
	if ok && now.Before(cached.expiresAt) {
		content := cached.content
		content.Book = reading.Book
		return content, nil
	}
	content, err := s.loadEBookContent(ctx, reading.Book, now)
	if err != nil {
		return domain.EBookContent{}, err
	}
	s.literatureMu.Lock()
	if len(s.literatureContent) >= 10 {
		oldest := ""
		var oldestTime time.Time
		for key, entry := range s.literatureContent {
			if oldest == "" || entry.expiresAt.Before(oldestTime) {
				oldest, oldestTime = key, entry.expiresAt
			}
		}
		delete(s.literatureContent, oldest)
	}
	s.literatureContent[reading.Book.ID] = literatureContentCacheEntry{content: content, expiresAt: now.Add(6 * time.Hour)}
	s.literatureMu.Unlock()
	return content, nil
}

func extractGutenbergBody(text string) string {
	matches := ebookMarkerPattern.FindAllStringIndex(text, -1)
	if len(matches) >= 2 {
		return strings.TrimSpace(text[matches[0][1]:matches[len(matches)-1][0]])
	}
	return strings.TrimSpace(text)
}

func paginateEBook(text string, target int) []domain.EBookPage {
	paragraphs := regexp.MustCompile(`\n\s*\n+`).Split(text, -1)
	pages := []domain.EBookPage{}
	var builder strings.Builder
	chapter := "Opening"
	flush := func() {
		content := strings.TrimSpace(builder.String())
		if content != "" {
			pages = append(pages, domain.EBookPage{Index: len(pages), Chapter: chapter, Content: content})
		}
		builder.Reset()
	}
	for _, paragraph := range paragraphs {
		paragraph = strings.TrimSpace(paragraph)
		if paragraph == "" {
			continue
		}
		compact := strings.Join(strings.Fields(paragraph), " ")
		if utf8.RuneCountInString(compact) < 100 && ebookChapterPattern.MatchString(compact) {
			if builder.Len() > target/2 {
				flush()
			}
			chapter = compact
		}
		if builder.Len() > 0 && utf8.RuneCountInString(builder.String())+utf8.RuneCountInString(paragraph) > target {
			flush()
		}
		if builder.Len() > 0 {
			builder.WriteString("\n\n")
		}
		builder.WriteString(paragraph)
	}
	flush()
	return pages
}

func countLiteratureWords(text string) int {
	return len(strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '\'' }))
}

type UpdateEBookProgressInput struct {
	PageIndex, TotalPages, ReadingSecondsDelta int
	Status                                     string
}

func (s *Service) UpdateEBookProgress(ctx context.Context, userID, id string, input UpdateEBookProgressInput) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if input.PageIndex < 0 || input.TotalPages < 0 || input.ReadingSecondsDelta < 0 || input.ReadingSecondsDelta > 3600 {
		return domain.EBookReading{}, fmt.Errorf("%w: invalid reading progress", domain.ErrInvalidInput)
	}
	if input.TotalPages > 0 {
		reading.TotalPages = input.TotalPages
		reading.PageIndex = min(input.PageIndex, input.TotalPages-1)
		if input.TotalPages == 1 {
			reading.Progress = 100
		} else {
			reading.Progress = float64(reading.PageIndex) * 100 / float64(input.TotalPages-1)
		}
	}
	reading.ReadingSeconds += input.ReadingSecondsDelta
	status := strings.TrimSpace(input.Status)
	if status != "" {
		if status != "reading" && status != "completed" {
			return domain.EBookReading{}, fmt.Errorf("%w: unsupported ebook status", domain.ErrInvalidInput)
		}
		reading.Status = status
	}
	now := s.now().UTC()
	if reading.Progress >= 99.5 {
		reading.Status = "completed"
	}
	if reading.Status == "completed" && reading.CompletedAt == nil {
		reading.CompletedAt = &now
	}
	if reading.Status == "reading" {
		reading.CompletedAt = nil
	}
	reading.LastReadAt, reading.UpdatedAt = now, now
	if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}

func (s *Service) AddEBookBookmark(ctx context.Context, userID, id string, pageIndex int, label, excerpt string) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if pageIndex < 0 {
		return domain.EBookReading{}, fmt.Errorf("%w: invalid page index", domain.ErrInvalidInput)
	}
	// A page is bookmarked once, including after a double click or a retry.
	for _, bookmark := range reading.Bookmarks {
		if bookmark.PageIndex == pageIndex {
			return reading, nil
		}
	}
	label = cleanEnglishText(label, 120)
	excerpt = cleanEnglishText(excerpt, 300)
	now := s.now().UTC()
	reading.Bookmarks = append(reading.Bookmarks, domain.EBookBookmark{ID: platform.NewID(), PageIndex: pageIndex, Label: label, Excerpt: excerpt, CreatedAt: now})
	reading.UpdatedAt = now
	if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}
func (s *Service) DeleteEBookBookmark(ctx context.Context, userID, id, bookmarkID string) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	found := false
	filtered := reading.Bookmarks[:0]
	for _, bookmark := range reading.Bookmarks {
		if bookmark.ID == bookmarkID {
			found = true
			continue
		}
		filtered = append(filtered, bookmark)
	}
	if !found {
		return domain.EBookReading{}, domain.ErrNotFound
	}
	reading.Bookmarks = filtered
	reading.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}

func (s *Service) AddEBookNote(ctx context.Context, userID, id string, pageIndex int, content string) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	content = strings.TrimSpace(content)
	if pageIndex < 0 || content == "" || utf8.RuneCountInString(content) > 3000 {
		return domain.EBookReading{}, fmt.Errorf("%w: invalid ebook note", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	reading.Notes = append(reading.Notes, domain.EBookNote{ID: platform.NewID(), PageIndex: pageIndex, Content: content, CreatedAt: now, UpdatedAt: now})
	reading.UpdatedAt = now
	if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}
func (s *Service) DeleteEBookNote(ctx context.Context, userID, id, noteID string) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	found := false
	filtered := reading.Notes[:0]
	for _, note := range reading.Notes {
		if note.ID == noteID {
			found = true
			continue
		}
		filtered = append(filtered, note)
	}
	if !found {
		return domain.EBookReading{}, domain.ErrNotFound
	}
	reading.Notes = filtered
	reading.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	return reading, nil
}

func curatedEBooks() []domain.EBookCatalogItem {
	type seed struct {
		id                                   int
		title, chineseTitle, author, summary string
	}
	seeds := []seed{{1342, "Pride and Prejudice", "傲慢与偏见", "Jane Austen", "Elizabeth Bennet learns to look beyond first impressions in a sharp novel of manners."}, {11, "Alice's Adventures in Wonderland", "爱丽丝梦游仙境", "Lewis Carroll", "Alice follows a white rabbit into a playful world governed by dream logic."}, {84, "Frankenstein", "弗兰肯斯坦", "Mary Shelley", "A scientist creates life and discovers the human cost of ambition without responsibility."}, {1661, "The Adventures of Sherlock Holmes", "福尔摩斯探案集", "Arthur Conan Doyle", "Twelve cases showcase Holmes's observation, logic, and unconventional methods."}, {2701, "Moby-Dick", "白鲸", "Herman Melville", "Captain Ahab's pursuit of a white whale becomes an epic study of obsession."}, {345, "Dracula", "德古拉", "Bram Stoker", "Letters and journals tell the story of a group confronting Count Dracula."}, {98, "A Tale of Two Cities", "双城记", "Charles Dickens", "Private sacrifice unfolds against the violence of the French Revolution."}, {174, "The Picture of Dorian Gray", "道林·格雷的画像", "Oscar Wilde", "A portrait bears the marks of a young man's choices while his appearance stays unchanged."}, {768, "Wuthering Heights", "呼啸山庄", "Emily Brontë", "Love, pride, and revenge shape two generations on the Yorkshire moors."}, {1260, "Jane Eyre", "简·爱", "Charlotte Brontë", "An independent young woman seeks dignity, love, and moral freedom."}, {2554, "Crime and Punishment", "罪与罚", "Fyodor Dostoevsky", "A student's crime leads into a psychological struggle with guilt and redemption."}, {2600, "War and Peace", "战争与和平", "Leo Tolstoy", "Families, soldiers, and statesmen face war, history, and ordinary life."}, {76, "Adventures of Huckleberry Finn", "哈克贝利·费恩历险记", "Mark Twain", "A boy and an escaped enslaved man travel the Mississippi and question social rules."}, {43, "The Strange Case of Dr. Jekyll and Mr. Hyde", "化身博士", "Robert Louis Stevenson", "A respectable doctor tests the divided nature of human identity."}, {46, "A Christmas Carol", "圣诞颂歌", "Charles Dickens", "A miser is confronted by his past, present, and possible future."}, {1232, "The Prince", "君主论", "Niccolò Machiavelli", "A concise examination of political power, leadership, and statecraft."}}
	items := make([]domain.EBookCatalogItem, 0, len(seeds))
	for index, seed := range seeds {
		id := strconv.Itoa(seed.id)
		book := gutenbergBook(id)
		book.Title, book.ChineseTitle, book.Summary = seed.title, seed.chineseTitle, seed.summary
		book.Authors, book.Subjects = []string{seed.author}, []string{"Classic literature"}
		book.Featured, book.Included = index < 4, index < 4
		items = append(items, book)
	}
	return items
}
func filterCuratedEBooks(query string) []domain.EBookCatalogItem {
	result := []domain.EBookCatalogItem{}
	for _, item := range curatedEBooks() {
		if matchesEBook(item, query) {
			result = append(result, item)
		}
	}
	return result
}
