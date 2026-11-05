package httpapi

import (
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"net/http"
	"strings"
	"time"
)

func recordCondition(r *http.Request, pathID string, required bool) ([]string, error) {
	values := r.Header.Values("If-Match")
	if len(values) == 0 && !required {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("%w: one strong If-Match is required", domain.ErrInvalidInput)
	}
	value := strings.TrimSpace(values[0])
	if len(value) < 4 || len(value) > 500 || value[0] != '"' || value[len(value)-1] != '"' || strings.ContainsAny(value[1:len(value)-1], "\"\\,") {
		return nil, domain.ErrInvalidInput
	}
	version := value[1 : len(value)-1]
	index := strings.LastIndex(version, "@")
	if index < 1 || version[:index] != r.PathValue(pathID) {
		return nil, domain.ErrInvalidInput
	}
	if _, err := time.Parse(time.RFC3339Nano, version[index+1:]); err != nil {
		return nil, domain.ErrInvalidInput
	}
	return []string{version}, nil
}
