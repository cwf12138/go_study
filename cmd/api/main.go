package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/example/studyflow/internal/config"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/httpapi"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	repository := store.NewMemory()
	if err := repository.LoadJSON(cfg.DataFile); err != nil {
		var recovery *store.SnapshotRecoveryError
		if errors.As(err, &recovery) {
			logger.Warn("data snapshot recovered", "error", err, "quarantined_path", recovery.QuarantinedPath, "backup_path", recovery.BackupPath, "recovered_from_backup", recovery.RecoveredFromBackup)
		} else {
			logger.Error("load data snapshot", "error", err)
			os.Exit(1)
		}
	}
	bus := event.NewBus()
	tokens := security.NewTokenManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.TokenTTL)
	services := service.New(repository, tokens, bus)
	handler := httpapi.NewHandler(services, tokens, bus, logger)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Streaming responses use their own heartbeat and request cancellation.
		WriteTimeout: 0,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var background sync.WaitGroup
	background.Add(2)
	go func() {
		defer background.Done()
		event.RunWorkerPool(ctx, logger, bus, cfg.WorkerCount, func(_ context.Context, evt event.Event) error {
			logger.Info("domain event processed", "event_id", evt.ID, "event_type", evt.Type, "actor_id", evt.ActorID)
			return nil
		})
	}()
	go func() {
		defer background.Done()
		runSnapshotter(ctx, logger, repository, cfg.DataFile, cfg.SnapshotInterval)
	}()
	go func() {
		logger.Info("StudyFlow API started", "address", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
	background.Wait()
	if err := repository.SaveJSON(cfg.DataFile); err != nil {
		logger.Error("save final data snapshot", "error", err)
	}
	logger.Info("StudyFlow API stopped")
}

func runSnapshotter(ctx context.Context, logger *slog.Logger, repository *store.Memory, path string, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := repository.SaveJSON(path); err != nil {
				logger.Error("save data snapshot", "error", err)
			}
		}
	}
}
