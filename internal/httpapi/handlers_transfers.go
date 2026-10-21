package httpapi

import (
	"errors"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/example/studyflow/internal/transfers"
)

func (s *Server) safeTransfer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.localOnlyTransfers {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			ip := net.ParseIP(host)
			if err != nil || ip == nil || !ip.IsLoopback() {
				w.Header().Set("Cache-Control", "no-store")
				writeJSON(w, 403, envelope{"error": envelope{"code": "development_key_local_only", "message": "仍在使用公开的开发默认 JWT_SECRET，文件快传仅允许本机访问。请设置足够强的专用秘钥并重启、重新登录后，再通过可信局域网访问。"}})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func transferError(w http.ResponseWriter, e error) {
	status, code, message := 500, "transfer_failed", "文件操作失败，请稍后重试"
	switch {
	case errors.Is(e, transfers.ErrInvalid):
		status, code, message = 400, "invalid_transfer", "请检查文件名、标识和操作；活动文件须先移入回收站才能永久删除"
	case errors.Is(e, transfers.ErrNotFound):
		status, code, message = 404, "file_not_found", "当前账号中没有这个可用文件"
	case errors.Is(e, transfers.ErrConflict):
		status, code, message = 409, "upload_conflict", "上传标识已被不同内容使用；请刷新核对，不会覆盖原文件"
	case errors.Is(e, transfers.ErrQuota):
		status, code, message = 413, "transfer_quota", "单文件最多 32 MiB，每账号最多 256 MiB / 100 个文件（含过期及回收站）"
	case errors.Is(e, transfers.ErrBusy):
		status, code, message = 429, "transfer_busy", "上传或文件操作繁忙，请稍后重试"
	case errors.Is(e, transfers.ErrExpired):
		status, code, message = 410, "file_expired", "文件已过期或在回收站中，请先恢复或延长有效期"
	}
	writeJSON(w, status, envelope{"error": envelope{"code": code, "message": message}})
}
func (s *Server) listTransfers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	out, e := s.transfers.List(r.Context(), claimsFromContext(r.Context()).Subject)
	if e != nil {
		transferError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": out})
}
func (s *Server) uploadTransfer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	name, e := url.PathUnescape(r.Header.Get("X-File-Name"))
	ttl, ttlErr := strconv.Atoi(r.Header.Get("X-File-TTL"))
	if e != nil || ttlErr != nil {
		transferError(w, transfers.ErrInvalid)
		return
	}
	// Override the default short JSON-body deadline only for authenticated uploads.
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(2 * time.Minute))
	defer controller.SetReadDeadline(time.Time{})
	r.Body = http.MaxBytesReader(w, r.Body, transfers.MaxFileBytes+1)
	row, e := s.transfers.Upload(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), name, ttl, r.Body, r.ContentLength)
	if e != nil {
		var limit *http.MaxBytesError
		if errors.As(e, &limit) {
			e = transfers.ErrQuota
		}
		transferError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row})
}
func (s *Server) downloadTransfer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	f, row, e := s.transfers.Open(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"))
	if e != nil {
		transferError(w, e)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": row.Name}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// ServeContent provides authenticated range/HEAD requests without loading a file into Go memory.
	http.ServeContent(w, r, row.Name, row.CreatedAt, f)
}
func (s *Server) transferAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var in struct {
		Action string `json:"action"`
	}
	if e := decodeJSON(w, r, &in); e != nil {
		writeError(w, invalidJSON(e))
		return
	}
	row, e := s.transfers.Action(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id"), in.Action)
	if e != nil {
		transferError(w, e)
		return
	}
	writeJSON(w, 200, envelope{"data": row})
}
func (s *Server) purgeTransfer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if e := s.transfers.Purge(r.Context(), claimsFromContext(r.Context()).Subject, r.PathValue("id")); e != nil {
		transferError(w, e)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) transferInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.localOnlyTransfers {
		writeJSON(w, 200, envelope{"data": envelope{"addresses": []string{}, "warning": "当前使用公开的开发默认 JWT_SECRET，文件快传暂限本机。请设置足够强的 JWT_SECRET 并重启、重新登录后，再连接可信局域网。不会自动修改配置。"}})
		return
	}
	port := "80"
	scheme := "http"
	if r.TLS != nil {
		port = "443"
		scheme = "https"
	}
	if _, p, e := net.SplitHostPort(r.Host); e == nil {
		if value, e := strconv.Atoi(p); e == nil && value > 0 && value <= 65535 {
			port = p
		}
	}
	addresses := []string{}
	seen := map[string]bool{}
	interfaces, e := net.Interfaces()
	if e != nil {
		writeJSON(w, 200, envelope{"data": envelope{"addresses": addresses, "warning": "无法读取网络接口，请手动输入电脑的局域网地址"}})
		return
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		rows, e := iface.Addrs()
		if e != nil {
			continue
		}
		for _, row := range rows {
			ip, _, e := net.ParseCIDR(row.String())
			if e != nil || ip.To4() == nil || !ip.IsPrivate() {
				continue
			}
			address := scheme + "://" + net.JoinHostPort(ip.String(), port)
			if !seen[address] {
				seen[address] = true
				addresses = append(addresses, address)
			}
		}
	}
	writeJSON(w, 200, envelope{"data": envelope{"addresses": addresses, "warning": "候选地址未验证连通性；需同一局域网、服务允许局域网监听及防火墙放行。不会自动更改网络设置。"}})
}
