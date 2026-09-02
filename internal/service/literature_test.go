package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestPaginateEBookExtractsGutenbergWrapperAndChapters(t *testing.T) {
	raw := "Project Gutenberg header\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\nCHAPTER I\n\n" + strings.Repeat("A readable paragraph with several words. ", 130) + "\n\nCHAPTER II\n\n" + strings.Repeat("Another paragraph continues the story. ", 130) + "\n\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nlicense"
	body := extractGutenbergBody(raw)
	if strings.Contains(body, "Project Gutenberg header") || strings.Contains(body, "license") {
		t.Fatalf("wrapper was not removed: %.80s", body)
	}
	pages := paginateEBook(body, 900)
	if len(pages) < 4 || pages[0].Chapter != "CHAPTER I" {
		t.Fatalf("pages=%d first=%#v", len(pages), pages[0])
	}
	foundSecond := false
	for _, page := range pages {
		if page.Chapter == "CHAPTER II" {
			foundSecond = true
		}
	}
	if !foundSecond {
		t.Fatalf("second chapter not detected: %#v", pages)
	}
}

func TestEBookReadingAndClassicalStudyWorkflow(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	now := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	book := domain.EBookCatalogItem{ID: "pg-1342", Title: "Pride and Prejudice", ChineseTitle: "傲慢与偏见", Authors: []string{"Jane Austen"}, Summary: "A classic.", Language: "en", ContentURL: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt", SourceURL: "https://www.gutenberg.org/ebooks/1342"}
	reading, err := svc.AddEBook(ctx, "user-1", book)
	if err != nil {
		t.Fatalf("AddEBook: %v", err)
	}
	reading, err = svc.UpdateEBookProgress(ctx, "user-1", reading.ID, UpdateEBookProgressInput{PageIndex: 4, TotalPages: 10, ReadingSecondsDelta: 125})
	if err != nil || reading.Progress < 44 || reading.ReadingSeconds != 125 {
		t.Fatalf("progress=%#v err=%v", reading, err)
	}
	reading, err = svc.AddEBookBookmark(ctx, "user-1", reading.ID, 4, "Chapter II", "An excerpt")
	if err != nil || len(reading.Bookmarks) != 1 {
		t.Fatalf("bookmark=%#v err=%v", reading.Bookmarks, err)
	}
	reading, err = svc.AddEBookNote(ctx, "user-1", reading.ID, 4, "Elizabeth changes her judgment.")
	if err != nil || len(reading.Notes) != 1 {
		t.Fatalf("notes=%#v err=%v", reading.Notes, err)
	}
	favorite, status, notes := true, "mastered", "由月光引出乡愁。"
	study, err := svc.UpdateClassicalStudy(ctx, "user-1", "tang-jing-ye-si", UpdateClassicalStudyInput{Favorite: &favorite, Status: &status, Notes: &notes, IncrementRecitation: true})
	if err != nil || !study.Favorite || study.RecitationCount != 1 {
		t.Fatalf("study=%#v err=%v", study, err)
	}
	overview, err := svc.LiteratureOverview(ctx, "user-1")
	if err != nil || overview.BooksInShelf != 1 || overview.Bookmarks != 1 || overview.ReadingMinutes != 2 || overview.ClassicsMastered != 1 {
		t.Fatalf("overview=%#v err=%v", overview, err)
	}
	if matches := filterCuratedEBooks("傲慢与偏见"); len(matches) != 1 || matches[0].ID != "pg-1342" {
		t.Fatalf("Chinese title search=%#v", matches)
	}
}

func TestClassicalWorksKeepAlignedLearningTranslations(t *testing.T) {
	works := classicalWorks()
	if len(works) < 10 {
		t.Fatalf("work count=%d", len(works))
	}
	for _, work := range works {
		if len(work.Text) == 0 || len(work.Text) != len(work.Translation) || work.Appreciation == "" || work.Background == "" {
			t.Fatalf("incomplete classical work: %#v", work)
		}
	}
}

func TestValidateEBookRejectsLookalikeGutenbergHost(t *testing.T) {
	book := domain.EBookCatalogItem{ID: "pg-1", Title: "Unsafe", ContentURL: "https://gutenberg.org.example.com/book.txt", SourceURL: "https://evilgutenberg.org/ebooks/1"}
	if _, err := validateEBook(book); err == nil {
		t.Fatal("validateEBook accepted a lookalike Gutenberg host")
	}
}
