# R0 第一批：诊断与发布检查

日期：2026-10-30。对应路线图 D-01 构建条件检查、D-02 诊断最小页、D-03 检查流水线，以及 D-04 恢复演练设计。本批未迁移数据库，也没有覆盖实际数据。

## 设置与诊断

重启新版 Go 服务并刷新网页，点击右上角 **⚙ 设置与诊断**。

- 显示当前网页或 App 的连接目标、HTTP / HTTPS、服务运行时间和已知开发密钥检查。自定义密钥通过检查不等于密钥强度认证。
- 显示常规 JSON 快照的最后尝试、最后成功、连续失败及载入文件记录的时间。等待首次写盘、写盘失败、超过观察阈值和近期已确认分开呈现。
- 「近期已确认」仅表示该服务进程近期完成过常规快照写入，不证明之后的修改已落盘，也不检查磁盘所有文件是否仍然存在。启动时载入 / 从滚动备份恢复与常规快照写入单独记录。
- 请求失败时保留上次诊断并标明「上次记录」，不继续显示当前连接正常。每次检查需要登录，关闭弹窗取消等待，换账号清空旧结果。
- 展示后端版本、提交号和 APK 客户端构建信息。源码运行显示 dev；缺失构建信息显示未标记。安卓可从这里进入已有电脑连接设置。
- 备份指引明确：个人 JSON 导出不含快传文件与元数据；完整服务备份需要停服后一起复制 DATA_FILE 和同级 transfers 目录。不会在页面自动写盘或恢复数据。

「导出脱敏诊断」采用字段白名单，只输出版本、协议、平台、时间和状态；不输出服务地址、账号、令牌、正文、记录数量、文件路径、请求头、原始异常或完整配置。旧状态导出带 `last_check_succeeded: false`。安卓使用已有系统保存窗口；网页交给浏览器下载。导出后仍可自行核对文件再决定是否分享。

后端新增 `GET /api/v1/system/diagnostics`，需要 Bearer 登录，不缓存。`mobile-info` 增加安全的构建信息，仍保留原有协议与本机 AI 限制。

## 统一检查

项目根目录：

```powershell
go test ./...
go vet ./...
node tools/check.cjs
```

统一入口自动查找 `tools/*_smoke.cjs`，目前 56 项，输出到忽略提交的 `.local/checks/frontend-report.json`。测试失败与进程无法启动（BLOCKED）分开显示，二者都会使总检查失败。若工具沙箱禁止子进程，应在普通终端运行；不能将「没有执行」当作测试通过。

新增覆盖：快照写入失败后保留历史成功信息、恢复写盘、载入文件与写盘确认区分、并发读取；诊断鉴权与路径 / 账号脱敏；前端断线与账号隔离；构建预检与资源摘要、私密文件拒绝。

本批已通过 Go 全量测试、`go vet`、统一入口的 56 项前端检查及移动资源校验。另使用隔离测试账号、真实 Go 服务与模拟原生桥，在浏览器检查了诊断页的 390px / 桌面 / 深色布局、版本读取、脱敏导出和服务断开后的“上次记录”；不是 APK、Android 系统权限或真机验证。测试与实际用户数据分离。

## Android 构建条件与资源校验

```powershell
cd mobile
pnpm android:check
pnpm android:sync
cd ..
node tools/verify-mobile.cjs
```

预检只读，检查 Node 22+、JDK 21+、SDK 36、Build Tools、依赖和 Gradle wrapper。基础通过不等于成功生成 APK，更不等于真机可用。预检失败返回非零；Java 检查被当前环境限制时，JSON 的 `java_probe_error` 会区别于未找到 Java。

本次实际检查：借助已有 Node 24 与 JDK 21，依赖及 wrapper 可用；仍缺 SDK 36 和新 Build Tools。本批没有生成 APK，也没有安装手机或完成覆盖升级验收。系统默认 Node 仍为 16，使用普通终端构建时应选用 Node 22+。没有自动安装 SDK、修改环境变量或接受新的 SDK 许可。

构建会重新生成 `mobile/www`，该目录仅用于生成资源，不能在里面保存个人文件。构建拒绝越界与符号链接，排除 data、环境文件和签名私钥。`client-build.json` 记录版本、versionCode、提交、工作区是否修改、构建时间和公开资源摘要。不能取得 Git 信息时明确记为 unknown / null。

`package.json` 的版本与 `daynestAndroidVersionCode` 同步到 Android Gradle，当前为 `0.1.0` / `1`。校验脚本检查资源齐全、连接后初始化、资源摘要未变和未包含敏感目录；不是签名认证或完整安全审计。

## GitHub Actions

`.github/workflows/check.yml` 提供：

1. Go 1.22.x 和 stable 的测试与静态检查；stable 额外执行竞态检查。
2. Node 24 统一前端检查，保存检查报告。
3. 前两项通过后，准备 Java 21、SDK 36 与 Build Tools，打包 / 校验前端并执行 Android `assembleDebug`。
4. Android 成功构建后才上传调试 APK、客户端构建信息和 APK SHA-256；构建失败不会上传一个假安装包。

工作流仅申请 `contents: read`，不保留 checkout 凭据，不使用 `pull_request_target`，不发布 Release、不部署服务器。本批只提交配置文件到工作区，没有推送仓库或实际触发 GitHub 执行；远程通过状态仍需后续验证。

**内测签名边界：** 当前使用默认调试签名。不同 CI 临时环境生成的调试密钥可能不同，不能承诺跨次 CI APK 可以覆盖安装。正式连续内测前需要确定受保护、稳定的签名及 versionCode 递增策略，并实际验证升级；不要为升级失败直接卸载而丢失手机本机草稿与设置。当前未增加或上传签名密钥。

动作版本按官方说明选用：[checkout](https://github.com/actions/checkout)、[setup-go](https://github.com/actions/setup-go)、[setup-node](https://github.com/actions/setup-node)、[setup-java](https://github.com/actions/setup-java)、[upload-artifact](https://github.com/actions/upload-artifact)。生产发布前可进一步锁定经审核的完整提交 SHA。

## 下一步验收

- 补齐 Android 构建条件，在普通终端生成 APK；完成 [Android 真机清单](../mobile/README.md) 的首次安装、写入回读、权限和覆盖升级。
- 首次在 GitHub 运行工作流，确认 Android 依赖与产物，再决定是否纳入正式内测发布。
- 按 [完整备份恢复演练设计](backup-drill.md) 在独立数据副本上演练；本批不宣称已经验证你的备份能恢复。
