package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

const ebookTextLimit = 12 << 20

//go:embed readingdata/gutenberg/*.txt.gz
var bundledEBookTexts embed.FS

func (s *Service) loadEBookContent(ctx context.Context, book domain.EBookCatalogItem, now time.Time) (domain.EBookContent, error) {
	id := gutenbergNumber(book.ID)
	if id == "" {
		return domain.EBookContent{}, domain.ErrInvalidInput
	}
	if raw, err := s.readReadingCache(book.ID+".txt", ebookTextLimit); err == nil {
		if content, err := decodeEBook(book, raw, "cache", now); err == nil {
			return content, nil
		}
	}

	// Use the same canonical edition for shipped copies and both public mirrors.
	if compressed, err := bundledEBookTexts.ReadFile("readingdata/gutenberg/" + book.ID + ".txt.gz"); err == nil {
		reader, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			return domain.EBookContent{}, err
		}
		defer reader.Close()
		raw, err := io.ReadAll(io.LimitReader(reader, ebookTextLimit+1))
		if err != nil {
			return domain.EBookContent{}, err
		}
		return decodeEBook(book, raw, "included", now)
	}

	resource := fmt.Sprintf("/cache/epub/%s/pg%s.txt", id, id)
	sources := []struct {
		origin  string
		timeout time.Duration
	}{{gutenbergMirror, 44 * time.Second}, {gutenbergWebsite, 8 * time.Second}}
	for _, source := range sources {
		raw, err := fetchGutenberg(ctx, source.origin+resource, ebookTextLimit, source.timeout)
		if err != nil {
			continue
		}
		content, err := decodeEBook(book, raw, "online", now)
		if err != nil {
			continue
		}
		s.cacheBookText(book.ID, raw)
		return content, nil
	}
	if err := ctx.Err(); err != nil {
		return domain.EBookContent{}, err
	}
	return domain.EBookContent{}, domain.ErrReadingSourceUnavailable
}

func (s *Service) cacheBookText(bookID string, text []byte) {
	if s.readingCacheDir == "" {
		return
	}
	s.literatureMu.Lock()
	defer s.literatureMu.Unlock()
	if err := s.writeReadingCache(bookID+".txt", text); err != nil {
		return
	}
	files, err := os.ReadDir(s.readingCacheDir)
	if err != nil {
		return
	}
	type cachedBook struct {
		name  string
		saved time.Time
	}
	cached := make([]cachedBook, 0, len(files))
	for _, entry := range files {
		name, ok := strings.CutSuffix(entry.Name(), ".txt")
		if !ok || gutenbergNumber(name) == "" || !entry.Type().IsRegular() {
			continue
		}
		if info, err := entry.Info(); err == nil {
			cached = append(cached, cachedBook{entry.Name(), info.ModTime()})
		}
	}
	slices.SortFunc(cached, func(a, b cachedBook) int { return b.saved.Compare(a.saved) })
	if len(cached) > 24 {
		for _, item := range cached[24:] {
			_ = os.Remove(filepath.Join(s.readingCacheDir, item.name))
		}
	}
}

func fetchGutenberg(ctx context.Context, source string, limit int64, timeout time.Duration) ([]byte, error) {
	client := &http.Client{Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Host != via[0].URL.Host || req.URL.User != nil {
			return errors.New("unsupported Gutenberg redirect")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Daynest/1.0 (personal library)")
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Gutenberg returned HTTP %d", response.StatusCode)
	}
	if strings.HasPrefix(response.Header.Get("Content-Type"), "text/html") {
		return nil, errors.New("Gutenberg returned an HTML page")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("Gutenberg response exceeds size limit")
	}
	return data, nil
}

func decodeEBook(book domain.EBookCatalogItem, raw []byte, origin string, now time.Time) (domain.EBookContent, error) {
	if len(raw) > ebookTextLimit || !utf8.Valid(raw) {
		return domain.EBookContent{}, errors.New("invalid Gutenberg text")
	}
	text := strings.ReplaceAll(strings.TrimPrefix(string(raw), "\ufeff"), "\r\n", "\n")
	markers := ebookMarkerPattern.FindAllStringSubmatchIndex(text, 2)
	if len(markers) != 2 || !strings.EqualFold(text[markers[0][2]:markers[0][3]], "START") ||
		!strings.EqualFold(text[markers[1][2]:markers[1][3]], "END") {
		return domain.EBookContent{}, errors.New("incomplete Gutenberg text")
	}
	text = extractGutenbergBody(text)
	pages := paginateEBook(text, 3600)
	if len(pages) == 0 {
		return domain.EBookContent{}, errors.New("ebook contains no readable text")
	}
	return domain.EBookContent{
		Book: book, Pages: pages, TotalWords: countLiteratureWords(text), ContentOrigin: origin,
		LicenseNotice: "Project Gutenberg 纯文本版本。请查阅 Project Gutenberg 许可及你所在地区的版权规定。",
		FetchedAt:     now,
	}, nil
}
