package chatgpt

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const bigModelEndpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
const defaultBigModel = "glm-4.5-flash"

type BigModel struct {
	apiKey string
	model  string
	client *http.Client
	active chan struct{}
}

func NewBigModel(apiKey, model string) *BigModel {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultBigModel
	}
	return &BigModel{apiKey: apiKey, model: model, active: make(chan struct{}, 1), client: &http.Client{
		Timeout:       60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (b *BigModel) Model() string { return b.model }

func (b *BigModel) Recommend(ctx context.Context, in MealRequest) (Recommendation, error) {
	if in.Model != b.model {
		return Recommendation{}, errors.New("所选模型与本机智谱配置不同，请刷新 AI 状态")
	}
	if strings.ContainsAny(b.apiKey, " \t\r\n") {
		return Recommendation{}, errors.New("本机智谱密钥含空格或换行，请重新启动服务并只粘贴完整的 API Key")
	}
	select {
	case b.active <- struct{}{}:
		defer func() { <-b.active }()
	default:
		return Recommendation{}, errors.New("智谱正在处理另一条推荐，请等待完成后再试")
	}

	input, _ := json.Marshal(in)
	payload := map[string]any{
		"model": b.model, "stream": false, "max_tokens": 2048, "temperature": 0.4,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []map[string]string{
			{"role": "system", "content": mealInstructions},
			{"role": "user", "content": string(input)},
		},
	}
	if b.model == "glm-4.7" || strings.HasPrefix(b.model, "glm-4.7-") {
		payload["thinking"] = map[string]string{"type": "disabled"}
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, bigModelEndpoint, bytes.NewReader(body))
	if err != nil {
		return Recommendation{}, errors.New("无法创建智谱推荐请求")
	}
	req.Header.Set("Authorization", "Bearer "+b.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := b.client.Do(req)
	if err != nil {
		return Recommendation{}, bigModelTransportFailure(req, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Recommendation{}, bigModelFailure(res.StatusCode)
	}

	const maxResponse = 256 << 10
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil || len(raw) > maxResponse {
		return Recommendation{}, errors.New("智谱响应中断或超出大小限制")
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Choices) != 1 {
		return Recommendation{}, errors.New("智谱未返回有效的推荐响应")
	}
	choice := result.Choices[0]
	if choice.FinishReason != "stop" {
		return Recommendation{}, errors.New("智谱没有完成这次推荐，可以简化描述后重试")
	}
	return decodeRecommendation(choice.Message.Content, in)
}

func bigModelTransportFailure(req *http.Request, err error) *RequestFailure {
	proxy, _ := http.ProxyFromEnvironment(req)
	failure := &RequestFailure{Stage: "bigmodel_inference", ProxyPlanned: proxy != nil}
	var dns *net.DNSError
	var certificate *tls.CertificateVerificationError
	var tlsRecord tls.RecordHeaderError
	var netErr net.Error
	var operation *net.OpError
	switch {
	case errors.Is(err, context.Canceled):
		failure.Format, failure.Hint = "cancelled", "本次推荐已取消。"
	case errors.As(err, &certificate):
		failure.Format, failure.Hint = "tls_certificate", "无法验证智谱连接的证书，请检查电脑时间及当前网络的证书设置。"
	case errors.As(err, &tlsRecord):
		failure.Format, failure.Hint = "tls_protocol", "TLS 握手收到了异常数据，请检查当前网络或代理地址。"
	case errors.As(err, &dns) && !dns.Timeout():
		failure.Format, failure.Hint = "dns", "域名解析失败，请检查 DNS 或代理主机是否可达。"
	case errors.As(err, &operation) && operation.Op == "proxyconnect":
		failure.Format, failure.Hint = "proxy_connect", "无法通过代理建立连接，请确认代理正在运行且地址正确。"
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()):
		failure.Format, failure.Hint = "timeout", "连接或等待智谱响应超时，请检查当前网络，再手动重试。"
	default:
		failure.Format, failure.Hint = "connection", "连接在收到 HTTP 响应前失败。本机可以用 Windows 系统代理启动 Daynest 后重试。"
	}
	return failure
}

func bigModelFailure(status int) error {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound:
		return fmt.Errorf("智谱未接受当前模型或请求（HTTP %d），请核对模型配置", status)
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Errorf("智谱未授权此请求（HTTP %d），请检查密钥和模型权限", status)
	case http.StatusPaymentRequired:
		return errors.New("智谱账号额度或余额不足（HTTP 402）")
	case http.StatusTooManyRequests:
		return errors.New("智谱请求受限（HTTP 429），请稍后再试或检查账号额度")
	default:
		return fmt.Errorf("智谱服务暂不可用（HTTP %d），可先使用本地推荐", status)
	}
}
