package security

import "testing"

func TestPasswordHashAndVerify(t *testing.T) {
	encoded, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if !VerifyPassword(encoded, "correct horse battery staple") {
		t.Fatal("VerifyPassword() rejected correct password")
	}
	if VerifyPassword(encoded, "incorrect password") {
		t.Fatal("VerifyPassword() accepted incorrect password")
	}
}

func TestPasswordValidation(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("HashPassword() accepted short password")
	}
	if VerifyPassword("not-a-valid-hash", "password") {
		t.Fatal("VerifyPassword() accepted malformed hash")
	}
}
