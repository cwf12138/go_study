package httpapi

import (
	"errors"
	"net"
	"net/http"
	"net/url"

	"github.com/example/studyflow/internal/chatgpt"
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
		if host == "[::1]" {
			host = "::1"
		}
		if err != nil || ip == nil || !ip.IsLoopback() || (host != "localhost" && host != "127.0.0.1" && host != "::1") {
			writeJSON(w, 403, envelope{"error": envelope{"message": "AI 推荐仅允许本机访问，请使用 http://localhost:8080 打开平台"}})
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
func (s *Server) mealAIStatus(w http.ResponseWriter, r *http.Request) {
	if s.bigModel != nil {
		writeJSON(w, 200, envelope{"data": envelope{
			"provider": "bigmodel", "connected": true, "model": s.bigModel.Model(),
			"message": "本机已配置智谱 GLM。密钥或模型权限由首次推荐验证。",
		}})
		return
	}
	writeJSON(w, 200, envelope{"data": struct {
		Provider string `json:"provider"`
		chatgpt.Status
	}{"chatgpt", s.chatGPT.Status(claimsFromContext(r.Context()).Subject)}})
}

func (s *Server) remoteMealAIAllowed(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Del("Access-Control-Allow-Origin")
	w.Header().Set("Cache-Control", "no-store")
	return s.bigModel != nil && s.mealAIOwner != "" && claimsFromContext(r.Context()).Subject == s.mealAIOwner
}

func (s *Server) remoteMealAIStatus(w http.ResponseWriter, r *http.Request) {
	if !s.remoteMealAIAllowed(w, r) {
		writeJSON(w, http.StatusOK, envelope{"data": envelope{
			"provider": "bigmodel", "connected": false,
			"message": "此账号尚未启用智谱推荐，可以先使用本地推荐。",
		}})
		return
	}
	writeJSON(w, http.StatusOK, envelope{"data": envelope{
		"provider": "bigmodel", "connected": true, "model": s.bigModel.Model(),
		"message": "当前账号已启用智谱推荐。",
	}})
}

func (s *Server) remoteMealAIRecommend(w http.ResponseWriter, r *http.Request) {
	if !s.remoteMealAIAllowed(w, r) {
		writeJSON(w, http.StatusForbidden, envelope{"error": envelope{"message": "此账号尚未启用智谱推荐。"}})
		return
	}
	s.aiMealRecommend(w, r)
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
	var out chatgpt.Recommendation
	var err error
	if s.bigModel != nil {
		out, err = s.bigModel.Recommend(r.Context(), in)
	} else {
		out, err = s.chatGPT.Recommend(r.Context(), claimsFromContext(r.Context()).Subject, in)
	}
	if err != nil {
		aiError(w, err)
		return
	}
	writeJSON(w, 200, envelope{"data": out})
}
