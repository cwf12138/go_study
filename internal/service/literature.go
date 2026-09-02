package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type literatureCatalogCacheEntry struct {
	catalog   domain.EBookCatalog
	expiresAt time.Time
}
type literatureContentCacheEntry struct {
	content   domain.EBookContent
	expiresAt time.Time
}

type gutendexResponse struct {
	Results []gutendexBook `json:"results"`
}
type gutendexBook struct {
	ID        int      `json:"id"`
	Title     string   `json:"title"`
	Subjects  []string `json:"subjects"`
	Summaries []string `json:"summaries"`
	Authors   []struct {
		Name string `json:"name"`
	} `json:"authors"`
	Languages     []string          `json:"languages"`
	Copyright     bool              `json:"copyright"`
	Formats       map[string]string `json:"formats"`
	DownloadCount int               `json:"download_count"`
}

var ebookMarkerPattern = regexp.MustCompile(`(?im)^\*\*\*\s*(?:START|END) OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$`)
var ebookChapterPattern = regexp.MustCompile(`(?i)^(chapter|book|part|volume)\s+([ivxlcdm0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b.*$`)

func (s *Service) SearchEBooks(ctx context.Context, query string) (domain.EBookCatalog, error) {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 120 {
		return domain.EBookCatalog{}, fmt.Errorf("%w: search query is too long", domain.ErrInvalidInput)
	}
	key := strings.ToLower(query)
	now := s.now().UTC()
	s.literatureMu.RLock()
	cached, ok := s.literatureCatalog[key]
	s.literatureMu.RUnlock()
	if ok && now.Before(cached.expiresAt) {
		return cached.catalog, nil
	}
	if query == "" {
		catalog := domain.EBookCatalog{Items: curatedEBooks(), Provider: "StudyFlow curated Project Gutenberg catalog"}
		s.cacheEBookCatalog(key, catalog, now)
		return catalog, nil
	}
	endpoint, _ := url.Parse("https://gutendex.com/books")
	params := endpoint.Query()
	params.Set("search", query)
	params.Set("languages", "en")
	params.Set("copyright", "false")
	endpoint.RawQuery = params.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	req.Header.Set("User-Agent", "StudyFlow/1.0 (local personal ebook reader)")
	client := &http.Client{Timeout: 7 * time.Second}
	response, err := client.Do(req)
	if err == nil {
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			err = fmt.Errorf("catalog returned %s", response.Status)
		}
	}
	var payload gutendexResponse
	if err == nil {
		err = json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload)
	}
	items := make([]domain.EBookCatalogItem, 0, len(payload.Results))
	if err == nil {
		for _, book := range payload.Results {
			if item, usable := convertGutendexBook(book); usable {
				items = append(items, item)
			}
			if len(items) == 24 {
				break
			}
		}
	}
	catalog := domain.EBookCatalog{Items: items, Query: query, Provider: "Gutendex / Project Gutenberg"}
	if err != nil || len(items) == 0 {
		catalog.Items = filterCuratedEBooks(query)
		catalog.Provider = "StudyFlow offline catalog"
		catalog.Degraded = true
	}
	s.cacheEBookCatalog(key, catalog, now)
	return catalog, nil
}

func (s *Service) cacheEBookCatalog(key string, catalog domain.EBookCatalog, now time.Time) {
	s.literatureMu.Lock()
	defer s.literatureMu.Unlock()
	if len(s.literatureCatalog) > 60 {
		for cacheKey := range s.literatureCatalog {
			delete(s.literatureCatalog, cacheKey)
			break
		}
	}
	s.literatureCatalog[key] = literatureCatalogCacheEntry{catalog: catalog, expiresAt: now.Add(30 * time.Minute)}
}

func convertGutendexBook(book gutendexBook) (domain.EBookCatalogItem, bool) {
	if book.Copyright || book.ID <= 0 || strings.TrimSpace(book.Title) == "" {
		return domain.EBookCatalogItem{}, false
	}
	contentURL := preferredTextFormat(book.Formats)
	if contentURL == "" || !allowedEBookContentURL(contentURL) {
		return domain.EBookCatalogItem{}, false
	}
	authors := make([]string, 0, len(book.Authors))
	for _, author := range book.Authors {
		if name := strings.TrimSpace(author.Name); name != "" {
			authors = append(authors, name)
		}
	}
	language := "en"
	if len(book.Languages) > 0 {
		language = book.Languages[0]
	}
	summary := "A public-domain classic available for focused reading in StudyFlow."
	if len(book.Summaries) > 0 {
		summary = cleanEnglishText(book.Summaries[0], 420)
	}
	cover := preferredFormat(book.Formats, "image/jpeg")
	subjects := append([]string(nil), book.Subjects...)
	if len(subjects) > 5 {
		subjects = subjects[:5]
	}
	return domain.EBookCatalogItem{ID: "pg-" + strconv.Itoa(book.ID), Title: cleanEnglishText(book.Title, 240), Authors: authors, Summary: summary, Language: language, Subjects: subjects, CoverURL: cover, ContentURL: contentURL, SourceURL: fmt.Sprintf("https://www.gutenberg.org/ebooks/%d", book.ID), DownloadCount: book.DownloadCount}, true
}

func preferredTextFormat(formats map[string]string) string {
	for _, key := range []string{"text/plain; charset=utf-8", "text/plain; charset=us-ascii", "text/plain"} {
		if value := strings.TrimSpace(formats[key]); value != "" {
			return value
		}
	}
	for kind, value := range formats {
		if strings.HasPrefix(strings.ToLower(kind), "text/plain") && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func preferredFormat(formats map[string]string, prefix string) string {
	for kind, value := range formats {
		if strings.HasPrefix(strings.ToLower(kind), prefix) {
			return value
		}
	}
	return ""
}

func allowedEBookContentURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "gutenberg.org" || strings.HasSuffix(host, ".gutenberg.org")
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
	for _, reading := range items {
		if reading.Book.ID == book.ID {
			return reading, nil
		}
	}
	now := s.now().UTC()
	reading := domain.EBookReading{ID: platform.NewID(), UserID: userID, Book: book, Status: "reading", Bookmarks: []domain.EBookBookmark{}, Notes: []domain.EBookNote{}, AddedAt: now, LastReadAt: now, UpdatedAt: now}
	if err := s.repo.CreateEBookReading(ctx, reading); err != nil {
		return domain.EBookReading{}, err
	}
	s.publish("ebook.added", userID, reading.ID, map[string]any{"book_id": book.ID, "title": book.Title})
	return reading, nil
}

func validateEBook(book domain.EBookCatalogItem) (domain.EBookCatalogItem, error) {
	book.Title = cleanEnglishText(book.Title, 240)
	book.ChineseTitle = cleanEnglishText(book.ChineseTitle, 120)
	book.Summary = cleanEnglishText(book.Summary, 600)
	book.Authors = cleanBookStrings(book.Authors, 8, 120)
	book.Subjects = cleanBookStrings(book.Subjects, 8, 160)
	if !regexp.MustCompile(`^pg-[0-9]+$`).MatchString(book.ID) || book.Title == "" || !allowedEBookContentURL(book.ContentURL) {
		return book, fmt.Errorf("%w: invalid or unsupported ebook metadata", domain.ErrInvalidInput)
	}
	parsed, err := url.Parse(book.SourceURL)
	host := strings.ToLower(parsed.Hostname())
	if err != nil || parsed.Scheme != "https" || (host != "gutenberg.org" && !strings.HasSuffix(host, ".gutenberg.org")) {
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
		return cached.content, nil
	}
	content, err := fetchEBookContent(ctx, reading.Book, now)
	if err != nil {
		return domain.EBookContent{}, fmt.Errorf("%w: unable to download ebook text: %v", domain.ErrInvalidState, err)
	}
	s.literatureMu.Lock()
	if len(s.literatureContent) > 10 {
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

func fetchEBookContent(ctx context.Context, book domain.EBookCatalogItem, now time.Time) (domain.EBookContent, error) {
	if !allowedEBookContentURL(book.ContentURL) {
		return domain.EBookContent{}, fmt.Errorf("unsupported content host")
	}
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if !allowedEBookContentURL(req.URL.String()) {
			return fmt.Errorf("redirected to unsupported host")
		}
		return nil
	}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, book.ContentURL, nil)
	req.Header.Set("User-Agent", "StudyFlow/1.0 (local personal ebook reader)")
	response, err := client.Do(req)
	if err != nil {
		return domain.EBookContent{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return domain.EBookContent{}, fmt.Errorf("source returned %s", response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (12<<20)+1))
	if err != nil {
		return domain.EBookContent{}, err
	}
	if len(data) > 12<<20 {
		return domain.EBookContent{}, fmt.Errorf("ebook exceeds 12 MiB limit")
	}
	text := strings.ToValidUTF8(string(data), "�")
	text = strings.TrimPrefix(text, "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = extractGutenbergBody(text)
	pages := paginateEBook(text, 3600)
	if len(pages) == 0 {
		return domain.EBookContent{}, fmt.Errorf("ebook contains no readable text")
	}
	return domain.EBookContent{Book: book, Pages: pages, TotalWords: countLiteratureWords(text), LicenseNotice: "This reader displays a reformatted copy of a Project Gutenberg text. Copyright status is determined under U.S. law; users outside the United States should check local law. See the source page and Project Gutenberg License.", FetchedAt: now}, nil
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
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	if pageIndex < 0 {
		return domain.EBookReading{}, fmt.Errorf("%w: invalid page index", domain.ErrInvalidInput)
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
		items = append(items, domain.EBookCatalogItem{ID: "pg-" + id, Title: seed.title, ChineseTitle: seed.chineseTitle, Authors: []string{seed.author}, Summary: seed.summary, Language: "en", Subjects: []string{"Classic literature"}, ContentURL: "https://www.gutenberg.org/cache/epub/" + id + "/pg" + id + ".txt", SourceURL: "https://www.gutenberg.org/ebooks/" + id, Featured: index < 4})
	}
	return items
}
func filterCuratedEBooks(query string) []domain.EBookCatalogItem {
	query = strings.ToLower(query)
	result := []domain.EBookCatalogItem{}
	for _, item := range curatedEBooks() {
		if strings.Contains(strings.ToLower(item.Title+" "+item.ChineseTitle+" "+strings.Join(item.Authors, " ")), query) {
			result = append(result, item)
		}
	}
	return result
}
