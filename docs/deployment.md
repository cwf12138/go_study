# Linux 服务器部署

首次部署：2026-11-09；HTTPS 与手机接入更新：2026-11-10。当前访问地址：<https://111.230.184.144/>。

当前版本为 `daynest-20261110T155308Z-9ca41a4`，于北京时间 2026-11-10 23:55 部署。从本机项目构建 Linux amd64 静态程序，使用 systemd 运行，无需服务器安装 Go、Node 或 Docker。来源为 `9ca41a4` 及本轮部署脚本修改，构建元数据如实标记工作区有修改。

最新运维复核：北京时间 **2026-11-11 00:53**，公网 22、80、443 均可连接，HTTP 返回 308 跳转到 HTTPS；Certbot 指定 `daynest-ip` 的续期演练全部通过。下文保留此前超时及演练失败的排查历史，不再代表当前状态。演练未替换正式证书，后续仍由已配置定时器执行正常续期。

## 服务与文件位置

| 项目 | 服务器位置或配置 |
| --- | --- |
| systemd 服务 | `daynest.service`，已启用开机启动和异常退出重启 |
| 版本目录 | `/opt/daynest/releases/<版本号>/` |
| 当前版本链接 | `/opt/daynest/current` |
| 网站资源 | `/opt/daynest/current/assets` |
| 程序 | `/opt/daynest/current/bin/daynest` |
| 备份工具 | `/opt/daynest/current/bin/daynest-backup` |
| 环境配置 | `/etc/daynest/daynest.env` |
| 数据快照 | `/var/lib/daynest/data/studyflow.json` |
| 上一份有效快照 | `/var/lib/daynest/data/studyflow.json.bak` |
| 运行身份 | 专用系统账号 `daynest` |
| Go 监听地址 | `127.0.0.1:8080`，仅回环 |
| 公网入口 | Nginx，TCP 80 / 443 |
| Nginx 配置 | `/etc/nginx/sites-available/daynest`、`/etc/nginx/snippets/daynest-proxy.conf` |
| TLS 证书 | `/etc/letsencrypt/live/daynest-ip/` |
| Certbot | `/opt/daynest-certbot/bin/certbot` |
| 续期定时器 | `daynest-certbot-renew.timer`，每天检查四次 |

JWT 密钥在服务器上随机生成，没有写入项目或本文。迁移保留原网站账号及密码哈希，更换 JWT 密钥后需重新登录。本机原数据保留，迁移后的两端独立保存，不会自动同步。

## 日常操作

SSH 登录服务器后执行：

```bash
sudo systemctl status daynest --no-pager
sudo systemctl restart daynest
sudo journalctl -u daynest -n 100 --no-pager
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
sudo nginx -t
sudo systemctl status nginx daynest-certbot-renew.timer --no-pager
curl --fail https://111.230.184.144/readyz
```

修改配置后执行 `sudo systemctl restart daynest`。数据每 15 秒保存一次，正常停止服务时再保存一次。滚动 `.bak` 与主数据在同一台服务器上，应另外保管完整备份。

## 创建完整备份

备份期间网站会短暂停机；完成后启动服务。每次使用全新的输出目录，备份包含所有账号与附件，需私密保管。

```bash
sudo install -d -m 0700 /var/backups/daynest
sudo systemctl stop daynest
sudo /opt/daynest/current/bin/daynest-backup create \
  --data-file /var/lib/daynest/data/studyflow.json \
  --output "/var/backups/daynest/$(date -u +%Y%m%dT%H%M%SZ)" \
  --service-stopped
sudo systemctl start daynest
```

备份或校验失败时也应执行最后一条启动命令。完整工具说明见 [backup-restore.md](backup-restore.md)。

## 后续版本部署

准备一个全新的版本目录，包含以下文件：

```text
bin/daynest
bin/daynest-backup
assets/index.html
assets/...
deploy-linux.sh
```

在项目根目录交叉编译，复制 `internal/httpapi/assets` 和 `scripts/deploy-linux.sh` 后打包上传：

```powershell
$env:GOOS = 'linux'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'
$release = 'daynest-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + (git rev-parse --short HEAD)
$payload = Join-Path '.local/deploy' $release
New-Item -ItemType Directory -Force "$payload/bin" | Out-Null
go build -trimpath -o "$payload/bin/daynest" ./cmd/api
if ($LASTEXITCODE -ne 0) { throw 'API build failed' }
go build -trimpath -o "$payload/bin/daynest-backup" ./cmd/backup
if ($LASTEXITCODE -ne 0) { throw 'Backup tool build failed' }
Copy-Item internal/httpapi/assets "$payload/assets" -Recurse
Copy-Item scripts/deploy-linux.sh "$payload/deploy-linux.sh"
tar -czf ".local/deploy/$release.tar.gz" -C $payload .
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
scp ".local/deploy/$release.tar.gz" ubuntu@111.230.184.144:/home/ubuntu/daynest-deploy/
```

在服务器上解压到新的私有目录，用该版本号调用安装脚本：

```bash
release=替换成实际版本号
cd /home/ubuntu/daynest-deploy
mkdir -m 0700 "$release"
tar -xzf "$release.tar.gz" -C "$release"
sudo bash "$release/deploy-linux.sh" "$PWD/$release" "$release"
```

日常升级不包含 `migration/`，使用现有服务器数据。首次迁移才附带完整备份目录 `migration/`；安装脚本拒绝用它覆盖已有服务器数据。

已有版本升级时，安装脚本自动获取部署互斥锁、短暂停止 Go 服务，将完整数据备份到 `/var/backups/daynest/pre-deploy-<版本号>/` 并执行独立校验，然后才切换程序。备份或校验失败则中止升级并启动旧服务；启动或健康检查失败则恢复旧程序链接并尝试启动，不回滚业务数据。恢复启动若仍失败会明确报错，需查看服务日志。备份保留在服务器本机，尚无自动异地复制或清理策略。

部署失败路径可以在 Linux 上运行 `python3 tools/deploy_linux_smoke.py` 演练。它只使用临时目录和模拟服务命令，不操作真实服务；覆盖正常发布、备份失败、校验失败、启动失败与健康检查失败。

## 当前功能边界

当前使用受信任的 IP HTTPS 证书；App 不跳过证书校验。Go 服务只接受回环连接，由 Nginx 转发，Nginx 显式阻止公网访问 `/api/v1/ai/`，并固定转发的 Host，保留本机 AI 授权限制。

HTTPS 安装脚本为 [setup-server-https.sh](../scripts/setup-server-https.sh)，前提是已安装 Nginx 和支持 IP 证书的 Certbot。它会备份原配置与数据，调整 Go 监听地址，并配置证书、反向代理和续期定时器。已运行的服务器无需重复执行首次安装流程。

证书采用 HTTP-01 验证，公网 TCP 80 必须持续可达，443 用于 App，22 用于 SSH 运维。仅修改防火墙模板不代表实例规则已经生效。2026-11-10 最后一次外部检测：443 可连接，22、80 超时；因此 SSH 运维和续期连通性尚未完成验收。此前 80 可达时续期演练已通过，不能替代当前网络检查。当前证书到期时间为 **2026-11-16 16:20（北京时间）**，应在到期前恢复 80 连通并重新演练：

```bash
sudo /opt/daynest-certbot/bin/certbot renew --dry-run
sudo journalctl -u daynest-certbot-renew.service -n 100 --no-pager
```

脚本最终配置会将普通 HTTP 请求跳转到 HTTPS，并保留 ACME 验证路径。服务器最后一次跳转配置变更期间 SSH 连接中断，公网 80 当前超时，实际跳转尚待复核；HTTPS 入口已独立验证正常。

2026-11-10 23:09（北京时间）再次从电脑和已连接的 Android 手机检测，两端均为 22、80 超时、443 可连接；电脑 HTTPS `/readyz` 返回 200，证书校验通过。手机与电脑是否共用上游网络未确认，因此不能据此排除所有来源网络限制。实例规则据用户核对已允许，下一步应从服务器控制台读取以下信息，区分监听服务、系统防火墙和云侧网络；无需先反复改规则：

```bash
sudo ss -lntp
sudo ufw status verbose
sudo systemctl --no-pager --full status ssh nginx
```

预期检查点为：SSH 监听公网可达地址的 22，Nginx 监听 80 / 443，Go 仅监听 `127.0.0.1:8080`。上述命令只读；SSH 尚无法建立 TCP 连接，当前未进入密码认证阶段。

随后按用户要求再次检测，**22 和 443 已连通，80 仍超时**。这一结果更新上面的历史检测状态；尚未重新完成 SSH 认证、服务器内部检查和续期演练。

本轮升级时 SSH 登录成功。服务器确认 Nginx 在 IPv4 / IPv6 的 80、443 监听，Go 监听回环 8080；UFW 未启用，所查看的 iptables / nftables INPUT 规则没有 80 拦截。HTTP 跳转已完成并通过本机请求验证为 308，ACME 路径保留。重新执行 Certbot 续期演练失败，证书机构也报告访问公网 80 连接超时；因此 80 的外部可达性仍是未解决事项，不能把本机监听正常视作续期已通过。下一步核对实例实际生效的云侧规则、优先级和其他网络限制；当前证据尚不足以定位具体拦截点。

北京时间 11 月 11 日 00:07，经用户授权进一步检查入站 TCP/80 SYN：15 秒内公网三次连接均超时，eth0 上匹配入站连接请求为 0，内核丢包为 0。结合本机服务检查，当前更指向实例网卡之前的网络路径；具体拦截点仍需云侧确认。详情见本轮验收中的精确网络检查记录。

项目中的 ChatGPT 授权接口要求真实回环来源与 localhost 主机名，直接访问公网 IP 不可用。部署保留了这一访问限制；本机 AI 注册信息、临时授权令牌和浏览器草稿不在迁移范围中。

## 本次验证

- `go test ./...` 通过，Linux 程序构建成功。
- 上传包 SHA-256 校验及完整数据备份的校验、恢复通过。
- 迁移后账号与全部业务集合的规范化内容与源快照一致。
- 使用服务器内临时令牌验证原账号读取；未提供令牌的私有接口返回 401。
- 服务成功写入数据快照；公网首页与健康接口返回正常，149 个静态资源的 HTTP 状态检查通过，服务重启后的数据内容保持一致。

没有使用原网站账号密码执行交互式登录；密码哈希在迁移校验范围内。

2026-11-10 的手机验收使用独立测试账号：真实 Android 15 上的 HTTPS 密码登录、待办 / 备忘录 / 日程创建、进程重启后的会话恢复与记录回读全部通过；独立 HTTPS API 回读三类记录也通过。原账号和原记录未用于写入测试。详见 [Android 0.2.0 验收](android-0.2.0-release.md)。

本轮后台升级通过完整备份与隔离恢复、升级前后业务集合一致性检查、原账号只读验证，以及公网 HTTPS / 首页 / 149 个资源状态 / 主脚本哈希 / 访问控制检查。手机测试账号的既有三类记录公网回读正常。本轮没有重新构建或安装 APK。详细记录见 [后台更新与恢复验收](server-upgrade-20261110.md)。
