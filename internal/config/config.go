package config

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr         string
	JWTSecret        string
	JWTIssuer        string
	TokenTTL         time.Duration
	DataFile         string
	SnapshotInterval time.Duration
	WorkerCount      int
	ShutdownTimeout  time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:         env("HTTP_ADDR", ":8080"),
		JWTSecret:        env("JWT_SECRET", "development-secret-change-me-please"),
		JWTIssuer:        env("JWT_ISSUER", "studyflow"),
		TokenTTL:         duration("TOKEN_TTL", 24*time.Hour),
		DataFile:         env("DATA_FILE", "data/studyflow.json"),
		SnapshotInterval: duration("SNAPSHOT_INTERVAL", 15*time.Second),
		WorkerCount:      integer("WORKER_COUNT", 4),
		ShutdownTimeout:  duration("SHUTDOWN_TIMEOUT", 10*time.Second),
	}
	if len(cfg.JWTSecret) < 24 {
		return Config{}, errors.New("JWT_SECRET must contain at least 24 characters")
	}
	if cfg.WorkerCount < 1 || cfg.WorkerCount > 128 {
		return Config{}, errors.New("WORKER_COUNT must be between 1 and 128")
	}
	if cfg.TokenTTL <= 0 || cfg.SnapshotInterval <= 0 || cfg.ShutdownTimeout <= 0 {
		return Config{}, errors.New("duration settings must be positive")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func duration(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func integer(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
