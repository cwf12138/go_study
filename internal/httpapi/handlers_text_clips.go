package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/service"
)

func (s *Server) listTextClips(w http.ResponseWriter, r *http.Request) {
	rows, err := s.service.ListTextClips(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": rows, "server_time": time.Now().UTC()})
}
func (s *Server) saveTextClip(w http.ResponseWriter, r *http.Request) {
	var wire struct {
		service.SaveTextClipInput
		TTL      *int `json:"ttl_hours"`
		Revision *int `json:"revision"`
	}
	if err := decodeJSON(w, r, &wire); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	if wire.TTL == nil || wire.Revision == nil {
		writeError(w, domain.ErrInvalidInput)
		return
	}
	in := wire.SaveTextClipInput
	in.TTLHours, in.Revision = *wire.TTL, *wire.Revision
	row, err := s.service.SaveTextClip(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": row})
}
func (s *Server) purgeTextClip(w http.ResponseWriter, r *http.Request) {
	revision, err := strconv.Atoi(r.URL.Query().Get("revision"))
	if err != nil {
		writeError(w, domain.ErrInvalidInput)
		return
	}
	if err := s.service.PurgeTextClip(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), revision); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
