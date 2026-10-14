# AI 吃饭决策（本机 ChatGPT Plus 授权）

今天吃什么 → **✦ AI 连接设置**。本功能采用官方 Sign in with ChatGPT 公共客户端流程，不读取浏览器 Cookie、Codex 登录文件或账号密码；不使用另行计费的 API Key。AI 现在只帮你决定“吃什么”，不再生成菜谱。

## 使用

1. 更新代码后，停止旧 Go 服务，重新 `go run ./cmd/api`，刷新页面。
2. 用 `http://localhost:8080` 登录自己的 Daynest 账号；打开今天吃什么 → AI 连接设置。
3. 点击 **Continue with ChatGPT**。在新窗口中登录自己的 Plus 账号，同意应用注册及 ChatGPT plan usage 权限。如果浏览器拦截弹窗，点击窗口内提供的授权链接。
4. 返回平台，连接状态会自动更新；也可点“检查状态”。选择账号实时返回的可用模型。
5. 返回主页面，选择“AI 按情况推荐”，描述当下情况，并设置餐次、每人预算、就餐方式等偏好。
6. 推荐会给出1–3个食物选择、理由和点单组合。可选“就吃这个”或复制点单关键词；不会替你下单，不写入菜谱、菜单或购物清单。

示例：“刚下班很饿，想点外卖，预算40元，不吃辣，也不吃牛肉。”结构化控件是硬性条件；本地关键词识别出的条件会显示在表单下方，复杂自然语言交给 AI 理解。

## 权限、费用与限制

- Plus 不是无条件的调用许可。应用/账号需要符合官方开放条件，用户必须授权 `chatgpt.tokens.use.direct`；实际资格、模型、额度由 OpenAI 决定。若登录或推理被拒绝，界面会报告，不会偷偷切换到其他计费方式。
- 会消耗账号可用的 ChatGPT plan usage 额度；不承诺无限使用，也不自动购买额外额度。
- 当前为本机公开客户端集成。只允许 loopback 访问；不能直接部署到远程服务器当多用户 AI 服务。OAuth 回调是临时监听的 `127.0.0.1` 端口，不是主服务端口，也不使用 `localhost` 作为授权回调。
- 本机网络需要能访问 `auth.openai.com` 和 `api.openai.com`。网络、地区、账号或工作区政策都可能影响可用性。
- 不内置固定“最新模型”：仅显示本次授权账号的官方模型列表。
- 每个 Daynest 账号最多一个正在进行的授权/模型/推理操作，90 秒请求超时，不自动重试推理；避免不确定结果导致重复消耗额度。

## 凭据与隐私

- Access/refresh/ID token **只在 Go 进程内存中保存**。服务重启后需要重新授权。刷新在单个账号内串行执行；断开连接会取消该账号在途请求，并尝试撤销远程会话。无法确认撤销时会明确提示，请在 ChatGPT 设置中断开应用。
- 单独的 `data/chatgpt-registration.json` 仅保存 host ID、哈希后的本地用户标识、已验证的 OpenAI subject 和 issued client ID，不含令牌、邮箱或授权码。若设置 `DATA_FILE`，此文件在对应数据文件所在目录中。不要把此机器特有文件复制到其他机器复用 host ID。
- 退出 Daynest 清除前端请求/结果，但不等于撤销 ChatGPT 授权。需撤销时先点击 AI 窗口中的“断开连接”。
- 请求只发送本次填写的文本、餐次、预算、就餐方式、口味、食量、素食与排除内容，以及当前页面最近推荐的食物标题，不读取其他模块、不读取定位或天气，也不上传旧菜谱库。请勿填写不必要的敏感信息。
- 授权使用新鲜 state、nonce、PKCE；验证 OpenAI JWKS RS256 签名、issuer、audience、nonce 和时效，再启用调用。回调一次性消费且 10 分钟到期，拒绝未授予推理权限的身份登录。
- 令牌不写入业务快照、不发给前端、不记录到日志。回调监听器不记录授权查询参数；官方端点不可由浏览器提供的 URL 替换。

## 结果边界

模型通过官方 Responses API 返回 SSE，必须收到 `response.completed` 才视为成功；不接受失败、拒绝、未完成或断流结果。后端检查 JSON 格式、字符串/数量上限、预算区间、就餐方式、口味、食量、素食与显式排除关键词；产生内容哈希 ID，不信任模型标识。返回 `choices`，不再返回 `recipes`。

格式及关键词验证不能保证忌口安全或判断实际食材。请向店家核对调味料、配料和交叉接触。不是医疗/营养建议，也不保证无过敏原。不实时查询店铺、价格、优惠、距离或配送时间。

AI 失败时明确提示，可点击“先用本地推荐给我答案”；不偷偷自动降级、重试或购买额度。取消请求会中止前端等待并尽力取消服务端在途请求，但已执行的推理可能仍消耗额度。新功能不写入业务数据，旧菜谱及兼容接口保持不变。

## 本机网络提示

Go 标准 HTTP 客户端读取 `HTTPS_PROXY` 环境变量，并不自动继承 Windows 系统代理。如已有合规可用代理，请在启动服务的同一终端设置正确地址后重启；不要重放旧授权回调。不要跳过 TLS、PKCE 或身份令牌验证来绕过访问错误。公开认证端点能访问不等于账号已获准推理。

## 官方文档与测试

- [注册和登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

运行 `go test ./...`、`node tools/meal_ai_smoke.cjs`。测试使用模拟令牌端点、测试签名和事件流，不使用真实账号、不消耗真实额度。真实登录、账号准入和实时推荐必须由用户授权后单独验证。
