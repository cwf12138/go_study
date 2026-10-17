package chatgpt

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// RequestFailure is a safe diagnostic, never a copy of a provider response body.
// The same record can be shown in the callback and the account's status endpoint.
type RequestFailure struct {
	Stage        string `json:"stage"`
	HTTPStatus   int    `json:"http_status"`
	Code         string `json:"provider_code,omitempty"`
	RequestID    string `json:"provider_request_id,omitempty"`
	EdgeID       string `json:"edge_request_id,omitempty"`
	Format       string `json:"response_format"`
	ProxyPlanned bool   `json:"proxy_planned"`
	Hint         string `json:"hint"`
}

func (e *RequestFailure) Error() string {
	label := map[string]string{"token_exchange": "交换授权码", "token_refresh": "续期授权", "identity_keys": "获取身份验证公钥", "identity_discovery": "获取认证配置", "models": "加载模型列表", "inference": "生成食物推荐", "revocation": "撤销授权"}[e.Stage]
	if label == "" {
		label = "访问认证服务"
	}
	status := fmt.Sprintf("HTTP %d", e.HTTPStatus)
	if e.HTTPStatus == 0 {
		status = "未收到 HTTP 响应"
	}
	message := label + "失败（" + status + "）。\n" + e.Hint
	message += "\n诊断：stage=" + e.Stage + "；response=" + e.Format
	if e.Code != "" {
		message += "；code=" + e.Code
	}
	if e.RequestID != "" {
		message += "；request_id=" + e.RequestID
	}
	if e.EdgeID != "" {
		message += "；edge_id=" + e.EdgeID
	}
	if e.ProxyPlanned {
		message += "；请求计划使用环境代理"
	} else {
		message += "；请求未配置环境代理（不代表其他系统级网络软件未生效）"
	}
	return message
}

var safeRequestID = regexp.MustCompile(`^(req[-_][A-Za-z0-9_-]{1,150}|[a-fA-F0-9]{8,64}(-[A-Za-z0-9]{2,36})*|[a-fA-F0-9-]{36})$`)

func requestID(value string) string {
	if len(value) <= 160 && safeRequestID.MatchString(value) {
		return value
	}
	return ""
}

// Only documented machine-readable codes are surfaced; arbitrary messages, detail
// text, unknown codes, HTML and credential-shaped header values are never echoed.
var codeHints = map[string]string{
	"invalid_grant":                               "授权码已失效、已使用或与本次 PKCE/回调不匹配，请从平台发起一次新的登录，不要重开旧回调链接。",
	"invalid_client":                              "客户端注册或认证配置未被接受，需要核对本次注册返回的 client ID。",
	"invalid_scope":                               "请求的授权范围未被接受，需要核对客户端权限配置。",
	"access_denied":                               "授权被拒绝；请核对账户与授权范围，不要循环重试。",
	"unauthorized_client":                         "当前客户端未被允许使用此授权方式，需要核对应用准入。",
	"unsupported_grant_type":                      "认证服务不支持此授权类型，需要核对客户端实现。",
	"unsupported_country_region_territory":        "服务返回地区限制；请遵守官方支持地区与服务政策，不要通过修改安全校验绕过。",
	"subscription_sharing_user_not_eligible":      "官方返回此用户/工作区/政策不具备 ChatGPT plan usage 资格；不要反复登录或重复请求。",
	"subscription_sharing_route_not_supported":    "官方不支持当前请求路由，需要核对方法与端点。",
	"chatpass_v2_scope_not_authorized":            "官方返回授权范围不足，需要核对客户端与实际授予的权限。",
	"chatpass_v2_invalid_authorization_context":   "官方未接受签名授权上下文，需要核对客户端与授权配置。",
	"subscription_sharing_invalid_user":           "订阅用户身份上下文未被接受，请保留请求 ID 排查授权。",
	"subscription_sharing_usage_limit_exceeded":   "账号或应用的可用额度受限，请查看 ChatGPT 使用量设置；不会自动换用其他计费方式。",
	"subscription_sharing_usage_unavailable":      "官方暂时无法检查额度，请稍后再试，不要立即重复请求。",
	"subscription_sharing_user_unavailable":       "官方暂时无法取得账号/工作区信息，请稍后再试。",
	"subscription_sharing_unsupported_capability": "请求含此授权路线不支持的能力，需要核对请求参数。",
	"invalid_refresh_token":                       "续期令牌已不可用，请断开后重新授权。",
	"refresh_token_expired":                       "续期令牌已到期，请断开后重新授权。",
	"refresh_token_invalidated":                   "续期会话已失效，请断开后重新授权。",
	"refresh_token_reused":                        "续期令牌被重复使用，请检查并发续期并重新授权。",
	"refresh_token_expired_or_revoked":            "续期会话已到期或撤销，请重新授权。",
	"token_expired":                               "授权令牌已到期，请重新授权。",
}

func requestStage(endpoint string, form map[string][]string) string {
	switch endpoint {
	case issuer + "/api/accounts/oauth/token":
		if values := form["grant_type"]; len(values) > 0 && values[0] == "refresh_token" {
			return "token_refresh"
		}
		return "token_exchange"
	case issuer + "/.well-known/jwks.json":
		return "identity_keys"
	case issuer + "/.well-known/openid-configuration":
		return "identity_discovery"
	case resource + "/models":
		return "models"
	case resource + "/responses":
		return "inference"
	}
	return "revocation"
}

func responseFailure(response *http.Response, stage string) *RequestFailure {
	e := &RequestFailure{Stage: stage, HTTPStatus: response.StatusCode, Format: "empty"}
	if response.Request != nil {
		proxy, err := http.ProxyFromEnvironment(response.Request)
		e.ProxyPlanned = err == nil && proxy != nil
	}
	e.RequestID = requestID(response.Header.Get("openai-request-id"))
	if e.RequestID == "" {
		e.RequestID = requestID(response.Header.Get("x-request-id"))
	}
	e.EdgeID = requestID(response.Header.Get("cf-ray"))
	body, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		e.Format = "unreadable"
	} else if len(body) > 64<<10 {
		e.Format = "oversized"
	} else if text := strings.TrimSpace(string(body)); text != "" {
		var object map[string]json.RawMessage
		if json.Unmarshal(body, &object) == nil && object != nil {
			e.Format = "json_other"
			if value, ok := object["error"]; ok {
				e.Format = "json_error"
				var code string
				var details struct {
					Code string `json:"code"`
				}
				if json.Unmarshal(value, &code) != nil && json.Unmarshal(value, &details) == nil {
					code = details.Code
				}
				if _, allowed := codeHints[code]; allowed {
					e.Code = code
				}
			} else if _, ok := object["detail"]; ok {
				e.Format = "json_detail"
			}
		} else if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/html") || strings.HasPrefix(strings.ToLower(text), "<!doctype html") || strings.HasPrefix(strings.ToLower(text), "<html") {
			e.Format = "html"
		} else {
			e.Format = "text"
		}
	}
	if hint := codeHints[e.Code]; hint != "" {
		e.Hint = hint
		return e
	}
	switch response.StatusCode {
	case 403:
		if e.Format == "html" || e.Format == "text" {
			e.Hint = "此端点返回非 JSON 的拒绝访问/错误页面。可能涉及网络中间层或访问策略，不能据此断定 Plus 无权限；请检查 Go 进程实际使用的网络/代理。"
		} else {
			e.Hint = "请求被拒绝，但没有取得可识别的官方错误代码。需要核对网络、地区/工作区政策和应用授权，不能仅凭 403 判断账号资格。"
		}
	case 401:
		e.Hint = "认证未被接受，需要核对该阶段的账号授权与实际授予权限。"
	case 429:
		e.Hint = "请求频率或可用额度受限，请稍后再试，不会自动重试或改用其他计费方式。"
	case 400:
		e.Hint = "认证或调用参数未被接受，需要检查此阶段的参数，不能只按账号权限处理。"
	default:
		e.Hint = "上游服务未成功完成请求。请保留阶段、状态码与请求 ID 后排查；不要重放旧授权回调。"
	}
	return e
}
