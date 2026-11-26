package service

import (
	"bytes"
	"compress/gzip"
	"context"
	_ "embed"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
)

const (
	gutenbergMirror   = "https://gutenberg.pglaf.org"
	gutenbergWebsite  = "https://www.gutenberg.org"
	bookIndexFile     = "pg_catalog.csv.gz"
	bookArchiveLimit  = 10 << 20
	bookIndexLimit    = 32 << 20
	bookIndexInterval = 7 * 24 * time.Hour
)

//go:embed readingdata/gutenberg/english-index.csv.gz
var bundledBookIndex []byte

var bundledBookIndexDate = time.Date(2026, 11, 25, 0, 0, 0, 0, time.FixedZone("UTC+8", 8*60*60))

func gutenbergBook(id string) domain.EBookCatalogItem {
	return domain.EBookCatalogItem{
		ID:         "pg-" + id,
		Language:   "en",
		ContentURL: fmt.Sprintf("%s/cache/epub/%s/pg%s.txt", gutenbergWebsite, id, id),
		SourceURL:  gutenbergWebsite + "/ebooks/" + id,
	}
}

func gutenbergNumber(bookID string) string {
	id, ok := strings.CutPrefix(bookID, "pg-")
	number, err := strconv.Atoi(id)
	if !ok || err != nil || number <= 0 || strconv.Itoa(number) != id {
		return ""
	}
	return id
}

func parseBookIndex(data []byte) ([]domain.EBookCatalogItem, error) {
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\ufeff"))))
	reader.ReuseRecord = true
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}
	columns := make(map[string]int, len(header))
	for i, name := range header {
		columns[name] = i
	}
	for _, field := range []string{"Text#", "Type", "Language", "Title", "Authors"} {
		if _, exists := columns[field]; !exists {
			return nil, fmt.Errorf("catalog missing %s", field)
		}
	}
	var items []domain.EBookCatalogItem
	for {
		row, err := reader.Read()
		if errors.Is(err, io.EOF) {
			return items, nil
		}
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(row[columns["Type"]], "Text") || !hasEnglishLanguage(row[columns["Language"]]) {
			continue
		}
		id := row[columns["Text#"]]
		title := cleanEnglishText(row[columns["Title"]], 240)
		if title == "" || gutenbergNumber("pg-"+id) == "" {
			continue
		}
		book := gutenbergBook(id)
		book.Title = title
		book.Authors = cleanBookStrings(strings.Split(row[columns["Authors"]], ";"), 8, 120)
		items = append(items, book)
	}
}

func hasEnglishLanguage(languages string) bool {
	for _, lang := range strings.FieldsFunc(languages, func(r rune) bool { return r == ';' || r == ',' || r == ' ' }) {
		if lang == "en" {
			return true
		}
	}
	return false
}

func (s *Service) loadBookIndex() {
	if s.readingCacheDir != "" {
		info, err := os.Stat(filepath.Join(s.readingCacheDir, bookIndexFile))
		if err == nil && !info.ModTime().Before(bundledBookIndexDate) {
			if data, err := s.readReadingCache(bookIndexFile, bookArchiveLimit); err == nil {
				if items, err := decodeBookIndex(data); err == nil {
					s.literatureIndex, s.literatureIndexed = items, info.ModTime()
					return
				}
			}
		}
	}
	if items, err := decodeBookIndex(bundledBookIndex); err == nil {
		s.literatureIndex, s.literatureIndexed = items, bundledBookIndexDate
	}
}

func decodeBookIndex(data []byte) ([]domain.EBookCatalogItem, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	raw, err := io.ReadAll(io.LimitReader(reader, bookIndexLimit+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > bookIndexLimit {
		return nil, errors.New("Gutenberg catalog exceeds size limit")
	}
	items, err := parseBookIndex(raw)
	if err != nil {
		return nil, err
	}
	if len(items) < 10_000 {
		return nil, errors.New("incomplete Gutenberg catalog")
	}
	return items, nil
}

func (s *Service) RefreshBookCatalogPeriodically(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		s.literatureMu.RLock()
		last := s.literatureIndexed
		s.literatureMu.RUnlock()
		if s.now().Sub(last) >= bookIndexInterval {
			if err := s.refreshBookIndex(ctx); err != nil && ctx.Err() == nil {
				logger.Warn("Gutenberg catalog refresh deferred", "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) refreshBookIndex(ctx context.Context) error {
	data, err := fetchGutenberg(ctx, gutenbergMirror+"/cache/epub/feeds/"+bookIndexFile, bookArchiveLimit, 10*time.Minute)
	if err != nil {
		return err
	}
	items, err := decodeBookIndex(data)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_ = s.writeReadingCache(bookIndexFile, data)
	s.literatureMu.Lock()
	s.literatureIndex, s.literatureIndexed = items, s.now().UTC()
	s.literatureMu.Unlock()
	return nil
}

// A CSV record has no rights field. Verify the edition's RDF before the first import.
func verifyGutenbergRights(ctx context.Context, id string) error {
	resource := fmt.Sprintf("/cache/epub/%s/pg%s.rdf", id, id)
	data, err := fetchGutenberg(ctx, gutenbergMirror+resource, 2<<20, 7*time.Second)
	if err != nil {
		return fmt.Errorf("%w: 暂时无法核对该版本的版权状态，请稍后重试", domain.ErrInvalidState)
	}
	if !publicDomainEBook(data, id) {
		return fmt.Errorf("%w: 该版本没有可核实的美国公版标记", domain.ErrInvalidInput)
	}
	return nil
}

func publicDomainEBook(data []byte, id string) bool {
	var document struct {
		Books []struct {
			About  string   `xml:"http://www.w3.org/1999/02/22-rdf-syntax-ns# about,attr"`
			Rights []string `xml:"http://purl.org/dc/terms/ rights"`
		} `xml:"http://www.gutenberg.org/2009/pgterms/ ebook"`
	}
	if xml.Unmarshal(data, &document) != nil {
		return false
	}
	for _, book := range document.Books {
		if book.About == "ebooks/"+id && len(book.Rights) == 1 && strings.TrimSpace(book.Rights[0]) == "Public domain in the USA." {
			return true
		}
	}
	return false
}
