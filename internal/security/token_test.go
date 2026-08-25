package security

import (
	"testing"
	"time"
)

func TestTokenRoundTripAndExpiry(t *testing.T) {
	base := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	manager := NewTokenManager("a-secret-long-enough-for-tests", "studyflow-test", time.Hour)
	manager.now = func() time.Time { return base }
	token, err := manager.Issue("user-1", "student")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	claims, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if claims.Subject != "user-1" || claims.Role != "student" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	manager.now = func() time.Time { return base.Add(2 * time.Hour) }
	if _, err := manager.Parse(token); err == nil {
		t.Fatal("Parse() accepted expired token")
	}
}

func TestTokenRejectsTampering(t *testing.T) {
	manager := NewTokenManager("a-secret-long-enough-for-tests", "studyflow-test", time.Hour)
	token, err := manager.Issue("user-1", "student")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Parse(token + "x"); err == nil {
		t.Fatal("Parse() accepted tampered token")
	}
}
