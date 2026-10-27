package httpapi

import "net/http"

// Public compatibility metadata, never user data or configuration secrets.
func (s *Server) mobileInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, envelope{"data": envelope{
		"application": "daynest", "mobile_protocol": 1,
		"requires_secure_secret": s.localOnlyTransfers,
		"ai_requires_loopback":   true,
	}})
}
