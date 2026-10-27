# 日常 Daynest · Android

这是「安卓 App 连接电脑 Go 服务」模式。界面、样式和图标打包在 APK 中，API 通过原生网络通道连接你指定的电脑。手机和网页登录同一账号后，使用电脑上同一份业务记录；服务端无需复制数据或重新注册账号。

**交付状态：Android 工程和前端资源已生成，连接与文件通道有自动化检查；尚未构建 APK、安装手机或完成真机验收。** 当前电脑有 JDK 21，但 Android SDK 仅 API 30；项目采用 Capacitor 8，要求 SDK 36。下面的 APK 路径是构建成功后的输出位置，当前没有该产物。

## 1. 启动电脑服务

先停止原来占用端口的 Go 服务。在项目根目录执行：

```powershell
.\scripts\run-mobile-server.ps1 -HTTPAddr ':8080'
```

脚本只在本次进程中设置环境变量，结束后恢复。已有专用 `JWT_SECRET` 会直接复用；没有时生成随机密钥，保存到忽略提交的 `.local/android-jwt.key`，后续启动继续使用。不要分享或提交这个文件，也不要给不同服务复用同一个密钥。第一次替换密钥后原有网页登录会过期，重新登录即可，历史记录不变。脚本不会修改防火墙或系统环境变量，也不会替你终止旧服务。

也可自行配置 `JWT_SECRET`（至少 24 字符、足够随机）和 `HTTP_ADDR` 后继续用 `go run ./cmd/api`。App 会拒绝连接仍使用公开开发密钥的服务。`DATA_FILE` 等配置沿用项目原来的方式。

用 `ipconfig` 找到电脑当前 Wi-Fi / 以太网适配器的 IPv4，例如 `192.168.1.10`。手机应与电脑位于同一可信局域网。先在手机浏览器访问 `http://192.168.1.10:8080/healthz` 检查是否可达；看到 JSON 就表示服务连通。若不通，检查监听地址、端口、防火墙和路由器的设备隔离。由你自行决定是否允许该端口通过专用网络防火墙。

## 2. 构建并安装 App

需要：

- Node.js 22 或更高版本、pnpm，以及现有 Go 环境。
- JDK 21。
- 支持 Android Gradle Plugin 8.13 的 Android Studio；在 SDK Manager 安装 **Android SDK Platform 36**、对应 Build Tools 和 Platform Tools。
- Android 7.0 / API 24 或更高的手机，并保持 Android System WebView 更新。系统版本满足最低要求不等于旧 WebView 能运行所有现代网页能力。

依赖精确版本保存在 `package.json`，完整依赖树保存在 `pnpm-lock.yaml`。在项目根目录执行：

```powershell
cd mobile
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm android:sync
pnpm android:open
```

已有 `android/` 工程，**不必再次执行 `android:init`**。`android:sync` 会打包原项目公开前端、复制自有 Java / XML 文件并同步 Capacitor 插件。它不会把用户 JSON、`.env`、账号或签名密钥加入 App，也没有配置远程 `server.url`。

在 Android Studio 中选择已连接手机运行，或使用 Build 菜单生成调试 APK。也可在 `mobile/android` 中执行：

```powershell
.\gradlew.bat assembleDebug
```

成功后文件在 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。可以复制到手机安装，或使用 SDK 的 `adb install -r` 安装。首次构建会下载 Gradle 和 Google / Maven 依赖，需要能正常访问这些官方服务。遇到证书错误应修复证书或网络配置，不要关闭 TLS 校验。

若命令行找不到 SDK，通过 Android Studio 选择本机 SDK 路径，或在忽略提交的 `android/local.properties` 中填写 `sdk.dir`；不要提交个人电脑路径。发布版需另行配置自己的签名，当前没有预置发布证书。

## 3. 首次连接

1. 打开 App，在连接向导输入电脑地址，例如 `http://192.168.1.10:8080`。地址只能包含协议、主机和端口。
2. 使用 HTTP 时，确认只在可信 Wi-Fi 中使用：登录密码、令牌和记录是明文传输。HTTP 仅允许明确的 RFC 1918 局域网 IPv4。其他主机需使用有可信证书的 HTTPS；不跳过证书校验。
3. 点击「检查并连接」。App 检查新版服务的 `/api/v1/mobile-info`，通过后才初始化功能页面。
4. 登录原账号。手机上的 `localhost` 指手机自身，不能用来连接电脑；Android 模拟器可用 `http://10.0.2.2:8080`。

登录后的顶部有「已连接电脑 · 连接设置」。切换电脑会要求确认并清除当前设备的登录令牌和专注临时信息，再重新登录；原电脑的数据不会删除。正在进行文件操作时不能切换。连接配置只记住服务器地址和 HTTP 确认，不内置账号或服务端密钥。

## 使用体验与边界

- **电脑需要持续运行。** 界面本地打包，业务数据仍依赖 Go 服务；不提供离线写入、云端中转或自动离线合并。未确认保存成功时请保留内容，恢复连接后核对。现有服务采用内存状态与周期性 JSON 快照，App 不改变其落盘语义。
- **更新方式。** 修改 Go 代码后重启电脑服务；修改界面或原生代码后执行 `pnpm android:sync`，重新构建并安装 APK。已安装 App 不会自动加载电脑上的新版前端。
- **返回与重连。** 返回键优先关闭弹窗、侧栏，再返回上一页面；根页面切回后台。初始连接页可用系统返回键切回后台。回到前台会检查电脑是否可达，保留现有草稿和登录；没有自动重放失败写请求。
- **文件。** 下载和导出先进入 App 私有暂存，再弹出 Android「保存到」窗口；只有用户选择位置且写入完成才显示成功。取消保存不算成功。若写入中断，所选位置可能留下不完整文件，请核对后自行清理。正常完成 / 取消会清理私有暂存；进程异常终止可能遗留缓存，可通过系统清除 App 缓存处理。
- **大小限制。** 原生下载 / 单次导出上限 64 MiB；文件快传在手机上传单文件最多 8 MiB，电脑网页仍为 32 MiB。上传进度显示原生网络写入进度，保存结果以服务确认和后续列表核对为准；上传失败原样重试继续使用同一个任务 ID。
- **请求取消。** 普通 API 的超时或取消会停止客户端等待，但不能保证已发出的原生 HTTP 请求在服务端停止。不要因界面超时就假定写入失败；先刷新核对。原生文件通道另有断开连接和清理处理。
- **后台和录音。** 手机进入后台会结束录音，返回后可试听并保存；不会在后台持续录音。专注计时沿用服务状态，但轻提醒、声音和网页通知不保证在息屏、系统休眠或 App 被结束时准时运行；当前没有原生后台提醒服务。
- **设备偏好。** 主题、导航整理、轻提醒等原本保存在浏览器的偏好，在 App 内是独立的本机配置；账号业务记录保存在电脑。卸载 / 清除 App 数据会清掉本机配置和登录，不删除电脑数据。App 禁用 Android 自动备份，登录令牌沿用本地网页存储，不承诺系统密钥库级保护。
- **电脑专用接口。** ChatGPT 本机授权等 AI 接口保持电脑回环限制，手机版会明确提示仅电脑可用，饮食本地推荐仍可使用；没有开放或绕过这些接口。
- **外部内容。** 天气、新闻和图书等内容仍受原有来源和网络条件影响；打开外链使用系统处理，App 不放宽 WebView 的远程导航或混合内容限制。

## 开发与验证

源代码入口：`src/mobile-client.js` 为连接和生命周期，`src/core.js` 为地址策略，`src/mobile.css` 为移动界面，`native/` 为自有 Android 文件通道与资源。`scripts/configure-android.cjs` 会将 `native/` 复制进 `android/`，请修改源文件，避免下次同步覆盖修改。

本次通过了 Go 全量测试、`go vet`、53 项前端冒烟测试，以及 Java 源码 / API 测试桩检查。另在 390 × 844 的浏览器窗口中，使用隔离临时账号、真实 Go 服务和模拟原生桥验证了连接、登录、日历渲染、创建待办后 API 回读、备忘录入口和返回键弹窗处理；检查了窄屏布局，并压缩了 App 顶部工具区。该浏览器检查仍不能证明 Android 系统文件窗口、权限和 WebView 的设备行为。

在项目根目录运行：

```powershell
go test ./...
go vet ./...
node tools/mobile_smoke.cjs
node tools/mobile_connection_smoke.cjs
node tools/toolkit_pocket_smoke.cjs
```

已有 Android SDK 时可额外进行 Java 源码与地址策略检查（将路径换成自己的）：

```powershell
.\mobile\scripts\check-java.ps1 -AndroidJar 'C:\Users\你的账号\AppData\Local\Android\Sdk\platforms\android-36\android.jar'
```

该检查使用最小 Capacitor API 测试桩，能发现 Java 语法、基础 Android API 和地址策略问题，**不等于完整 Gradle 构建或设备验证**。这些测试桩不进入 App。

安装后需在真机完成：首次连接、原账号登录、日历 / 备忘录写入后网页回读、断网后保留输入、前后台计时、弹窗及侧栏返回、切换电脑重新登录、录音拒绝与授权及后台停止、文件上传 / 取消 / 保存 / 导出、系统保存窗口取消、横竖屏与大字号、深色模式、外部链接。使用临时账号验证，不要拿唯一副本测试删除操作。

技术依据：[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[配置](https://capacitorjs.com/docs/config)、[原生 HTTP](https://capacitorjs.com/docs/apis/http)、[App 生命周期与返回键](https://capacitorjs.com/docs/apis/app)。
