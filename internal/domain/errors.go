package domain

import "errors"

var (
	ErrNotFound     = errors.New("resource not found")
	ErrConflict     = errors.New("resource already exists")
	ErrForbidden    = errors.New("operation is not allowed")
	ErrUnauthorized = errors.New("authentication required")
	ErrInvalidInput = errors.New("invalid input")
	ErrInvalidState = errors.New("invalid state transition")
)
