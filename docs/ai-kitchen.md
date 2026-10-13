# AI 私人厨房（本机 ChatGPT Plus 授权）

今天吃什么 → **✦ AI 私人厨房**。本功能采用官方 Sign in with ChatGPT 公共客户端流程，不读取浏览器 Cookie、Codex 登录文件或账号密码；不使用另行计费的 API Key。

## 使用

1. 更新代码后，停止旧 Go 服务，重新 `go run ./cmd/api`，刷新页面。
2. 用 `http://localhost:8080` 登录自己的 Daynest 账号；打开今天吃什么 → AI 私人厨房。
3. 点击 **Continue with ChatGPT**。在新窗口中登录自己的 Plus 账号，同意应用注册及 ChatGPT plan usage 权限。如果浏览器拦截弹窗，点击窗口内提供的授权链接。
4. 返回平台，连接状态会自动更新；也可点“检查状态”。选择账号实时返回的可用模型。
5. 描述食材、口味、餐次及忌口，并设置人数和总耗时。点击推荐，再核对食材和步骤。
6. 确认后可以收藏菜谱、加入指定日期餐次或准备采购清单。推荐本身不会写入业务数据；保存后的菜谱支持现有编辑功能。

示例：“今晚两个人吃，有鸡蛋、番茄和米饭，想吃清淡一点，不吃花生。推荐简单的家常搭配。”人数与耗时以上方结构化控件为准。

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
- 请求只发送本次填写的文本、人数和耗时，不读取其他模块，也不自动上传菜谱库。请不要在用餐需求中填写不必要的敏感信息。
- 授权使用新鲜 state、nonce、PKCE；验证 OpenAI JWKS RS256 签名、issuer、audience、nonce 和时效，再启用调用。回调一次性消费且 10 分钟到期，拒绝未授予推理权限的身份登录。
- 令牌不写入业务快照、不发给前端、不记录到日志。回调监听器不记录授权查询参数；官方端点不可由浏览器提供的 URL 替换。

## 结果边界

模型通过官方 Responses API 返回 SSE，必须收到 `response.completed` 才视为成功；不接受失败、拒绝、未完成或断流结果。后端检查 JSON 格式、字符串/数量上限、人数和总耗时；使用内容哈希产生菜谱 ID，而非信任模型提供的 ID。

格式验证不能保证菜谱安全或忌口正确。请核对食材、调味品标签与交叉接触，确保充分加热。不是医疗/营养建议，也不保证无过敏原。推荐不足时保留原有内置推荐功能。

整餐收藏、安排菜单沿用现有逐道保存与恢复机制：部分成功会保留，失败后先处理厨房恢复栏再重复同一操作。采购清单沿用原子合并；个人修改不会被 AI 收藏覆盖。

## 官方文档与测试

- [注册和登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

运行 `go test ./...`、`node tools/meal_ai_smoke.cjs`。测试使用模拟令牌端点、测试签名和事件流，不使用真实账号、不消耗真实额度。真实登录、账号准入和实时推荐必须由用户授权后单独验证。
