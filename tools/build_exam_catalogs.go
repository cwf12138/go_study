//go:build ignore

// Command build_exam_catalogs creates the embedded IELTS and TOEFL catalogs
// from ECDICT's tagged CSV. It is intentionally reproducible and does not
// download data; pass a locally downloaded upstream CSV with -input.
package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type word struct {
	Term              string `json:"term"`
	Phonetic          string `json:"phonetic,omitempty"`
	Translation       string `json:"translation"`
	EnglishDefinition string `json:"english_definition,omitempty"`
	Frequency         int    `json:"frequency,omitempty"`
}

type catalog struct {
	ID, Name, Description, Exam, Language      string
	SourceName, SourceURL, License, LicenseURL string
	UpstreamETag, GeneratedAt                  string
	Words                                      []word
}

func (value catalog) MarshalJSON() ([]byte, error) {
	type output struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Description  string `json:"description"`
		Exam         string `json:"exam"`
		Language     string `json:"language"`
		SourceName   string `json:"source_name"`
		SourceURL    string `json:"source_url"`
		License      string `json:"license"`
		LicenseURL   string `json:"license_url"`
		UpstreamETag string `json:"upstream_etag"`
		GeneratedAt  string `json:"generated_at"`
		Words        []word `json:"words"`
	}
	return json.Marshal(output{value.ID, value.Name, value.Description, value.Exam, value.Language, value.SourceName, value.SourceURL, value.License, value.LicenseURL, value.UpstreamETag, value.GeneratedAt, value.Words})
}

func main() {
	input := flag.String("input", "", "path to ECDICT ecdict.csv")
	outputDir := flag.String("out", "internal/vocabdata/catalogs", "output directory")
	etag := flag.String("etag", "", "upstream ETag recorded in catalog metadata")
	generatedAt := flag.String("generated-at", time.Now().UTC().Format("2006-01-02"), "reproducible generation date")
	flag.Parse()
	if *input == "" {
		fatalf("-input is required")
	}
	file, err := os.Open(*input)
	if err != nil {
		fatalf("open input: %v", err)
	}
	defer file.Close()
	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.ReuseRecord = true
	header, err := reader.Read()
	if err != nil {
		fatalf("read header: %v", err)
	}
	columns := map[string]int{}
	for index, name := range header {
		columns[strings.ToLower(strings.TrimSpace(name))] = index
	}
	for _, required := range []string{"word", "phonetic", "definition", "translation", "tag", "frq"} {
		if _, exists := columns[required]; !exists {
			fatalf("missing CSV column %q", required)
		}
	}
	books := map[string]map[string]word{"ielts": {}, "toefl": {}}
	for {
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			fatalf("read CSV: %v", readErr)
		}
		term := clean(field(record, columns["word"]))
		translation := clean(field(record, columns["translation"]))
		definition := clean(field(record, columns["definition"]))
		if term == "" || len([]rune(term)) > 160 || (translation == "" && definition == "") {
			continue
		}
		frequency, _ := strconv.Atoi(strings.TrimSpace(field(record, columns["frq"])))
		if frequency <= 0 {
			frequency = 9999999
		}
		entry := word{Term: term, Phonetic: clean(field(record, columns["phonetic"])), Translation: translation, EnglishDefinition: definition, Frequency: frequency}
		if entry.Translation == "" {
			entry.Translation = entry.EnglishDefinition
		}
		for _, tag := range strings.Fields(strings.ToLower(field(record, columns["tag"]))) {
			if words, exists := books[tag]; exists {
				words[strings.ToLower(term)] = entry
			}
		}
	}
	metadata := map[string][3]string{
		"ielts": {"IELTS 核心词汇", "雅思考试标签词汇，按现代英语语料频率优先学习。", "IELTS"},
		"toefl": {"TOEFL 核心词汇", "托福考试标签词汇，按现代英语语料频率优先学习。", "TOEFL"},
	}
	if err := os.MkdirAll(*outputDir, 0o750); err != nil {
		fatalf("create output: %v", err)
	}
	for _, id := range []string{"ielts", "toefl"} {
		words := make([]word, 0, len(books[id]))
		for _, item := range books[id] {
			words = append(words, item)
		}
		sort.Slice(words, func(i, j int) bool {
			if words[i].Frequency != words[j].Frequency {
				return words[i].Frequency < words[j].Frequency
			}
			return strings.ToLower(words[i].Term) < strings.ToLower(words[j].Term)
		})
		meta := metadata[id]
		value := catalog{ID: id, Name: meta[0], Description: meta[1], Exam: meta[2], Language: "en", SourceName: "ECDICT", SourceURL: "https://github.com/skywind3000/ECDICT", License: "MIT", LicenseURL: "https://github.com/skywind3000/ECDICT/blob/master/LICENSE", UpstreamETag: *etag, GeneratedAt: *generatedAt, Words: words}
		data, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			fatalf("marshal %s: %v", id, marshalErr)
		}
		path := filepath.Join(*outputDir, id+".json")
		if writeErr := os.WriteFile(path, append(data, '\n'), 0o640); writeErr != nil {
			fatalf("write %s: %v", id, writeErr)
		}
		fmt.Printf("%s: %d words -> %s\n", id, len(words), path)
	}
}

func field(record []string, index int) string {
	if index < 0 || index >= len(record) {
		return ""
	}
	return record[index]
}
func clean(value string) string {
	value = strings.ReplaceAll(value, "\\n", "\n")
	return strings.TrimSpace(value)
}
func fatalf(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
