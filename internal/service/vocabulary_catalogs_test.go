package service

import (
	"context"
	"sync"
	"testing"

	"github.com/example/studyflow/internal/store"
	"github.com/example/studyflow/internal/vocabdata"
)

func TestImportVocabularyCatalogIsBulkIdempotentAndUsesFrequencyOrder(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	before, err := svc.ListVocabularyCatalogs(ctx, "catalog-user")
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != 2 || before[0].Installed || before[1].Installed {
		t.Fatalf("unexpected catalog state before import: %+v", before)
	}

	result, err := svc.ImportVocabularyCatalog(ctx, "catalog-user", "ielts", ImportVocabularyCatalogInput{DailyNewLimit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 5040 || result.Skipped != 0 || result.Total != 5040 || result.Book.SourceID != "ielts" || result.Book.SourceName != "ECDICT" || result.Book.License != "MIT" || result.Book.DailyNewLimit != 25 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	queue, err := svc.VocabularyQueue(ctx, "catalog-user", result.Book.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	catalog, _ := vocabdata.Load("ielts")
	if len(queue) != 25 || queue[0].Term != catalog.Words[0].Term {
		t.Fatalf("queue does not respect daily limit/frequency: count=%d first=%q want=%q", len(queue), queue[0].Term, catalog.Words[0].Term)
	}

	again, err := svc.ImportVocabularyCatalog(ctx, "catalog-user", "IELTS", ImportVocabularyCatalogInput{DailyNewLimit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if again.Book.ID != result.Book.ID || again.Added != 0 || again.Skipped != 5040 || again.Total != 5040 {
		t.Fatalf("catalog import is not idempotent: %+v", again)
	}
	after, err := svc.ListVocabularyCatalogs(ctx, "catalog-user")
	if err != nil {
		t.Fatal(err)
	}
	if !after[0].Installed || after[0].InstalledWordCount != 5040 {
		t.Fatalf("catalog installation state is incorrect: %+v", after[0])
	}
}

func TestConcurrentVocabularyCatalogImportCreatesOneCompleteBook(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	var group sync.WaitGroup
	errCh := make(chan error, 4)
	for index := 0; index < 4; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := svc.ImportVocabularyCatalog(ctx, "concurrent-catalog-user", "ielts", ImportVocabularyCatalogInput{DailyNewLimit: 20})
			errCh <- err
		}()
	}
	group.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	books, err := repository.ListWordBooks(ctx, "concurrent-catalog-user")
	if err != nil {
		t.Fatal(err)
	}
	sourceBooks := 0
	var sourceBookID string
	for _, book := range books {
		if book.SourceID == "ielts" {
			sourceBooks++
			sourceBookID = book.ID
		}
	}
	if sourceBooks != 1 {
		t.Fatalf("created %d IELTS books, want 1", sourceBooks)
	}
	words, err := repository.ListVocabularyWords(ctx, "concurrent-catalog-user", sourceBookID)
	if err != nil {
		t.Fatal(err)
	}
	if len(words) != 5040 {
		t.Fatalf("concurrent import produced %d words, want 5040", len(words))
	}
}
