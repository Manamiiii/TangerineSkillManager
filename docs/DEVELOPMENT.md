# 开发、测试与构建

## 测试与审计

```sh
npm run schema
npm run notices
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run audit:source
npm run audit:source -- --staged
npm run audit:package
npm audit
```

单元/集成测试使用临时目录，不触及真实 Agent 配置。桌面验收启动真实 Electron，在独立临时用户目录中通过 UI 新增 Agent、绑定项目、发现/导入示例、预览与同步、验证幂等并卸载副本。Linux 无显示服务器时使用 `xvfb-run -a npm run test:desktop`。截图和验收结果输出到被 Git 忽略的 `test-results`，其中可能显示本机测试路径，不要未经处理发布。

Git 的离线测试使用真实 Git 对象和 refs，仅替换网络传输；不冒充公网测试。具体已运行的结果及未执行平台见 [docs/VALIDATION.md](VALIDATION.md)。无 Rust 工程，所以 `cargo check` 不适用，不会报告为已通过。

公网测试必须显式指定 URL，不属于常规测试或启动过程：`npm run test:git:public -- <公开HTTPS仓库URL> <分支或标签> <包含SKILL.md的子目录>`。本机网络将域名解析到保留地址，首次真实公网验收被安全策略阻止；不得将此结果记作通过，或为通过测试而关闭地址校验。

应用更新与市场接口的真实网络检查：`npm run test:services:public -- --run`。它显式查询本仓库 GitHub Releases、GitHub 主题仓库和 SkillsMP 匿名搜索，将逐项结果写入 `test-results/public-services.json`；任何一项失败时返回非零退出码。单元测试的模拟响应不能替代此检查。常规 CI 不请求这些服务。

如果系统 DNS 返回保留地址，可以在**测试命令**末尾显式加 `--diagnostic-dns`。该选项仅在当前测试进程中向 Cloudflare 的 `https://1.1.1.1/dns-query` 查询指定服务域名的公开 IPv4 地址；不会修改系统设置，不进入应用代码，也不会自动回退。HTTP/Git 响应仍来自真实服务，公网地址限制、TLS 主机名和证书校验保持开启。第三方 DNS 服务会接收到这些域名查询，不会收到 Skill 内容或本机路径。服务结果单独写入 `test-results/public-services-diagnostic.json`，不得覆盖默认网络失败记录。

Windows 打包程序验收：先构建，再运行 `npm run test:desktop -- --packaged "<win-unpacked 中 EXE 的绝对路径>"`。它先用相同 Electron 运行时验证临时 profile 的实际解析位置，成功后才启动目标 EXE；子进程 PATH 为空，并核对应用实际配置位置。便携 EXE 使用同一命令并追加 `--portable`，通过仅限本机的调试端点连接封装器启动的应用。调试参数仅由测试传入，日常启动不启用。该测试使用本机已有系统环境，**不能代替干净虚拟机**。测试清理自己的来源、目标和应用数据；Windows 输入法等宿主组件创建的临时 profile 缓存留给系统清理，不终止这些宿主进程。

`npm run test:desktop -- --docs` 会从真实桌面流程生成 README 截图；先检查可见文本不包含当前账号名。截图使用示例数据，路径由应用正常显示为模板，原始路径仍可悬停查看。`npm run icons` 可重新生成应用图标。

`npm run test:desktop -- --public-network` 显式增加应用真实联网验收：通过 UI 保存 Cloudflare HTTPS DNS，检查持久化，再通过真实主进程查询本仓库发行版、GitHub/SkillsMP 搜索，以及 `obra/superpowers` 的 `main` 分支 `skills/writing-plans` 子目录导入与更新。这个测试不替换 DNS 函数或 HTTP 响应，结果保存到 `test-results/desktop-network-result.json`。可与 `--packaged "<EXE绝对路径>" --portable` 组合，结果写入 `portable-network-result.json`。普通桌面检查只保存/恢复设置，不发起外部请求。

## 构建与发布

发布门槛、当前证据和执行责任见 [发布前清单](RELEASE_CHECKLIST.md)；无需开发工具的发行包检查见 [干净 Windows 验收](WINDOWS_ACCEPTANCE.md)。清单不构成推送或发布授权。

```sh
npm run pack   # 未封装安装器的应用目录
npm run dist   # 当前平台的分发文件，禁止自动发布
```

- Windows 主机：x64 `TangerineSkillManager-<版本>-win-x64-Setup.exe` 和 `Portable.exe`。Setup 为当前用户安装，不请求提权，不自动启动应用；运行中的程序会阻止安装和卸载，返回非零退出码。`npm run checksums` 生成同目录 `SHA256SUMS.txt`。
- macOS 主机：`.dmg` 和 `.zip`；可用 `npx electron-builder --mac --arm64 --publish never` 或 `--x64` 指定架构。
- Linux 主机：AppImage；需要对应的系统构建工具与桌面运行库。

产物在 `release/`。macOS DMG/签名应在 macOS 构建。CI 配置了三个 OS 的任务；实际结果以 [Actions](https://github.com/Manamiiii/TangerineSkillManager/actions) 和 [验证记录](VALIDATION.md) 为准。它只生成待检查的产物，不创建发行版。签名、公证证书和 GitHub 发布权限由维护者通过仓库 Secrets 配置，源码不包含任何凭据。Windows 当前显式关闭签名，完成证书配置后需要有意修改构建选项。

## Windows 安装生命周期回归

构建脚本只覆盖测试身份、输出目录和版本，继承正式 `package.json` 的打包策略。不要再把整份 `build` 配置传入程序接口：对象数组会重复合并，导致相同资源被并发复制；`tests/installer-config.test.mjs` 使用真实打包配置解析器回归此边界。

```sh
npm run build
npm run build:installer-fixtures
npm run test:installer -- release/installer-acceptance/current/TangerineSkillManager-0.1.0-win-x64-Setup.exe release/installer-acceptance/previous/TangerineSkillManager-0.0.9-win-x64-Setup.exe
```

fixture 使用正式安装策略、相同应用代码与独立应用名称/GUID，避免影响正在运行的个人版本。旧版本 fixture 仅将版本号设为 0.0.9，用于验证安装器升级，不冒充历史业务数据迁移测试。实际安装到临时目录，临时写入测试应用的 HKCU 卸载登记和开始菜单入口，结束时卸载；检测到已有测试登记或同名快捷方式时拒绝覆盖。用户配置、库和同步目录都在隔离的临时 profile；不关闭用户已有程序，不读取真实 Skill 库。

回归检查首次安装、真实应用导入/同步、运行中拒绝升级与卸载、升级保留数据、卸载保留数据和副本、重装恢复库。结果保存在忽略的 `test-results/installer-result.json`，含两个 fixture 的 hash；诊断目录保留在系统临时目录，不上传。CI 的 Windows job 执行同一流程。它不能代替生产应用标识、交互安装向导、普通账号和干净 Windows 验收。

当前 Windows CI 还会运行正式 `win-unpacked` EXE 的隔离桌面检查，检查包内文件、身份、示例与构建输入一致，再运行独立身份安装器回归。安装回归额外核对 HKCU 卸载名称/版本/位置、开始菜单目标、未写入 HKLM、安装后的 ASAR 与 fixture 一致，以及 x64 运行时、sandbox/contextIsolation/webSecurity 和关闭 Node 集成。当前工作流**不上传安装包或测试 profile，也不创建 Release**；SHA256SUMS 仅在构建目录生成。

## 扩展 Provider

实现 [SkillSourceProvider](../src/core/providers.ts)，声明真实能力并在 `ProviderRegistry` 注册。Artifact 提供暂存目录、稳定 Skill ID、来源记录和 `dispose()`。应用服务通过统一入口写入本地库；SyncEngine 只消费本地库，不感知 Provider。UI 从 capability 描述生成可用状态。新增 source kind 时同步扩展配置契约和迁移，不能仅伪装为一个已支持类型。

详见 [docs/PROVIDERS.md](PROVIDERS.md)。第三方 Provider 不会隐式下载安装，首版不加载任意用户代码。

## 贡献与许可证

GNU GPL v3.0（`GPL-3.0-only`，仅第 3 版），全文见 [LICENSE](../LICENSE)。参与前请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)。第三方运行时和依赖保留各自许可证。
