package httpapi

import (
	"fmt"
	"time"

	"github.com/example/studyflow/internal/domain"
)

var timeSince = time.Since

func invalidJSON(err error) error {
	return fmt.Errorf("%w: invalid JSON body: %v", domain.ErrInvalidInput, err)
}
