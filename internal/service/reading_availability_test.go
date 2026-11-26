package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/store"
)

func TestBookIndexSearchAndEditionRights(t *testing.T) {
	const catalog = "Text#,Type,Issued,Title,Language,Authors\n" +
		"35,Text,1992-03-01,The Time Machine,en,\"Wells, H. G.\"\n" +
		"98035,Sound,2026-01-01,The Time Machine,en,\"Wells, H. G.\"\n" +
		"98036,Text,2026-01-01,La máquina del tiempo,es,\"Wells, H. G.\"\n"
	items, err := parseBookIndex([]byte(catalog))
	if err != nil || len(items) != 1 || items[0].ID != "pg-35" {
		t.Fatalf("index items=%v, err=%v", items, err)
	}
	svc := New(store.NewMemory(), nil, nil)
	svc.literatureIndex = items
	for _, query := range []string{"Time Wells", "35", "PG-35"} {
		result, err := svc.SearchEBooks(context.Background(), query)
		if err != nil || result.Degraded || len(result.Items) != 1 || result.Items[0].ID != "pg-35" {
			t.Fatalf("query %q: result=%+v, err=%v", query, result, err)
		}
	}
	rdf := []byte(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/" xmlns:dcterms="http://purl.org/dc/terms/"><pgterms:ebook rdf:about="ebooks/35"><dcterms:rights>Public domain in the USA.</dcterms:rights></pgterms:ebook></rdf:RDF>`)
	if !publicDomainEBook(rdf, "35") || publicDomainEBook(rdf, "36") ||
		publicDomainEBook([]byte(strings.ReplaceAll(string(rdf), "Public domain in the USA.", "Copyrighted. Read the copyright notice inside this book for details.")), "35") {
		t.Fatal("rights must explicitly authorize the selected edition")
	}
}

func TestBundledBooksAndPersistentText(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	dir := t.TempDir()
	if err := svc.SetReadingCache(dir); err != nil {
		t.Fatal(err)
	}
	for _, book := range curatedEBooks() {
		if !book.Included {
			continue
		}
		reading, err := svc.AddEBook(ctx, "reader", book)
		if err != nil {
			t.Fatal(err)
		}
		content, err := svc.EBookContent(ctx, "reader", reading.ID)
		if err != nil || content.ContentOrigin != "included" || content.TotalWords < 25_000 || len(content.Pages) < 20 {
			t.Fatalf("%s: pages=%d words=%d origin=%q err=%v", book.ID, len(content.Pages), content.TotalWords, content.ContentOrigin, err)
		}
	}

	remote := gutenbergBook("35")
	text := []byte("*** START OF THIS PROJECT GUTENBERG EBOOK TEST ***\r\n\r\nChapter I\r\nSome readable text.\r\n\r\n*** END OF THIS PROJECT GUTENBERG EBOOK TEST ***\r\n")
	svc.cacheBookText(remote.ID, text)
	restarted := New(repo, nil, nil)
	if err := restarted.SetReadingCache(dir); err != nil {
		t.Fatal(err)
	}
	content, err := restarted.loadEBookContent(ctx, remote, now)
	if err != nil || content.ContentOrigin != "cache" || len(content.Pages) != 1 || !strings.Contains(content.Pages[0].Content, "Some readable text.") {
		t.Fatalf("cached text: %+v, %v", content, err)
	}
	if _, err := decodeEBook(remote, []byte("<html>Service unavailable</html>"), "online", now); err == nil {
		t.Fatal("an upstream HTML error must never become a book")
	}
}
