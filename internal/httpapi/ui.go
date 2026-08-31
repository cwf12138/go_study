package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
)

func frontendFS() (fs.FS, error) {
	directory := os.Getenv("FRONTEND_DIR")
	if directory != "" {
		return directoryFS(directory)
	}
	// `go run` starts in the project root while `go test` starts in this
	// package directory. Supporting both keeps the console runnable without
	// a frontend build step or an environment variable during development.
	for _, candidate := range []string{"internal/httpapi/assets", "assets"} {
		assets, err := directoryFS(candidate)
		if err == nil {
			return assets, nil
		}
	}
	return nil, errors.New("set FRONTEND_DIR to a directory containing index.html")
}

func directoryFS(directory string) (fs.FS, error) {
	info, err := os.Stat(directory)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("FRONTEND_DIR is not a directory")
	}
	return os.DirFS(directory), nil
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	page, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, envelope{"error": envelope{"code": "frontend_unavailable", "message": "frontend asset is unavailable"}})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, max-age=0, must-revalidate")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(page)
}

// revalidateAssets prevents a long-running development server from serving a
// new index.html alongside an old cached app.js. That mismatch can make newly
// added navigation entries appear present but remain completely unresponsive.
func revalidateAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, max-age=0, must-revalidate")
		next.ServeHTTP(w, r)
	})
}
