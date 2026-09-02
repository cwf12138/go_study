# StudyFlow

StudyFlow 是一个用 Go 1.22+ 编写的学习成长后端。它把目标、学习任务、待办清单、智能日历、知识花园、单词学习、英语精读、世界名著阅读、古诗文研习、番茄专注和间隔复习放进同一个领域模型，并通过事件流把数据实时推送给客户端。核心服务使用 Go 标准库，并通过 MIT 许可的 `lunar-go` 提供可靠的中国农历与节气计算；数据会周期性持久化为 JSON 快照。  # noqa: E999

这个项目不是只有 CRUD 的样板工程。它包含认证、对象级权限、状态机、SM-2 风格调度算法、并发安全仓储、事件扇出、固定大小工作池、SSE 流、结构化日志、优雅停机与可替换的基础设施边界，适合作为后续开发的底座。

## 能做什么

- 注册、登录、JWT 鉴权和 PBKDF2-SHA256 密码派生
- 创建学习目标，并在目标下管理有优先级、标签和截止时间的任务
- 用月历记录每日心情、日记、活动、压力和精力，并查看月度情绪洞察
- 使用年、月、周、日四种视图管理日程，支持全天事件、颜色分类、地点、提醒和日/周/月/年重复
- 同屏汇总智能规划时间块、学习任务、待办与心情记录，并显示农历、24 节气、传统节日和 2026 年法定放假/调休
- 查看每日传统黄历、每日一签和“历史上的今天”；历史数据联网读取 Wikipedia，网络不可用时自动降级，不影响核心日历
- 在知识花园中编写 Markdown 风格笔记，通过 `[[笔记标题]]` 建立双向链接，查看反向链接、待创建页面和交互式知识图谱
- 在“英语精读”中聚合 BBC 与 NASA/JPL 的 RSS 摘要，按主题和 B1/B2/C1 难度筛选；支持英文朗读、选词、生词篮、阅读笔记、稍后读、完成统计和写入现有词书
- 外部资讯不可用时自动切换到明确标注的 StudyFlow 原创离线精读，不把缓存或练习内容伪装成当天新闻
- 在“阅读书房”中按中英文书名检索公版世界名著，一键加入书架并在沉浸式分页阅读器中继续上次进度；支持章节跳转、字号/行距/纸张主题、英文朗读、书签、页内批注、累计时长和完成统计
- 研习精选古诗、宋词与古文，逐段对照 StudyFlow 学习译文，配有字词注释、创作背景和赏析；支持筛选、收藏、个人札记、朗读、背诵计数和“已掌握”学习路径
- 使用 `Ctrl/⌘ + K` 全局搜索功能页面和知识笔记，并快速创建笔记、任务、待办或开始专注
- 通过显式状态机推进任务，防止非法状态跳转
- 创建卡组和卡片，根据回答质量自动计算下次复习时间
- 启动、完成或放弃专注会话，汇总今日与本周专注时间
- 以可暂停、可恢复的倒计时执行专注会话，到时自动结算；可选在中途固定休息 5 分钟，并将专注时间均分为两段
- 可选同步完成关联任务，并记录当日完成任务、专注次数和实际专注时长（休息与暂停不计入）
- 获取目标、任务、待复习卡片和专注数据组成的仪表盘
- ~~订阅当前用户的 Server-Sent Events 实时事件流~~
- 在后台 worker pool 中异步处理领域事件
- 自动保存版本化 JSON 快照，并在收到终止信号后优雅关闭

## 为什么这个项目适合学习 Go

| Go 能力 | 项目中的落点 |
| --- | --- |
| 轻量并发 | 每个 HTTP 请求、事件 worker、快照任务和 SSE 连接都由 goroutine 协作 |
| channel | 进程内事件总线使用有界 channel 扇出事件，并隔离慢消费者 |
| `context.Context` | 从请求一直传递到业务层、仓储层和后台任务，支持取消与超时 |
| 接口与组合 | `store.Repository`、`event.Publisher` 隔离业务和基础设施，便于替换实现 |
| 标准库 | 使用 Go 1.22 `ServeMux`、`slog`、`crypto/*`、`net/http`，没有框架魔法 |
| 并发安全 | 内存仓储使用 `sync.RWMutex`，事件指标使用原子计数 |
| 可测试性 | 复习算法和状态机是纯函数，HTTP、认证、仓储均可独立测试 |
| 生命周期管理 | 信号上下文、HTTP `Shutdown`、worker 回收和最终快照组成完整停机流程 |

## 快速开始

要求 Go 1.22 或更高版本。

```bash
go test ./...
go run ./cmd/api
```

服务默认监听 `http://localhost:8080`。无需设置环境变量；开发默认值已经可用。数据保存在 `data/studyflow.json`。每次更新快照前会把上一份有效数据保留为 `data/studyflow.json.bak`；如果主快照损坏，启动时会自动回退到备份，并将损坏文件隔离为 `.corrupt-*`。没有有效备份时会保留损坏文件、记录警告并以空数据安全启动。

启动后直接打开 [http://localhost:8080/](http://localhost:8080/)，即可进入浏览器学习控制台。它支持注册、登录、目标、任务、待办、智能日历、知识笔记与图谱、单词词书、翻卡/拼写练习、间隔复习和专注会话的完整操作；`/healthz` 仍然只用于健康检查，返回 JSON 是正常行为。

“智能日历”提供年/月/周/日视图，可用工具栏或 `Y`、`M`、`W`、`D` 快捷键切换；`T` 回到今天，方向键翻页，`C` 新建日程。黄历属于传统民俗内容，仅作文化了解与趣味参考。2026 年放假和调休依据国务院办公厅通知；后续年份发布新通知后应更新 `lunar-go` 或覆盖对应假期数据。

新增后端接口后必须停止旧进程并重新执行 `go run ./cmd/api`。前端资源已设置为每次重新校验并带有版本参数，避免新版页面与浏览器缓存中的旧脚本混用；如果仍看到旧界面，可使用 `Ctrl+F5` 强制刷新一次。

在“专注会话”中设置计划专注分钟后，可选择“中途休息 5 分钟”。开启后，25 分钟专注会依次执行 12:30 专注、5:00 休息、12:30 专注；暂停、刷新页面和切换标签页后都可以继续当前阶段，休息与暂停不会计入专注时长。

也可以使用容器：

```bash
docker compose up --build
```

浏览器页面位于 `internal/httpapi/assets/`，由 Go 服务直接托管，不需要 Node 或前端构建步骤。若将编译产物移动到项目目录之外，可通过 `FRONTEND_DIR` 指向包含 `index.html`、`app.js` 与 `styles.css` 的资源目录；Docker 镜像已经自动完成这一配置。

健康检查：

```bash
curl http://localhost:8080/healthz
```

## 从零体验一条业务链

注册并保存返回的 token：

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"change-me-123"}'
```

```bash
export TOKEN="上一步返回的 token"
curl -X POST http://localhost:8080/api/v1/goals \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"掌握 Go 并发","description":"通过项目实践学习","deadline":"2026-12-31T16:00:00Z"}'
```

创建任务、卡组、卡片后，可以获取今日应复习内容：

```bash
curl http://localhost:8080/api/v1/cards/due?limit=20 \
  -H "Authorization: Bearer $TOKEN"
```

复习评分为 `1=Again`、`2=Hard`、`3=Good`、`4=Easy`：

```bash
curl -X POST http://localhost:8080/api/v1/cards/CARD_ID/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating":3}'
```

订阅实时事件：

```bash
curl -N http://localhost:8080/api/v1/events/stream \
  -H "Authorization: Bearer $TOKEN"
```

完整接口定义见 [docs/openapi.yaml](docs/openapi.yaml)，PowerShell 自动演示见 [examples/demo.ps1](examples/demo.ps1)。

## 项目结构

```text
.
├── cmd/api/                 # 依赖装配、后台任务、服务生命周期
├── internal/
│   ├── config/              # 带安全默认值的配置加载
│   ├── domain/              # 领域实体和公共错误
│   ├── event/               # 非阻塞事件总线与 worker pool
│   ├── httpapi/             # 路由、handler、中间件、SSE
│   ├── platform/            # UUID 风格 ID 等基础能力
│   ├── security/            # 密码派生和 HMAC JWT
│   ├── service/             # 用例、权限、状态机、复习算法
│   └── store/               # 仓储接口与并发安全内存实现
├── docs/                    # 架构说明和 OpenAPI
└── examples/                # 可执行调用示例
```

依赖方向是 `httpapi -> service -> domain/store interface`。业务层不知道 HTTP、JSON 快照或某个数据库的存在。

## 配置

所有配置均为可选：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_ADDR` | `:8080` | HTTP 监听地址 |
| `JWT_SECRET` | 开发密钥 | 生产环境必须替换，至少 24 字符 |
| `JWT_ISSUER` | `studyflow` | token 签发者 |
| `TOKEN_TTL` | `24h` | token 有效期 |
| `DATA_FILE` | `data/studyflow.json` | 快照路径 |
| `SNAPSHOT_INTERVAL` | `15s` | 快照周期 |
| `WORKER_COUNT` | `4` | 后台事件 worker 数 |
| `SHUTDOWN_TIMEOUT` | `10s` | 优雅停机期限 |

## 设计取舍

- 当前 JWT 是自包含 HMAC token，适合单服务起步。生产中可加入 refresh token、密钥轮换和撤销列表。
- 密码使用标准库实现的 PBKDF2-SHA256，避免项目首次运行依赖外部模块。正式产品可切换 Argon2id。
- JSON 快照让项目开箱即用，但它不是跨进程数据库。`Repository` 已经把切换 PostgreSQL 的边界留好。
- 进程内事件总线展示并发模型并支持 SSE。需要可靠投递时，可把 `event.Publisher` 替换为 NATS/Kafka transactional outbox。
- 事件总线刻意采用有界队列；慢客户端不会反压所有 API 请求，丢弃数可从 `/healthz` 查看。

## 推荐的后续开发顺序

1. 实现 PostgreSQL 仓储及迁移，并用集成测试验证接口契约。
2. 为任务列表增加 cursor 分页、全文搜索和乐观锁版本号。
3. 增加 refresh token、邮箱验证、限流与审计日志。
4. 将后台事件接入 outbox + NATS/Kafka，加入通知偏好和定时提醒。
5. 增加 WebSocket 协作房间、学习小组和排行榜。
6. 用 Prometheus/OpenTelemetry 补充指标与链路追踪。

更详细的扩展点和并发说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 常用命令

```bash
make test       # 单元测试与竞态检测
make coverage   # 生成覆盖率
make run        # 启动服务
make build      # 输出 bin/studyflow
```

## 内置 IELTS / TOEFL 词书

“单词学习”页面可一键安装两本离线考试词书：IELTS 5,040 词与
TOEFL 6,974 词。安装操作采用单次批量写入，重复安装只补充缺失词条；
词库管理使用后端搜索和分页，因此不会一次向浏览器渲染数千个条目。
新词顺序依据 ECDICT 的现代语料频率，安装后继续使用项目现有的每日新词
上限、拼写练习和间隔复习算法。

词表来自 [ECDICT](https://github.com/skywind3000/ECDICT) 的 `ielts` 与
`toefl` 考试标签，遵循 MIT 许可证。完整来源说明及许可证位于
`internal/vocabdata/catalogs/`。若需基于新版上游 CSV 重建：

```bash
go run ./tools/build_exam_catalogs.go -input /path/to/ecdict.csv
```

IELTS 与 TOEFL 名称仅用于描述考试分类，不代表相关考试机构对本项目的认可。

## 阅读书房的数据与版权

世界名著书目通过 Gutendex 检索 Project Gutenberg 元数据；网络不可用时会显示内置的公版名著索引。只有用户打开一本已加入书架的书时，服务端才按需获取其纯文本并分页，进程内缓存最多保留 6 小时。书籍来源页和版权提示会保留在阅读器中，不会把上游内容写入项目源码。

Project Gutenberg 的公版判断基于美国法律；如果你在其他国家或地区使用，应自行确认当地版权状态。公共 Gutendex 实例适合体验和开发，长期部署建议自行同步 Gutenberg 元数据并托管 Gutendex，同时配置清晰的 User-Agent 与联系方式，遵守上游的合理请求频率要求。

古诗文原文属于古典公版文本；现代译文、背景和赏析是为本项目编写的学习材料，并明确标注为“StudyFlow 学习译文”，不冒充权威校注版本。涉及异体字、版本差异或考试引用时，请再核对正式教材与可靠古籍整理本。

## License

MIT
