# 完整备份与恢复

日期：2026-11-01。对应路线图 D-04 的工具实现与隔离演练。工具已通过测试数据验证，没有读取、备份或恢复你的实际 `data/studyflow.json`，也没有自动切换正式目录。

## 什么时候用

升级代码、换电脑或迁移存储前，在电脑上正常停止 Go 服务，运行完整备份。网页的「导出个人 JSON」只导出当前账号的业务记录，不能代替这份服务备份。

本地工具只需要项目已有的 Go，不需要 Node、额外数据库、AI 或网络服务。它创建普通目录，便于复制到你自己的备份盘；备份未加密，包含所有账号、密码哈希与附件，需私密保存。SHA-256 用于检查损坏，不认证来源，请只恢复你信任的备份。

## 创建、校验与恢复

在项目根目录操作，先停止正在运行的 Go 服务（Ctrl+C），等进程退出。旧版服务没有数据锁，即使使用新工具，也必须自行确认旧进程已结束；访问不到网页不等于服务已经停止。

先建立父目录；备份和恢复目标本身必须是全新目录：

```powershell
New-Item -ItemType Directory -Force .local/backups, .local/restores | Out-Null

go run ./cmd/backup create --data-file data/studyflow.json --output .local/backups/daynest-20261101 --service-stopped

go run ./cmd/backup verify --input .local/backups/daynest-20261101

go run ./cmd/backup restore --input .local/backups/daynest-20261101 --output .local/restores/daynest-20261101
```

最后一条只预览，不创建恢复目录。核对成功后，使用相同路径加 `--apply`：

```powershell
go run ./cmd/backup restore --input .local/backups/daynest-20261101 --output .local/restores/daynest-20261101 --apply
```

已经存在的目录永远不会覆盖，也没有 `--force`。再次执行请换一个名字。路径含空格时加双引号。自定义 `DATA_FILE` 必须在 `--data-file` 中明确传入；工具不自动使用环境变量中的路径，不会替你停止服务、选择正式数据、启动副本或清理原件。

三个命令均可附加 `--json`。成功结果包含备份 ID、文件数、字节数、各集合数量、校验与告警；不含正文、账号 ID、令牌或绝对路径。失败返回非零状态，JSON 只带通用错误码；终端 stderr 的详细本地错误可能带路径，请不要原样当作脱敏诊断分享。

## 包含哪些文件

```text
daynest-20261101/
  manifest.json
  payload/
    snapshot.json
    snapshot.json.bak        # 源文件存在时保留
    transfers/
      <账号目录哈希>/
        <文件 ID>.json
        <文件 ID>.blob
        .upload-...         # 若有中断残留，也原样保留并提醒
```

主快照与滚动备份逐字节复制，不重新序列化，不过滤归档、过期项、回收站或旧模块数据。快传目录中的普通文件全部保留，包括未被元数据引用的残留文件；空的账号子目录不单独保存，恢复时保留快传根目录，需要时由服务重建账号目录。

`manifest.json` 记录格式版本、备份 ID、时间、应用构建信息、文件相对路径、大小与 SHA-256。恢复后的主文件固定命名为 `studyflow.json`，源文件即使自定义名字也不影响数据内容；恢复报告写入新目录的 `restore-report.json`。

环境变量、JWT 密钥、AI 注册 / 授权信息、缓存、安装包、签名密钥、浏览器草稿和手机本地设置不在这份备份中。需要的个人配置请单独保管。更换 JWT 密钥会使原登录令牌失效，账号密码和已保存业务记录仍在快照中。

## 工具会检查什么

- 新版 Go 服务与工具按整个数据目录互斥，即使换端口或换同目录下的 JSON 文件名，也不能同时操作；互斥锁不会阻塞等待。锁文件 `.daynest.lock` 留在目录中是正常现象，不要手动删除。进程正常退出或被终止后可重新获得系统锁。适用于本机磁盘，不将网络共享盘、多台电脑同时写入视为支持场景。
- 清单必须是已知版本；文件列表、大小、哈希、主快照和快传根目录必须完整。未列出的文件也会阻止校验。
- 拒绝路径越界、符号链接 / junction、特殊文件、Windows 设备名 / ADS、大小写歧义、重复条目与重复 JSON 键。当前载荷上限为 10 万个文件、总计 20 GiB、单份快照 256 MiB、单个快传文件 32 MiB、单份元数据 8 KiB，清单上限 64 MiB。
- 快照检查格式、保存时间、账号身份、已知集合所有权，以及与真实仓储一致的主键 / 组合键冲突；检查任务→目标、待办→清单、备忘录→文件夹、单词→词书、复习记录→单词、专注→任务 / 计划块的跨账号引用。它不替代每个模块全部业务规则验证。
- 附件检查元数据身份、目录所属账号、实际大小和内容哈希。即使清单里的哈希被一起改动，附件元数据不匹配仍会失败。
- 历史引用目标已删除时保留记录并提示核对；主快照无效时直接停止，不在原目录自动回退或修复。有效主快照旁的无效 `.bak` 会原样保留并告警，不能当作可用回退。
- 源快传目录不存在时，备份保留显式空目录并报告无法判定此前是否丢过附件。工具无法发现已被整个删除、且没有独立索引留下痕迹的旧文件。
- 恢复默认只预览，显式执行才写入全新目录，并逐文件回读比对。复制中断或失败的目录保留 `.daynest-incomplete` 标记，不报告完成；新版服务拒绝在带此标记的数据目录启动。不要删除标记后直接使用失败副本，核查后另选新目录重做。

Windows 使用系统文件范围锁，Unix 使用 `flock`；Windows 的行为依据 [Microsoft LockFileEx 文档](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)。没有增加 Go 依赖。它是参与者间的互斥保护，不能阻止不使用锁的旧程序、手工改文件或不可信目录中的恶意并发修改。

## 恢复后如何验收

在一个**新终端**中，将副本作为显式 `DATA_FILE`，使用独立的回环端口，例如：

```powershell
$env:DATA_FILE = Join-Path $PWD '.local/restores/daynest-20261101/studyflow.json'
$env:HTTP_ADDR = '127.0.0.1:8081'
go run ./cmd/api
```

需要自己的 JWT 密钥时，在该终端按原有安全配置设置，不写进备份清单。访问副本后核对账号登录、记录字段、引用、回收站、附件下载，以及新建后正常停机再启动是否保留。完成后停止副本并关闭这个终端，避免后来误用副本配置。原服务与副本必须使用不同的数据目录。

`content_verified: true` 只表示内容校验完成。`application_verified: false` 仍要求以上实际验收；诊断页的 `restore_verified: false` 也不会因为某个测试通过就变成你真实备份已验证。正式切换前另行保全原目录。

## 可重复的隔离演练

```powershell
./scripts/verify-backup-drill.ps1
```

脚本只运行固定的 Go 测试，在临时目录生成两个测试账号和记录，创建→校验→预览→恢复后，用真实的回环 HTTP 服务检查：登录与账号隔离、目标 / 任务、待办 / 清单、备忘录文件夹与正文、回收站与过期项、日历、附件下载、恢复后新增，以及显式快照后重新载入。报告写入忽略提交的 `.local/checks/backup-drill-report.json`，带 `fixtures_only: true`。运行失败会写入失败状态，不遗留上次成功的假象。

非 PowerShell 环境可执行：

```sh
go test ./internal/backup -run TestRestoreHTTPDrill -count=1 -v
```

2026-11-01 已在隔离数据上通过上述演练及损坏 / 缺失文件、清单路径、并发锁、进程终止、重复主键与跨账号引用等测试。没有执行真实数据恢复、真实磁盘满故障或安卓真机验收；Windows 缺少创建符号链接权限时，相应实文件链接测试会显式跳过，路径拒绝检查仍执行。完整失败场景见 [验收设计](backup-drill.md)。

Go 检查工作流已扩展为 Windows / Linux × Go 1.22 / stable，自动包含备份与锁测试；竞态检查仍在 Linux stable 运行。此处只是 CI 配置，本轮没有推送或触发远程执行。
