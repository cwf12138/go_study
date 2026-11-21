# AI 吃饭决策

今天吃什么 → **✦ AI 连接设置**。AI 根据本次需求给出食物选择、推荐理由和点单组合。

## 使用智谱 GLM

Windows 用户可从项目目录运行以下命令。首次输入会被遮盖，密钥通过当前 Windows 用户的 DPAPI 加密保存在 `%LOCALAPPDATA%\Daynest\bigmodel-key.dpapi`。以同一 Windows 用户再次启动时会自动读取。Go 服务退出后恢复启动前的环境变量。

```powershell
./scripts/run-local.ps1 -UseBigModel
```

需要替换密钥时运行 `./scripts/run-local.ps1 -UpdateBigModelKey`。已有的 `BIGMODEL_API_KEY` 环境变量优先于保存值，显式替换时以新输入为准。

也可以通过自己的密钥管理方式向 Go 进程提供 `BIGMODEL_API_KEY`，再运行 `go run ./cmd/api`。请提供智谱标准模型 API 的完整密钥。模型默认是 `glm-4.5-flash`，可用 `BIGMODEL_MODEL` 指定账号有权调用的文本模型，接口地址固定为智谱官方通用端点。[智谱身份验证](https://docs.bigmodel.cn/cn/api/introduction)

用 `http://localhost:8080` 登录，打开 AI 连接设置，确认显示智谱模型。返回页面后选择「AI 按情况推荐」。刷新配置状态只检查本机设置，第一次生成推荐时才会联系智谱。请求失败时页面会提示原因，并保留手动切回本地推荐的入口。

如果当前网络需要走 Windows 已配置的代理，先在原启动终端按 Ctrl+C 停止服务，再用下面的命令启动。

```powershell
./scripts/run-local.ps1 -UseBigModel -UseSystemProxy
```

若请求仍失败，可用页面的 `response` 诊断区分域名解析、TLS、超时和代理连接错误。若页面显示 HTTP 状态码，说明已收到上游响应。

## Android 与远程网页的智谱推荐

升级到 Android 0.6.1 和支持 `/api/v1/meals/ai/` 的服务器后，在服务器上以管理员身份运行 `sudo python3 configure-meal-ai.py`。设置程序从云端试调智谱，并把密钥与 `BIGMODEL_REMOTE_ENABLED=1` 保存到权限为 0600 的 `/etc/daynest/meal-ai.env`。部署脚本会将它加载到 Go 进程。若服务已部署，完成后重启 `daynest.service`。

启用后，所有已登录的 Daynest 用户共享服务器的智谱 Key 和额度。手机和远程网页从「今天吃什么 → AI 推荐设置」查看状态。ChatGPT 授权入口继续由现有回环限制保护。

## 使用 ChatGPT Plus 授权

未配置智谱时，仍可使用 Sign in with ChatGPT 公共客户端流程。

1. 更新代码后，停止旧 Go 服务，重新 `go run ./cmd/api`，刷新页面。
2. 用 `http://localhost:8080` 登录自己的 Daynest 账号；打开今天吃什么 → AI 连接设置。
3. 点击 **Continue with ChatGPT**。在新窗口中登录自己的 Plus 账号，同意应用注册及 ChatGPT plan usage 权限。如果浏览器拦截弹窗，点击窗口内提供的授权链接。
4. 返回平台，连接状态会自动更新；也可点“检查状态”。选择账号实时返回的可用模型。
5. 返回主页面，选择“AI 按情况推荐”，描述当下情况，并设置餐次、每人预算、就餐方式等偏好。
6. 推荐会给出1–3个食物选择、理由和点单组合。可选“就吃这个”或复制点单关键词；不会替你下单，不写入菜谱、菜单或购物清单。

示例：“刚下班很饿，想点外卖，预算40元，不吃辣，也不吃牛肉。”结构化控件是硬性条件；本地关键词识别出的条件会显示在表单下方，复杂自然语言交给 AI 理解。

## ChatGPT 权限、费用与限制

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

ChatGPT 通过 Responses API 返回 SSE，以 `response.completed` 确认完成。智谱通过对话补全接口返回 JSON，以 `finish_reason: stop` 确认完成。两者使用相同的格式、预算、就餐方式、口味、食量、素食与显式排除关键词校验，并使用内容哈希生成结果 ID。智谱推荐接口和配置状态仅允许已登录的本机用户访问，全服务同时处理一条智谱推荐，60 秒超时。[智谱对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)

格式及关键词验证不能保证忌口安全或判断实际食材。请向店家核对调味料、配料和交叉接触。不是医疗/营养建议，也不保证无过敏原。不实时查询店铺、价格、优惠、距离或配送时间。

AI 失败时明确提示，可点击“先用本地推荐给我答案”；不偷偷自动降级、重试或购买额度。取消请求会中止前端等待并尽力取消服务端在途请求，但已执行的推理可能仍消耗额度。新功能不写入业务数据，旧菜谱及兼容接口保持不变。

## 本机网络提示

Go 标准 HTTP 客户端读取 `HTTPS_PROXY` 环境变量，并不自动继承 Windows 系统代理。如已有合规可用代理，请在启动服务的同一终端设置正确地址后重启；不要重放旧授权回调。不要跳过 TLS、PKCE 或身份令牌验证来绕过访问错误。公开认证端点能访问不等于账号已获准推理。

Windows 可停止旧服务后，从项目目录运行 `./scripts/run-local.ps1 -UseSystemProxy`，显式读取已经配置的系统代理。也可以使用 `-Proxy http://127.0.0.1:你的实际端口`；不传参数则保持现有环境设置。代理设置仅用于当前终端。脚本会复用本机已保存的智谱密钥。

认证失败不再统一翻译成“账号无权限”：回调页、账号状态与错误响应保留阶段（`token_exchange` / `identity_keys` / `models` / `inference` 等）、上游 HTTP 状态、响应类型以及安全的错误代码与请求 ID。`proxy_planned` 表示 Go 环境代理的计划结果，不证明请求实际到达了哪个网络出口。

显示 HTML/text 错误页只说明返回的响应形态，不能单独证明是地区、Cloudflare、代理或账号资格问题。只有可识别的官方错误代码才能据此判断具体分支。原始错误正文、错误描述、任意 detail、未知 code、授权码及令牌不返回、不记录。没有错误代码或请求 ID 时显示已有证据，不猜测原因。

## 官方文档与测试

- [注册和登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

运行 `go test ./...`、`node tools/meal_ai_smoke.cjs`。测试使用模拟令牌端点、测试签名和事件流，不使用真实账号、不消耗真实额度。真实登录、账号准入和实时推荐必须由用户授权后单独验证。
