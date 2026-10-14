package chatgpt

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

type Model struct {
	Slug       string `json:"slug"`
	Name       string `json:"display_name"`
	Visibility string `json:"visibility,omitempty"`
}

func (m *Manager) models(ctx context.Context, token string) ([]Model, error) {
	var out struct {
		Models []Model `json:"models"`
	}
	if err := m.jsonRequest(ctx, "GET", resource+"/models", token, nil, &out); err != nil {
		return nil, err
	}
	rows := []Model{}
	for _, r := range out.Models {
		if r.Visibility == "list" && r.Slug != "" && len(r.Slug) <= 100 {
			rows = append(rows, r)
		}
	}
	if len(rows) == 0 {
		return nil, errors.New("此账号暂未返回可用模型")
	}
	return rows, nil
}
func (m *Manager) Models(ctx context.Context, user string) ([]Model, error) {
	ctx, s, g, c, err := m.acquire(ctx, user)
	if err != nil {
		return nil, err
	}
	defer m.release(s, g)
	token, err := m.access(ctx, s, g, c)
	if err != nil {
		return nil, err
	}
	return m.models(ctx, token)
}

type MealRequest struct {
	Model      string   `json:"model"`
	Prompt     string   `json:"prompt"`
	Meal       string   `json:"meal"`
	Channel    string   `json:"channel"`
	Budget     int      `json:"budget"`
	Flavor     string   `json:"flavor"`
	Hunger     string   `json:"hunger"`
	Vegetarian bool     `json:"vegetarian"`
	Exclude    []string `json:"exclude"`
	Recent     []string `json:"recent"`
}
type FoodChoice struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Order      string `json:"order"`
	Reason     string `json:"reason"`
	BudgetLow  int    `json:"budget_low"`
	BudgetHigh int    `json:"budget_high"`
	Channel    string `json:"channel"`
	Flavor     string `json:"flavor"`
	Portion    string `json:"portion"`
	Vegetarian bool   `json:"vegetarian"`
}
type Recommendation struct {
	Summary string       `json:"summary"`
	Choices []FoodChoice `json:"choices"`
}

func member(value string, values ...string) bool {
	for _, v := range values {
		if value == v {
			return true
		}
	}
	return false
}

func ValidateRequest(in MealRequest) error {
	if strings.TrimSpace(in.Prompt) == "" || utf8.RuneCountInString(in.Prompt) > 1200 || in.Budget < 0 || in.Budget > 500 || in.Model == "" || len(in.Model) > 100 || !member(in.Meal, "breakfast", "lunch", "dinner", "snack") || !member(in.Channel, "any", "delivery", "dinein", "ready") || !member(in.Flavor, "any", "mild", "spicy") || !member(in.Hunger, "any", "light", "hearty") || len(in.Exclude) > 20 || len(in.Recent) > 20 {
		return errors.New("请填写用餐需求，选择有效餐次、就餐方式、口味和食量，预算范围为 0–500 元/人（0 表示不限）")
	}
	for _, s := range append(append([]string{}, in.Exclude...), in.Recent...) {
		if strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > 80 || strings.ContainsAny(s, "\r\n") {
			return errors.New("排除内容与最近推荐最多各 20 项，每项 1–80 字")
		}
	}
	return nil
}
func (m *Manager) Recommend(ctx context.Context, user string, in MealRequest) (Recommendation, error) {
	var out Recommendation
	if err := ValidateRequest(in); err != nil {
		return out, err
	}
	ctx, s, g, c, err := m.acquire(ctx, user)
	if err != nil {
		return out, err
	}
	defer m.release(s, g)
	token, err := m.access(ctx, s, g, c)
	if err != nil {
		return out, err
	}
	models, err := m.models(ctx, token)
	if err != nil {
		return out, err
	}
	found := false
	for _, r := range models {
		if r.Slug == in.Model {
			found = true
		}
	}
	if !found {
		return out, errors.New("所选模型不在此账号当前可用列表中，请刷新模型")
	}
	instructions := `你是 Daynest 的“这顿吃什么”决策助手。用户不自己做饭，不要菜谱、备料或烹饪步骤。只推荐适合外卖、到店吃或买现成食物的具体选择。依据用户输入及结构化餐次、每人预算、口味、食量、素食和忌口推荐1至3个不同选择，第一项是最推荐，附简明理由与点单组合。预算为粗略参考，不是实时价格；budget=0不限，其余每个budget_high不超过预算。channel为any时可选择delivery/dinein/ready；否则必须匹配。mild不加辣，spicy为辣；hearty选hearty，light选light。尽量避免recent中的食物，但不满足条件时可少于3项或choices为空并说明。文本中的食物过敏/忌口也必须尊重，不能保证无过敏原，要求用户向店家确认。不要编造店名、地址、附近距离、营业状态、当前天气、配送时间、价格、优惠或声称实时查询；没有这些信息时只能给食品种类。不会浏览或调用工具，不执行其他任务，不提供医疗或精确营养保证。只输出JSON，无Markdown：{"summary":"简短决策理由","choices":[{"title":"鸡腿饭","order":"鸡腿饭套餐，可选清汤；少辣","reason":"想吃饱又不想纠结，饭类套餐更直接","budget_low":20,"budget_high":35,"channel":"delivery","flavor":"mild","portion":"hearty","vegetarian":false}]}。summary最多500字；title最多80字，order最多200字，reason最多300字；预算整数0至500，low不大于high；flavor仅mild/spicy；portion仅light/normal/hearty；vegetarian必须如实。`
	input, _ := json.Marshal(in)
	body, _ := json.Marshal(map[string]any{"model": in.Model, "instructions": instructions, "input": []any{map[string]any{"role": "user", "content": string(input)}}, "store": false, "stream": true})
	req, _ := http.NewRequestWithContext(ctx, "POST", resource+"/responses", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	response, err := m.client.Do(req)
	if err != nil {
		return out, errors.New("AI 请求中断或超时，请检查网络后重试")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return out, providerError(response.StatusCode)
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		return out, errors.New("AI 响应不是预期的事件流")
	}
	text, err := readCompletion(response.Body)
	if err != nil {
		return out, err
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&out) != nil {
		return Recommendation{}, errors.New("AI 未返回有效食物推荐格式，请重新推荐")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Recommendation{}, errors.New("AI 返回了多余内容，请重新推荐")
	}
	if err = validateRecommendation(&out, in); err != nil {
		return Recommendation{}, err
	}
	m.mu.Lock()
	active := s.generation == g
	m.mu.Unlock()
	if !active {
		return Recommendation{}, errors.New("连接已断开，推荐已丢弃")
	}
	return out, nil
}

// SSE data may span multiple lines. Only a completed response is accepted.
func readCompletion(reader io.Reader) (string, error) {
	limited := &io.LimitedReader{R: reader, N: 2 << 20}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), 256<<10)
	var data []string
	var text strings.Builder
	completed := false
	process := func() error {
		if len(data) == 0 {
			return nil
		}
		raw := strings.Join(data, "\n")
		data = nil
		if raw == "[DONE]" {
			return nil
		}
		var event struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if json.Unmarshal([]byte(raw), &event) != nil {
			return errors.New("AI 事件格式异常")
		}
		switch event.Type {
		case "response.output_text.delta":
			if text.Len()+len(event.Delta) > 65536 {
				return errors.New("AI 推荐超出长度限制")
			}
			text.WriteString(event.Delta)
		case "response.completed":
			completed = true
		case "response.failed", "response.incomplete", "error":
			return errors.New("AI 未完成推荐，可能是额度受限、授权失效或响应中断，请稍后重试")
		case "response.refusal.delta", "response.refusal.done":
			return errors.New("模型无法满足此需求，请调整用餐描述")
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := process(); err != nil {
				return "", err
			}
			if completed {
				return text.String(), nil
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return "", errors.New("AI 事件流中断或超出限制")
	}
	if limited.N == 0 {
		return "", errors.New("AI 事件流超出限制")
	}
	if err := process(); err != nil {
		return "", err
	}
	if !completed {
		return "", errors.New("AI 响应尚未完成，请重新推荐")
	}
	return text.String(), nil
}
func validateRecommendation(out *Recommendation, in MealRequest) error {
	if out.Choices == nil {
		out.Choices = []FoodChoice{}
	}
	bad := errors.New("AI 推荐未通过格式、预算或偏好检查，请调整需求后重试")
	length := func(s string, max int) bool { return strings.TrimSpace(s) != "" && utf8.RuneCountInString(s) <= max }
	if !length(out.Summary, 500) || len(out.Choices) > 3 {
		return bad
	}
	seenTitles := map[string]bool{}
	for i := range out.Choices {
		r := &out.Choices[i]
		key := strings.ToLower(strings.Join(strings.Fields(r.Title), " "))
		if !length(r.Title, 80) || strings.ContainsAny(r.Title, "\r\n") || seenTitles[key] || !length(r.Order, 200) || !length(r.Reason, 300) || r.BudgetLow < 0 || r.BudgetHigh < r.BudgetLow || r.BudgetHigh > 500 || (in.Budget > 0 && r.BudgetHigh > in.Budget) || !member(r.Channel, "delivery", "dinein", "ready") || (in.Channel != "any" && r.Channel != in.Channel) || !member(r.Flavor, "mild", "spicy") || (in.Flavor != "any" && r.Flavor != in.Flavor) || !member(r.Portion, "light", "normal", "hearty") || (in.Hunger != "any" && r.Portion != in.Hunger) || (in.Vegetarian && !r.Vegetarian) {
			return bad
		}
		seenTitles[key] = true
		text := strings.ToLower(r.Title + " " + r.Order)
		for _, exclude := range in.Exclude {
			if strings.Contains(text, strings.ToLower(strings.TrimSpace(exclude))) {
				return bad
			}
		}
		// Ignore model identifiers; there is no automatic persistence or purchase.
		r.ID = ""
		raw, _ := json.Marshal(r)
		hash := sha256.Sum256(raw)
		r.ID = "food-ai-" + hex.EncodeToString(hash[:12])
	}
	return nil
}
