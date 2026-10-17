package httpapi

import (
	"errors"
	"github.com/example/studyflow/internal/chatgpt"
	"net"
	"net/http"
	"net/url"
)

// Loopback-only, host checked to prevent DNS rebinding; no forwarded-header trust.
func (s *Server) localAI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Del("Access-Control-Allow-Origin")
		w.Header().Set("Cache-Control", "no-store")
		remote, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(remote)
		host := r.Host
		if h, _, e := net.SplitHostPort(host); e == nil {
			host = h
		}
		if err != nil || ip == nil || !ip.IsLoopback() || (host != "localhost" && host != "127.0.0.1" && host != "::1") {
			writeJSON(w, 403, envelope{"error": envelope{"message": "ChatGPT 授权仅允许本机访问，请使用 http://localhost:8080 打开平台"}})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			scheme := "http"
			if r.TLS != nil {
				scheme = "https"
			}
			if e != nil || u.Host != r.Host || u.Scheme != scheme {
				writeJSON(w, 403, envelope{"error": envelope{"message": "不允许跨站 AI 请求"}})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func aiError(w http.ResponseWriter, err error) {
	value := envelope{"code": "ai_unavailable", "message": err.Error()}
	var diagnostic *chatgpt.RequestFailure
	if errors.As(err, &diagnostic) {
		value["diagnostic"] = diagnostic
	}
	writeJSON(w, http.StatusBadGateway, envelope{"error": value})
}
func (s *Server) chatGPTStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, envelope{"data": s.chatGPT.Status(claimsFromContext(r.Context()).Subject)})
}
func (s *Server) chatGPTConnect(w http.ResponseWriter, r *http.Request) {
	u, err := s.chatGPT.Begin(claimsFromContext(r.Context()).Subject)
	if err != nil {
		aiError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": envelope{"authorization_url": u}})
}
func (s *Server) chatGPTDisconnect(w http.ResponseWriter, r *http.Request) {
	message := s.chatGPT.Disconnect(r.Context(), claimsFromContext(r.Context()).Subject)
	writeJSON(w, 200, envelope{"data": envelope{"message": message}})
}
func (s *Server) chatGPTModels(w http.ResponseWriter, r *http.Request) {
	rows, err := s.chatGPT.Models(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		aiError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": rows})
}
func (s *Server) aiMealRecommend(w http.ResponseWriter, r *http.Request) {
	var in chatgpt.MealRequest
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, invalidJSON(err))
		return
	}
	if err := chatgpt.ValidateRequest(in); err != nil {
		writeJSON(w, 400, envelope{"error": envelope{"message": err.Error()}})
		return
	}
	out, err := s.chatGPT.Recommend(r.Context(), claimsFromContext(r.Context()).Subject, in)
	if err != nil {
		aiError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": out})
}
