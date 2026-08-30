package vocabdata

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

func TestEmbeddedExamCatalogsAreCompleteDeterministicAndAttributed(t *testing.T) {
	expectedCounts := map[string]int{"ielts": 5040, "toefl": 6974}
	for id, expected := range expectedCounts {
		catalog, err := Load(id)
		if err != nil {
			t.Fatal(err)
		}
		if len(catalog.Words) != expected {
			t.Fatalf("%s contains %d words, want %d", id, len(catalog.Words), expected)
		}
		if catalog.SourceName != "ECDICT" || catalog.SourceURL == "" || catalog.License != "MIT" || catalog.LicenseURL == "" || catalog.GeneratedAt != "2026-08-31" {
			t.Fatalf("%s attribution metadata is incomplete: %+v", id, catalog)
		}
		seen := make(map[string]struct{}, len(catalog.Words))
		lastFrequency := 0
		for index, word := range catalog.Words {
			if strings.TrimSpace(word.Term) == "" || strings.TrimSpace(word.Translation) == "" {
				t.Fatalf("%s word %d is incomplete: %+v", id, index, word)
			}
			combinedDefinition := word.Translation
			if word.EnglishDefinition != "" && !strings.EqualFold(word.EnglishDefinition, word.Translation) {
				combinedDefinition += "\n" + word.EnglishDefinition
			}
			if utf8.RuneCountInString(word.Term) > 160 || utf8.RuneCountInString(word.Phonetic) > 200 || utf8.RuneCountInString(combinedDefinition) > 3000 || word.Frequency <= 0 {
				t.Fatalf("%s word %q exceeds domain limits", id, word.Term)
			}
			key := strings.ToLower(word.Term)
			if _, exists := seen[key]; exists {
				t.Fatalf("%s contains duplicate term %q", id, word.Term)
			}
			seen[key] = struct{}{}
			if word.Frequency < lastFrequency {
				t.Fatalf("%s is not sorted by frequency at %q", id, word.Term)
			}
			lastFrequency = word.Frequency
		}
	}
	if _, err := Load("gre"); err == nil {
		t.Fatal("unknown catalog should fail")
	}
}

func TestCatalogCacheSupportsConcurrentReads(t *testing.T) {
	var group sync.WaitGroup
	errCh := make(chan error, 40)
	for index := 0; index < 40; index++ {
		group.Add(1)
		go func(id string) {
			defer group.Done()
			catalog, err := Load(id)
			if err == nil && len(catalog.Words) == 0 {
				err = errors.New("catalog is empty")
			}
			if err != nil {
				errCh <- err
			}
		}(IDs()[index%2])
	}
	group.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
}
