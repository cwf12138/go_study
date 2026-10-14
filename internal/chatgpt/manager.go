// Package chatgpt implements the documented public-client SIWC flow for a local app.
// Credentials deliberately live only in memory, outside the application snapshot.
package chatgpt

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const issuer = "https://auth.openai.com"
const resource = "https://api.openai.com/v1"
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

type registration struct {
	Client  string `json:"client_id"`
	Subject string `json:"subject"`
}
type registry struct {
	Host     string                  `json:"host_id"`
	Accounts map[string]registration `json:"accounts"`
}
type credentials struct {
	Access  string    `json:"access_token"`
	Refresh string    `json:"refresh_token"`
	ID      string    `json:"id_token"`
	Type    string    `json:"token_type"`
	Scope   string    `json:"scope"`
	Expires int       `json:"expires_in"`
	Until   time.Time `json:"-"`
}
type session struct {
	reg            registration
	cred           credentials
	email, message string
	pending, busy  bool
	generation     uint64
	cancel         context.CancelFunc
}
type Status struct {
	Connected bool   `json:"connected"`
	SignedIn  bool   `json:"signed_in"`
	Pending   bool   `json:"pending"`
	Busy      bool   `json:"busy"`
	Email     string `json:"email"`
	Message   string `json:"message"`
}
type Manager struct {
	mu       sync.Mutex
	file     string
	registry registry
	sessions map[string]*session
	client   *http.Client
}

func New(file string) *Manager {
	return &Manager{file: file, sessions: map[string]*session{}, client: &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func randomValue() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("secure random unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func accountKey(user string) string {
	h := sha256.Sum256([]byte(user))
	return hex.EncodeToString(h[:])
}
func hasScope(scope, want string) bool {
	for _, s := range strings.Fields(scope) {
		if s == want {
			return true
		}
	}
	return false
}
func (m *Manager) get(user string) *session {
	s := m.sessions[user]
	if s == nil {
		s = &session{}
		m.sessions[user] = s
	}
	return s
}
func (m *Manager) Status(user string) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.get(user)
	return Status{Connected: s.cred.Access != "" && hasScope(s.cred.Scope, "chatgpt.tokens.use.direct"), SignedIn: s.cred.ID != "", Pending: s.pending, Busy: s.busy, Email: s.email, Message: s.message}
}

// Only non-secret registration metadata is persisted. Tokens never reach this file.
func (m *Manager) loadRegistry() error {
	if m.registry.Host != "" {
		return nil
	}
	data, err := os.ReadFile(m.file)
	var loaded registry
	if err == nil {
		if json.Unmarshal(data, &loaded) != nil || !strings.HasPrefix(loaded.Host, "urn:uuid:") {
			return errors.New("ChatGPT 注册信息损坏，请检查独立的注册文件")
		}
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return errors.New("无法读取 ChatGPT 注册信息")
	}
	m.registry = loaded
	if m.registry.Accounts == nil {
		m.registry.Accounts = map[string]registration{}
	}
	if m.registry.Host == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		b[6] = (b[6] & 15) | 64
		b[8] = (b[8] & 63) | 128
		m.registry.Host = fmt.Sprintf("urn:uuid:%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
		if err := m.saveRegistry(); err != nil {
			m.registry = registry{}
			return err
		}
	}
	return nil
}
func (m *Manager) saveRegistry() error {
	if err := os.MkdirAll(filepath.Dir(m.file), 0700); err != nil {
		return errors.New("无法创建 ChatGPT 注册目录")
	}
	data, _ := json.MarshalIndent(m.registry, "", "  ")
	f, err := os.CreateTemp(filepath.Dir(m.file), ".chatgpt-registration-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, m.file)
	}
	return err
}
func (m *Manager) Begin(user string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.loadRegistry(); err != nil {
		return "", err
	}
	s := m.get(user)
	if s.pending || s.busy {
		return "", errors.New("已有登录或推荐请求正在进行，请稍后再试")
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", errors.New("无法启动本地授权回调监听器")
	}
	if s.reg.Client == "" {
		s.reg = m.registry.Accounts[accountKey(user)]
	}
	state, nonce, verifier := randomValue(), randomValue(), randomValue()
	hash := sha256.Sum256([]byte(verifier))
	callback := "http://" + listener.Addr().String() + "/auth/callback"
	clientID := s.reg.Client
	if clientID == "" {
		clientID = "dynamic_agent_client"
	}
	q := url.Values{"client_id": {clientID}, "ext_agent_host_id": {m.registry.Host}, "response_type": {"code"}, "redirect_uri": {callback}, "scope": {scopes}, "resource": {resource}, "state": {state}, "nonce": {nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}}
	if clientID == "dynamic_agent_client" {
		q.Set("agent_name_hint", "Daynest")
	}
	if s.cred.Access != "" && !hasScope(s.cred.Scope, "chatgpt.tokens.use.direct") {
		q.Set("prompt", "consent")
	}
	s.generation++
	generation := s.generation
	s.pending = true
	s.message = "请在打开的浏览器中完成 ChatGPT 授权"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	s.cancel = cancel
	var once sync.Once
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		if r.Method != "GET" || r.URL.Path != "/auth/callback" || r.Host != listener.Addr().String() {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("state") != state {
			http.Error(w, "Invalid authorization state", 400)
			return
		}
		handled := false
		once.Do(func() {
			handled = true
			message := "已连接 ChatGPT，请关闭此页并返回 Daynest。"
			var tokens credentials
			var identity identityClaims
			var flowErr error
			issued := r.URL.Query().Get("client_id")
			if clientID != "dynamic_agent_client" {
				if issued != "" && issued != clientID {
					flowErr = errors.New("客户端身份不匹配")
				}
				issued = clientID
			}
			if r.URL.Query().Get("error") != "" {
				flowErr = errors.New("授权未完成或被拒绝，请返回 Daynest 重新连接")
			}
			if issued == "" || issued == "dynamic_agent_client" || r.URL.Query().Get("code") == "" {
				flowErr = errors.New("授权回调缺少注册信息，请重新连接")
			}
			if flowErr == nil {
				tokens, flowErr = m.exchange(ctx, url.Values{"grant_type": {"authorization_code"}, "client_id": {issued}, "code": {r.URL.Query().Get("code")}, "code_verifier": {verifier}, "redirect_uri": {callback}, "resource": {resource}})
			}
			if flowErr == nil {
				identity, flowErr = m.verify(ctx, tokens.ID, issued, nonce)
			}
			m.mu.Lock()
			if s.generation != generation {
				flowErr = errors.New("此登录已取消，请返回 Daynest 重新连接")
			}
			if flowErr == nil && s.reg.Subject != "" && s.reg.Subject != identity.Subject {
				flowErr = errors.New("请使用原先关联的 ChatGPT 账号登录")
			}
			if flowErr == nil {
				reg := registration{Client: issued, Subject: identity.Subject}
				m.registry.Accounts[accountKey(user)] = reg
				if err := m.saveRegistry(); err != nil {
					flowErr = errors.New("无法保存客户端注册信息，连接未启用")
				} else {
					s.reg = reg
					s.cred = tokens
					s.email = identity.Email
				}
			}
			if flowErr != nil {
				message = flowErr.Error()
			} else if !hasScope(tokens.Scope, "chatgpt.tokens.use.direct") {
				message = "账号身份验证成功，但未获准使用 Plus 额度。请检查账号资格或重新授权。"
			}
			if s.generation == generation {
				s.pending = false
				s.message = message
			}
			m.mu.Unlock()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			// All messages are application constants, never provider error descriptions or tokens.
			fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><title>Daynest · ChatGPT</title><main style='font:18px system-ui;max-width:560px;margin:15vh auto;padding:32px'><h1>Daynest · 今天吃什么</h1><p>%s</p><p>可关闭此页，返回原窗口查看连接状态。</p></main>", message)
			cancel()
		})
		if !handled {
			http.Error(w, "Authorization already consumed", 409)
		}
	})
	go func() { _ = server.Serve(listener) }()
	go func() {
		<-ctx.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = server.Shutdown(shutdown)
		m.mu.Lock()
		if s.generation == generation && s.pending {
			s.pending = false
			s.message = "登录已取消或超时，请重新连接"
		}
		m.mu.Unlock()
	}()
	return issuer + "/api/accounts/authorize?" + q.Encode(), nil
}
func (m *Manager) exchange(ctx context.Context, form url.Values) (credentials, error) {
	var out credentials
	if err := m.jsonRequest(ctx, "POST", issuer+"/api/accounts/oauth/token", "", form, &out); err != nil {
		return out, err
	}
	if out.Access == "" || !strings.EqualFold(out.Type, "Bearer") || out.Expires <= 0 || out.Expires > 86400 {
		return out, errors.New("授权响应不完整，请重新登录")
	}
	out.Until = time.Now().Add(time.Duration(out.Expires) * time.Second)
	return out, nil
}

// jsonRequest never includes provider bodies or credentials in returned errors.
func (m *Manager) jsonRequest(ctx context.Context, method, endpoint, token string, form url.Values, target any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return errors.New("请求配置错误")
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := m.client.Do(req)
	if err != nil {
		return errors.New("无法连接 OpenAI，请检查网络后重试")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return providerError(res.StatusCode)
	}
	if target == nil {
		return nil
	}
	return decodeBounded(res.Body, target, 2<<20)
}
func decodeBounded(r io.Reader, target any, limit int64) error {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(b)) > limit {
		return errors.New("服务响应过大或中断")
	}
	if json.Unmarshal(b, target) != nil {
		return errors.New("服务响应格式异常")
	}
	return nil
}
func providerError(status int) error {
	switch status {
	case 401:
		return errors.New("ChatGPT 授权已失效，请断开后重新连接")
	case 403:
		return errors.New("当前账号或应用暂不具备此调用权限")
	case 429:
		return errors.New("Plus 额度或请求频率受限，请稍后再试")
	}
	return fmt.Errorf("OpenAI 请求未成功（%d），请稍后重试", status)
}

// acquire serializes refresh/inference and makes disconnect cancel outstanding work.
func (m *Manager) acquire(ctx context.Context, user string) (context.Context, *session, uint64, credentials, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.get(user)
	if s.pending || s.busy {
		return nil, nil, 0, credentials{}, errors.New("已有请求正在进行")
	}
	if s.cred.Access == "" || !hasScope(s.cred.Scope, "chatgpt.tokens.use.direct") {
		return nil, nil, 0, credentials{}, errors.New("请先连接 ChatGPT 并授权使用 Plus 额度")
	}
	call, cancel := context.WithTimeout(ctx, 90*time.Second)
	s.cancel = cancel
	s.busy = true
	return call, s, s.generation, s.cred, nil
}
func (m *Manager) release(s *session, g uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.generation == g {
		if s.cancel != nil {
			s.cancel()
		}
		s.busy = false
		s.cancel = nil
	}
}
func (m *Manager) access(ctx context.Context, s *session, g uint64, c credentials) (string, error) {
	if time.Until(c.Until) > time.Minute {
		return c.Access, nil
	}
	if c.Refresh == "" {
		return "", errors.New("授权已到期，请重新连接")
	}
	m.mu.Lock()
	reg := s.reg
	m.mu.Unlock()
	next, err := m.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {reg.Client}, "refresh_token": {c.Refresh}, "resource": {resource}})
	if err != nil {
		return "", err
	}
	if next.Refresh == "" || !hasScope(next.Scope, "chatgpt.tokens.use.direct") {
		return "", errors.New("续期未获得完整权限，请重新连接")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.generation != g {
		return "", errors.New("连接已取消")
	}
	s.cred = next
	return next.Access, nil
}
func (m *Manager) Disconnect(ctx context.Context, user string) string {
	m.mu.Lock()
	s := m.get(user)
	c, reg := s.cred, s.reg
	s.generation++
	if s.cancel != nil {
		s.cancel()
	}
	s.cred = credentials{}
	s.pending = false
	s.busy = false
	s.email = ""
	s.message = "已断开本地连接"
	m.mu.Unlock()
	if c.Refresh == "" {
		return "已清除本地授权。"
	}
	call, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var discovery struct {
		Revocation string `json:"revocation_endpoint"`
	}
	err := m.jsonRequest(call, "GET", issuer+"/.well-known/openid-configuration", "", nil, &discovery)
	u, _ := url.Parse(discovery.Revocation)
	if err == nil && (u == nil || u.Scheme != "https" || u.Host != "auth.openai.com") {
		err = errors.New("无效的撤销端点")
	}
	if err == nil {
		err = m.jsonRequest(call, "POST", discovery.Revocation, "", url.Values{"token": {c.Refresh}, "token_type_hint": {"refresh_token"}, "client_id": {reg.Client}}, nil)
	}
	if err != nil {
		return "已清除本地授权，但未确认远程撤销。可在 ChatGPT 设置中断开 Daynest。"
	}
	return "已断开连接并撤销本次授权会话。"
}
