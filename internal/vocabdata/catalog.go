package vocabdata

import (
	"embed"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

//go:embed catalogs/*.json
var catalogFiles embed.FS
var loadCatalogsOnce sync.Once
var loadedCatalogs map[string]Catalog
var loadedCatalogsErr error

type Word struct {
	Term              string `json:"term"`
	Phonetic          string `json:"phonetic,omitempty"`
	Translation       string `json:"translation"`
	EnglishDefinition string `json:"english_definition,omitempty"`
	Frequency         int    `json:"frequency,omitempty"`
}

type Catalog struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Exam         string `json:"exam"`
	Language     string `json:"language"`
	SourceName   string `json:"source_name"`
	SourceURL    string `json:"source_url"`
	License      string `json:"license"`
	LicenseURL   string `json:"license_url"`
	UpstreamETag string `json:"upstream_etag,omitempty"`
	GeneratedAt  string `json:"generated_at"`
	Words        []Word `json:"words"`
}

type CatalogSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Exam        string `json:"exam"`
	Language    string `json:"language"`
	WordCount   int    `json:"word_count"`
	SourceName  string `json:"source_name"`
	SourceURL   string `json:"source_url"`
	License     string `json:"license"`
	LicenseURL  string `json:"license_url"`
	GeneratedAt string `json:"generated_at"`
}

func IDs() []string { return []string{"ielts", "toefl"} }

func Load(id string) (Catalog, error) {
	if id != "ielts" && id != "toefl" {
		return Catalog{}, fmt.Errorf("unknown vocabulary catalog %q", id)
	}
	loadCatalogsOnce.Do(func() {
		loadedCatalogs = make(map[string]Catalog, len(IDs()))
		for _, catalogID := range IDs() {
			data, err := catalogFiles.ReadFile("catalogs/" + catalogID + ".json")
			if err != nil {
				loadedCatalogsErr = err
				return
			}
			var catalog Catalog
			if err := json.Unmarshal(data, &catalog); err != nil {
				loadedCatalogsErr = err
				return
			}
			if catalog.ID != catalogID || len(catalog.Words) == 0 {
				loadedCatalogsErr = fmt.Errorf("invalid embedded vocabulary catalog %q", catalogID)
				return
			}
			loadedCatalogs[catalogID] = catalog
		}
	})
	if loadedCatalogsErr != nil {
		return Catalog{}, loadedCatalogsErr
	}
	return loadedCatalogs[id], nil
}

func Summaries() ([]CatalogSummary, error) {
	items := make([]CatalogSummary, 0, len(IDs()))
	for _, id := range IDs() {
		catalog, err := Load(id)
		if err != nil {
			return nil, err
		}
		items = append(items, CatalogSummary{ID: catalog.ID, Name: catalog.Name, Description: catalog.Description, Exam: catalog.Exam, Language: catalog.Language, WordCount: len(catalog.Words), SourceName: catalog.SourceName, SourceURL: catalog.SourceURL, License: catalog.License, LicenseURL: catalog.LicenseURL, GeneratedAt: catalog.GeneratedAt})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items, nil
}
