# 日常 Daynest · Android

当前客户端版本为 **0.3.0 / versionCode 3**。App 内置公开网页资源，默认通过可信 HTTPS 连接 `https://111.230.184.144`，手机与网页使用同一服务端账号和记录，电脑无需保持开机。

## 使用

打开 App 后自动检查服务并进入登录页；使用网站原账号登录即可。有效登录状态会保留，重新打开会恢复；令牌过期后需要重新登录。App 不内置账号、密码或服务器 JWT 密钥。

连接正常时隐藏连接状态条。网络失败会保留已有登录与本机草稿，并提供重试和已保留资料入口。服务器切换放在「设置与诊断 → 连接设置」中；首次从旧版电脑连接模式升级时，默认转向个人云端并重新登录。旧服务的草稿按原账号与服务隔离保留。

邮箱输入关闭自动纠错；手机登录页压缩介绍区域，顶部信息卡片可横向滚动，保留日历、待办、备忘录等入口与 Android 返回键处理。

手机底部提供「今天、日历、待办、记录、全部」入口。「全部」可按名称搜索现有功能，收纳设置与数据、连接和主题；原有扩展页面仍可进入。天气等顶部信息保留在今天页，其他功能页减少重复占位。

备忘录打开后独立占满可用编辑区域，顶部可直接保存；预览、置顶、关联待办、导出、归档和回收站操作收在「更多」。Android 返回键先返回列表，保留原有草稿与保存机制。软键盘弹出时收起底部导航，并按实际可视高度调整编辑区与弹窗。

文件快传增加「传文件」「发文字」入口；跨设备地址改为当前选择的服务地址，通过原生剪贴板复制，不包含登录凭据。手机单文件上限仍为 8 MiB。收藏筛选和专注计时盘修复窄屏溢出，日历月视图缩小无效留白。

天气定位补齐 Android 前台粗略 / 精确位置权限声明。只有主动点击定位才由系统请求授权，拒绝时仍可搜索城市；不申请后台定位。定位实际结果仍取决于权限、系统位置服务和网络。

## 构建

需要 Node.js 22+、JDK 21、SDK Platform 36、所需 Build Tools 与 Platform Tools。`android/local.properties` 的 `sdk.dir` 应指向实际 SDK；预检现在与 Gradle 一样读取该文件，再回退到环境变量或系统默认位置。

已有依赖时，在 `mobile/` 运行：

```powershell
node scripts/preflight.cjs
node scripts/build.cjs
node scripts/configure-android.cjs
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
.\gradlew.bat :app:assembleDebug
```

构建输出为 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。初次准备依赖时使用 `pnpm install --frozen-lockfile --registry=https://registry.npmjs.org`；不关闭证书校验。个人 SDK 路径、缓存和签名私钥不提交到仓库。

产品默认服务在 `mobile/app-config.json` 中配置。此文件只包含公开地址。`mobile/native/` 是自有 Java / XML 源文件，`configure-android.cjs` 会复制到生成的 Android 工程；修改这些源文件后重新同步。

`package.json` 的版本及 `daynestAndroidVersionCode` 会同步到 Gradle。以后发布更新需递增版本号，保持应用 ID 与签名一致。覆盖安装使用：

```powershell
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` 保留数据。签名不匹配时应先核对原签名，不通过卸载来处理，以免丢失手机本机草稿和设置。当前是个人调试签名版本，未作为应用商店发布包。

## 检查与真机验收

项目根目录：

```powershell
node tools/check.cjs
node tools/verify-mobile.cjs
```

移动交互浏览器检查为 `node tools/mobile_ux_browser.cjs`，需要安装 Playwright；可用 `PLAYWRIGHT_MODULE` 指定模块、`PLAYWRIGHT_EXECUTABLE` 指定已安装浏览器。它使用隔离 Go 数据与模拟原生桥，检查 24 个页面的两种手机宽度、搜索导航、编辑保存、键盘尺寸变化、弹窗、快传入口、横屏和退出，不访问生产账号。

真实 Android 验收测试在 `android/app/src/androidTest/java/app/daynest/personal/CloudDeviceTest.java`。只对显式传入的 `@example.test` 隔离账号运行；未提供参数时跳过，不在测试代码或 APK 中写入账号密码。

在 `mobile/android/` 构建本应用的验收包：

```powershell
.\gradlew.bat :app:assembleDebugAndroidTest
```

测试覆盖实际 WebView 中的默认 HTTPS 连接、账号密码登录、待办 / 备忘录 / 日程表单，以及重开后登录恢复与记录回读。`nativePagesAndEditorsFitPhone` 另检查逐页宽度、常用编辑弹窗、物理返回键与真实软键盘；截图仅在测试 App 前台时写入其缓存。测试通过表单触发真实原生 HTTP 请求；输入使用 DOM 事件，不能代替对所有输入法的手工验收。测试包与产品 APK 分开，日常使用只需要产品 APK。

浏览器模拟桥报告、真机报告与 APK 构建是不同证据，不能互相替代。具体本轮结果见项目的发布验收记录。

0.3.0 的具体检查范围与限制见 [移动端适配验收](../docs/android-0.3.0-release.md)。

## 服务器与数据

部署操作见 [服务器部署说明](../docs/deployment.md)。服务器采用 Nginx HTTPS 入口，Go 服务仅监听回环地址。证书校验不放宽，公网 HTTP 不在 App 支持范围内；高级设置仍支持明确确认后的可信局域网 HTTP。

公网防火墙需保留 TCP 443；当前证书使用 HTTP-01 自动续期，还需保留 TCP 80。SSH 运维保留 TCP 22，亦可单独限制管理员来源。防火墙模板需要应用到实际实例。

业务记录使用服务器 JSON 快照，每 15 秒尝试保存，正常停止时再保存。业务提交与快照确认有区别。新版 App 沿用已有的保存状态、版本冲突、回执与本机草稿保护，不承诺整站即时写盘。

本机与服务器的数据目录独立；日常升级只发布程序和资源，不把本机 data/ 覆盖到服务器。浏览器 / App 的草稿、离线资料、主题与设备偏好属于各自本机内容，不会自动在设备之间同步。

## 功能边界

- 支持备忘录、待办和当日安排的有限离线查看，以及新简单待办的本机收集；联网后手动核验并提交。已有数据离线编辑和自动双向同步尚未实现。
- 普通请求取消 / 超时只表示客户端停止等待，保存结果不明时先核对回执或列表。
- 返回键优先关闭弹窗与侧栏，再返回页面；根页面返回后台。回到前台检查连接，不自动重放写入。
- 文件导出使用 Android「保存到」窗口，选择并写入完成才显示成功。手机上传单文件 8 MiB，单次导出 / 下载上限 64 MiB。
- 录音进入后台时停止，保留试听结果；尚无保证息屏准时运行的原生提醒服务。
- ChatGPT 授权仍限服务器本机，不向公网或手机版开放；本地饮食推荐等功能仍可使用。
- 天气、图书和资讯取决于外部来源及网络可达性。
