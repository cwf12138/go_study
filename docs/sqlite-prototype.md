# SQLite 隔离原型与迁移验证

日期：2026-11-01。对应路线图 D-05。本轮完成可执行的验证原型，**主服务仍使用内存仓储与周期 JSON 快照**，没有读取或迁移真实用户数据，没有给前端增加“已迁移”状态。

## 本轮交付范围

代码位于独立模块 `experiments/sqlite`，需要 Go 1.25+；主项目仍为 Go 1.22+。驱动固定为 `modernc.org/sqlite v1.59.0`，间接依赖和校验记录在该模块的 `go.mod` / `go.sum` 中。实际以 `CGO_ENABLED=0` 编译和测试，不依赖本机 SQLite CLI 或 C 编译器。[驱动说明](https://pkg.go.dev/modernc.org/sqlite)、[锁定版本的 Go 要求与依赖](https://github.com/modernc-org/sqlite/blob/v1.59.0/go.mod)。

关系结构覆盖以下 6 个集合，完整原始快照另以 BLOB 逐字节归档，不删除未映射字段或旧模块内容：

| 快照集合 | 原型表 | 目前能力 |
| --- | --- | --- |
| users | users | 凭据保留，按 ID / 邮箱读取；密码哈希不进入验收报告。 |
| memo_folders | memo_folders | 导入、创建、账号归属约束。 |
| memo_notes | memos | 导入、创建、读取与列表；原型专用版本冲突更新。 |
| todo_lists | todo_lists | 导入和账号归属约束，尚无完整清单 CRUD。 |
| todos | todos | 导入；在演练事务中与备忘录、引用和幂等回执一起创建。 |
| text_clips | text_clips | 导入，保留过期 / 回收站，允许不同账号使用相同片段 ID。 |

其他集合只保留在原始快照归档，不具备相应 SQL 业务操作。**保存了原始 JSON 不等于这些模块已经迁移。** 附件本身不复制进数据库，原完整备份目录必须独立保留。

当前根 `store.Repository` 有 **138 个方法**，原型匹配实现 **7 个**：CreateUser、UserByID、UserByEmail、CreateMemoFolder、CreateMemoNote、MemoNoteByID、ListMemoNotes。选定的用户 / 备忘录契约使用同一组测试分别验证 Memory 与 SQLite。旧的按 ID 读取是内部仓储能力，正式服务仍需检查账号归属；另提供 `MemoFor` 演示在 SQL 查询中限定账号。

全量方法与集合清单由当前 Go 接口和账号集合注册表生成，见 [迁移清单 JSON](sqlite-migration-inventory.json)。以后接口扩展后可重新运行 `inventory` 更新，不应手写一个“全部完成”的比例。

## 可重复的隔离演练

从项目根目录：

```powershell
./scripts/verify-sqlite-lab.ps1
```

首次使用需要下载独立模块依赖；脚本保留正常 Go 模块校验，不修改系统代理、全局 Go 配置或 `DATA_FILE`。未配置缓存路径时使用项目 `.local/sqlite-modcache` 与 `.studyflow-gocache`，结束后恢复本进程环境。脚本会先执行静态检查，再执行原型全部测试。

报告写入忽略提交的 `.local/checks/sqlite-lab-report.json`，带 `fixtures_only: true`、`production_changed: false`、`all_modules_migrated: false`。开始与失败都会覆盖状态，避免误用上次成功结果。报告不带账号、正文、密码哈希和绝对路径。

非 PowerShell 环境可以在 `experiments/sqlite` 中运行：

```sh
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test ./... -count=1
```

## 用备份副本进行转换预览

工具只接受上一批完整备份工具创建、且校验通过的目录，不接受个人 JSON 导出，不会猜测或读取当前 `DATA_FILE`。原型快照大小上限为 64 MiB。以下示例请使用你另行准备的备份副本；本轮没有替你执行真实备份转换。

在项目根目录生成明确的绝对路径，避免 `go -C` 后相对路径指向不同位置：

```powershell
New-Item -ItemType Directory -Force .local/sqlite-labs | Out-Null
$sourcePackage = (Resolve-Path '.local/backups/my-backup').Path
$experimentDirectory = Join-Path $PWD '.local/sqlite-labs/rehearsal-20261101'

go -C experiments/sqlite run ./cmd/sqlite-lab convert --backup $sourcePackage --output $experimentDirectory
```

默认只校验和预览，不创建实验目录。预览包含源备份 ID、快照 SHA-256、保存时间、集合数量和映射范围。主备份包的文件清单、快照与附件都会先按现有规则校验；关系映射中缺失或跨账号的文件夹 / 清单引用会提前拒绝，不自动补造目标。

显式写入独立数据库：

```powershell
go -C experiments/sqlite run ./cmd/sqlite-lab convert --backup $sourcePackage --output $experimentDirectory --apply
go -C experiments/sqlite run ./cmd/sqlite-lab inspect --lab $experimentDirectory
```

输出必须是全新目录，父目录须存在，不得与源备份目录相互包含。没有 `--force`，不会覆盖旧数据库。写入后核对表数量、完整性、外键、账号索引和原始快照哈希。原始快照与结构化行在同一事务提交；SQL 失败不会留下半套已导入记录。若进程在初始化后、导入前退出，可能留下结构完整的空实验库，检查结果会是 `source_present: false`，不能当作转换成功。

实验目录结构：

```text
rehearsal-20261101/
  daynest-sqlite-lab.json
  daynest.sqlite
  daynest.sqlite-wal       # SQLite 运行时可能存在
  daynest.sqlite-shm       # SQLite 运行时可能存在
```

创建或备份未完成时会保留 `.sqlite-lab-incomplete`，工具拒绝打开，不能删标记绕过验证。来源快照、实验库及数据库副本均可能含全部账号、密码哈希与正文，未加密，需私密保存。CLI 错误 JSON 不携带详细路径；终端 stderr 的本地错误可能带路径。

## 事务、并发与持久化验证

- 通过 DSN 为**每个连接**设置 `foreign_keys=ON`、`synchronous=FULL`、`busy_timeout=1500`，启用 WAL，最多 4 个连接；测试实际同时取得 4 个连接核对配置。WAL 与同步策略的依据见 [SQLite WAL](https://www.sqlite.org/wal.html) 和 [synchronous 说明](https://www.sqlite.org/pragma.html#pragma_synchronous)。
- 同一事务创建备忘录、待办、账号安全引用和幂等回执。第二步外键失败会回滚第一步；相同账号 / 命令键 / 请求可重放，命令键改配另一份请求会拒绝。
- `EditMemo` 使用期望版本，两个设备读到同一版时只有一份修改成功。它是原型专用能力，尚未改动网页现有备忘录 API。编辑会保留未知 JSON 字段；原始快照归档始终不变。
- 记录按账号、置顶和更新时间索引；时间拆为秒与纳秒，避免毫秒截断改变现有排序，也支持旧快照的零值时间。通过查询计划验证预期索引，而不是宣称做过性能压测。
- 迁移脚本版本与 SHA-256 入账；不认识的应用标识、版本或脚本校验和会拒绝，**不自动升级或降级实验库**。当前只有初始版本，不代表已验证未来多版本升级。
- 已做真实子进程终止演练：子进程先提交一条记录，再打开未提交事务，父进程强制终止；重开后已确认提交仍存在、未提交记录不存在，并通过完整性与外键检查。没有模拟硬件断电、磁盘满或损坏控制器，不据此承诺所有故障下的硬件持久性。

## 在线数据库副本

保持源实验库打开时：

```powershell
$databaseCopyDirectory = Join-Path $PWD '.local/sqlite-labs/database-copy-20261101'
go -C experiments/sqlite run ./cmd/sqlite-lab backup --lab $experimentDirectory --output $databaseCopyDirectory
go -C experiments/sqlite run ./cmd/sqlite-lab inspect --lab $databaseCopyDirectory
```

使用绑定参数的 `VACUUM INTO` 创建一致副本，随后回读检查；不会直接复制运行中的 `.sqlite` 主文件，不删除 WAL / SHM。已验证源连接仍开着时复制成功，副本包含之前已提交的记录，且不包含副本完成后的新增记录。[SQLite 官方说明](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause)。

副本的日志头可能不同于运行中的源库。只读检查会报告它的实际模式；以可写模式重新打开已验证的实验副本时，会恢复原型的 WAL 运行策略。实验仅面向本机磁盘，不将网络共享盘作为支持范围。

这是**原型数据库副本**，不是完整 Daynest 服务备份，不含快传附件或其他目录配置。正式 JSON 服务的备份仍使用 [现有完整备份工具](backup-restore.md)。

## CI 与实际完成情况

工作流新增独立 `sqlite-lab` 任务：Windows / Linux × Go 1.25 / stable，执行无 CGO 编译、全部测试、静态检查并保存隔离报告；Linux stable 另设竞态检查。正式服务的 Go 1.22 / stable 检查保持原样。本轮没有推送或触发远程 CI。

本地 Windows / amd64、Go 1.25.6、CGO 关闭的演练与异常分支测试已通过；另外通过 Linux / amd64 的无 CGO 交叉编译。Linux 运行与竞态结果仍待 CI 实际验证。主项目全量测试和静态检查也通过，正式 `go.mod` / `go.sum` 没有变化。原型未连接正式服务，未转换实际数据，未进行安卓真机验收。

## 正式切换前还需要完成

1. 补齐剩余 131 个仓储方法、可选数据概览 / 快照状态读模型和每个集合的规则；逐项做契约测试，不能仅凭已归档 JSON 宣布迁移完成。
2. 处理计划生成、专注、运动、订阅记账、文件元数据等事务边界；文件与事件总线不能自动加入 SQLite 事务，需要另行设计提交后事件或可靠任务。
3. 确定版本冲突、删除引用、历史缺失引用、分页与业务幂等规范，再接入对应 HTTP API 与前端。
4. 在完整备份副本上做全量差异核对、性能与故障验证、数据库及附件组合恢复；迁移期间只保留一个权威写入来源。
5. 完成正式切换与回退方案，保全切换后的新记录，再由用户明确选择生产路径。当前没有切换命令，也不会自动将 `DATA_FILE` 改成数据库路径。

2026-11-05：正式 Memory 新增待办条件提交、原子周期生成与分类移除能力，采用窄接口，根仓储方法仍为 138。SQLite 原型尚未实现这些能力，原型的部分方法覆盖率不能代替它们的事务契约；正式切换前须另行补齐与验证。
