package httpapi

import (
	"net/http"
	"strings"
)

const writeReceiptHeader = "X-Daynest-Write-Receipt"

// The pilot covers only JSON-repository mutations with audited response order.
// Uploads, exports, reminders, auth and read-only POSTs are deliberately excluded.
func observesWrite(path, method string) bool {
	if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return false
	}
	for _, prefix := range []string{"/api/v1/memos", "/api/v1/memo-folders", "/api/v1/todos", "/api/v1/todo-lists", "/api/v1/todo-imports", "/api/v1/calendar/events", "/api/v1/calendar/event-commands"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

type writeObservationWriter struct {
	http.ResponseWriter
	server      *Server
	user, epoch string
	wrote       bool
}

func (w *writeObservationWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *writeObservationWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.wrote = true
	if status >= 200 && status < 300 && w.epoch != "" {
		if receipt := w.server.service.ObserveWrite(w.user, w.epoch); receipt != "" {
			w.Header().Set(writeReceiptHeader, receipt)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *writeObservationWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}
func (s *Server) observeWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !observesWrite(r.URL.Path, r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		user := claimsFromContext(r.Context()).Subject
		writer := &writeObservationWriter{ResponseWriter: w, server: s, user: user, epoch: s.service.BeginWriteObservation(user)}
		next.ServeHTTP(writer, r)
	})
}

func (s *Server) writeStatuses(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Receipts []string `json:"receipts"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	if body.Receipts == nil || len(body.Receipts) > 20 {
		writeJSON(w, http.StatusBadRequest, envelope{"error": envelope{"code": "invalid_input", "message": "at most 20 receipts"}})
		return
	}
	for _, receipt := range body.Receipts {
		if len(receipt) > 180 {
			writeJSON(w, http.StatusBadRequest, envelope{"error": envelope{"code": "invalid_input", "message": "invalid receipt length"}})
			return
		}
	}
	rows, available := s.service.WriteReceiptStatuses(claimsFromContext(r.Context()).Subject, body.Receipts)
	writeJSON(w, http.StatusOK, envelope{"data": envelope{"schema_version": 1, "mode": "periodic_json", "available": available, "interval_seconds": s.snapshotInterval.Seconds(), "receipts": rows, "checking_triggers_write": false}})
}
