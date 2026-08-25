package service

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/security"
)

type RegisterInput struct {
	Name     string
	Email    string
	Password string
}

type AuthResult struct {
	User  domain.User `json:"user"`
	Token string      `json:"token"`
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (AuthResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	address, err := mail.ParseAddress(input.Email)
	if input.Name == "" || len(input.Name) > 80 || err != nil || strings.ToLower(address.Address) != input.Email {
		return AuthResult{}, fmt.Errorf("%w: a valid name and email are required", domain.ErrInvalidInput)
	}
	passwordHash, err := security.HashPassword(input.Password)
	if err != nil {
		return AuthResult{}, fmt.Errorf("%w: %v", domain.ErrInvalidInput, err)
	}
	user := domain.User{
		ID:           platform.NewID(),
		Email:        input.Email,
		Name:         input.Name,
		PasswordHash: passwordHash,
		Role:         domain.RoleStudent,
		CreatedAt:    s.now().UTC(),
	}
	if err := s.repo.CreateUser(ctx, user); err != nil {
		return AuthResult{}, err
	}
	token, err := s.tokens.Issue(user.ID, string(user.Role))
	if err != nil {
		return AuthResult{}, err
	}
	s.publish("user.registered", user.ID, user.ID, nil)
	return AuthResult{User: user, Token: token}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (AuthResult, error) {
	user, err := s.repo.UserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return AuthResult{}, domain.ErrUnauthorized
		}
		return AuthResult{}, err
	}
	if !security.VerifyPassword(user.PasswordHash, password) {
		return AuthResult{}, domain.ErrUnauthorized
	}
	token, err := s.tokens.Issue(user.ID, string(user.Role))
	if err != nil {
		return AuthResult{}, err
	}
	s.publish("user.logged_in", user.ID, user.ID, nil)
	return AuthResult{User: user, Token: token}, nil
}
