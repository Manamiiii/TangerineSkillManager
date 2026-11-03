# 实际验证记录

## 2026-11-03：Windows 安装 CI 修复与候选复验

仅修改本仓库的构建/验收脚本、回归测试与文档，没有改业务、配置或数据格式。`c45a350` 的 [Windows CI](https://github.com/Manamiiii/TangerineSkillManager/actions/runs/41598129678) 在 fixture 构建时因 `EBUSY` 失败：将完整 `build` 配置再次传入 electron-builder 会重复合并对象数组，导致示例资源被并发复制。改为只传测试身份、版本和输出目录的覆盖字段，并通过真实配置解析器测试确保资源、目标及安装策略未重复或丢失。

本机实际通过：68 项测试（8 个文件）、类型检查与正式打包、源码隐私审计、8 个包内文件的一致性审计（另核对应用身份及内置示例）、正式 `win-unpacked` EXE 的 21 项桌面检查。独立名称/GUID 安装器完成 6 组回归：导入/同步、HKCU 卸载版本/位置及开始菜单目标、安装内容与 fixture 一致、x64 与 renderer 安全开关、运行中拒绝升级/卸载、退出后升级、卸载保留数据、重装恢复。检查使用临时 profile 和虚构数据；没有关闭用户运行中的便携实例。

新版 Portable 封装器也通过 21 项隔离 profile 桌面检查，退出码 0；格式与 `git diff --check` 通过。安装器测试过程中修正了测试自身对 Windows 卸载名称附带版本号、隔离开始菜单目录尚不存在时路径解析的断言，随后整套生命周期复验通过。

正式 Setup：0.1.0，123,802,132 bytes，SHA-256 `313f96f445a3968a635d224733cf634afaab4b0f493e2a42f61ace885518cd8a`。Portable：112,067,590 bytes，SHA-256 `425c06c48fde68a556dc5e248f7a4b47408dff3fbbd67c6966efe55e18ae7ff5`。文件均在 `release/`，附 `SHA256SUMS.txt`，未签名、未发布。历史记录中的 hash 只对应历史文件。

本轮 CI 新增正式打包 EXE 检查，并移除自动产物上传；不创建 Release。代码提交 `ad31e4c` 的 [远程 CI 复验](https://github.com/Manamiiii/TangerineSkillManager/actions/runs/41601852620) 已全部成功（Windows、macOS、Ubuntu）。Windows 日志确认：68 项测试、开发版 21 项桌面检查、正式打包程序 21 项桌面检查、包内容一致性审计与独立身份安装器 6 组生命周期回归通过，SHA256SUMS 生成成功。该运行 artifacts 列表为空，没有上传安装包或报告。记录结果及首页文案的后续提交只改文档，不重新打包，也不将其描述为重新执行了 CI。

本轮依赖审计：生产依赖 0 个已知漏洞；完整开发工具链仍有 15 项 moderate 告警，未执行强制修复。59 个仓库 Markdown 本地链接全部有效。

未验证：正式身份安装器的完整交互向导、干净 Windows 普通账号、真实历史业务迁移、macOS 实机安装。低版本 fixture 与当前版本使用同一源码，仅验证安装器升级。公网接口本轮未重测，历史记录保留其原有边界。

## Windows Setup 候选（2026-11-03）

本机 Windows x64：66 项单元/集成测试、类型检查和构建、格式、源码隐私审计通过。正式应用目录的 EXE 完成 21 项隔离 profile 桌面检查；8 个打包应用文件通过内容隐私检查，运行代码、界面和许可文件与源码构建逐字节一致。

独立测试名称/GUID 的 NSIS fixture 完成 5 组生命周期回归：安装并在真实应用中导入/同步示例；运行中拒绝升级与卸载；0.0.9 fixture 升至 0.1.0；卸载保留配置、库、安装记录及同步副本；重装恢复并清理测试安装入口。旧 fixture 使用当前代码，只验证安装器版本升级，不验证历史数据迁移。生产标识的安装器在已有便携实例运行时返回 2，未终止用户程序。结果见忽略的 `test-results/installer-result.json` 和 `packaged-result.json`。

正式候选为 `release/TangerineSkillManager-0.1.0-win-x64-Setup.exe`，123,802,138 bytes，SHA-256：`d600cdf69bc3b1845993e938d365470608bf8083befcc3e75c1b58f4172764ac`。同目录提供 Portable 和 SHA256SUMS.txt。全部未签名、未公开发布；生产标识交互向导、干净 Windows 普通账号和 macOS 安装未验证。新增 CI 流程以实际运行结果为准。

## 2026-11-03：三平台 CI 复验通过

[GitHub Actions 运行记录](https://github.com/Manamiiii/TangerineSkillManager/actions/runs/41575874377) 对应代码提交 `b349d66`。Windows、macOS、Ubuntu 三个任务全部成功：Node.js 24 环境安装依赖、schema 一致性、格式、类型检查、**66 项测试**、隐私审计、应用构建、桌面流程和未签名打包均通过；Windows 桌面检查 21 项，其余平台各 20 项。

这些结果验证 CI 宿主上的开发版桌面流程和打包，不代替各平台发行包的干净机器安装验收，不代表签名、公证或所有 Agent 实际调用通过。CI 仅上传构建产物，没有创建 Release。本节与 README 状态更新为文档变更，不改变上述已测代码。

## 2026-11-03：首次远程 CI 反馈

源码和首页文档已上传 main。首轮 GitHub Actions 中，Windows 的类型检查、65 项测试、隐私审计、构建和 21 项桌面检查通过；macOS/Linux 各有 1 项测试失败：目标目录变成普通文件时，预览在单项错误处理之前读取指纹，触发 ENOTDIR。

已将指纹读取移到目标校验之后的单项保护范围；无效目标返回冲突，不影响其他库操作，执行冲突计划也不会改写该文件。没有放宽文件安全检查。另补充通用 CI 账号词的误报防护，真实用户路径仍会被检查。本机复验 **66 项测试、类型检查、构建和 21 项桌面检查通过**；远程复验结果以 Actions 对应提交为准，不能将本机通过当作三平台通过。

本次依赖复查：`npm audit --omit=dev` 报告 0 个已知漏洞；全依赖审计报告打包工具链的 15 个 moderate 项，关联 minimatch 的传递依赖。自动建议涉及大版本降级，未执行 `audit fix --force`。正式发行前需评估兼容升级；此前“全部依赖 0 个漏洞”的历史结果不代表当前状态。

## 2026-11-03：GitHub 首页与公开资料检查

README 改为用途、安装、首次同步、支持边界的阅读顺序，完整问答移至 FAQ。公开路径使用 `~`、`{data}`、`{workspace}`，跨平台测试保留虚构的 Example/Project 路径。人工查看两张首页截图，未见个人目录、账号或真实 Skill 内容；三张 PNG 未包含文本或 EXIF 元数据。

补充隐私审计规则、暂存区审计、忽略本机数据与公开资料检查指南；审计不输出匹配到的秘密。新增回归测试验证 Windows/Unix 个人路径、通用模板、本机上下文、敏感文件和暂存旧内容场景。

本轮实际结果：**65 项测试（7 个文件）通过；21 项开发版桌面检查通过；类型检查、构建、格式、源码隐私审计通过；52 个本地文档链接有效；schema 重新生成无变化。** 没有改应用运行逻辑或重打便携包；此前 GPL 候选仍对应下节 hash。公网服务、干净机器与其他操作系统不计入本轮验证。

## 2026-11-03：GPL v3 许可证调整

维护者选择 `GPL-3.0-only`，已同步 LICENSE、项目/锁文件根元数据、README、贡献与开发说明、架构决策、内置示例和设置页。许可证全文来自 SPDX `license-list-data/text/GPL-3.0-only.txt`，设置页可离线查看；第三方依赖许可保持原样。

格式检查、源码审计（80 个文件）、包含类型检查的构建与 Windows 便携打包通过。逐字节核对打包 LICENSE 和示例与源码一致，核对包内项目许可与 UI 中的完整许可文本。新便携包在隔离临时用户环境完成 **21 项离线桌面检查**，退出码 0；没有重跑单元测试或公网检查，下面的 60 项单元测试和 24 项联网检查是此前版本的记录。

新产物：`release/gpl-20261103/Tangerine Skill Manager 0.1.0.exe`，112,070,753 bytes，未签名、未发布；同目录有 SHA256SUMS.txt。

```text
a7908720bcc513d74807117d1f1b9648515e73ba22c44ac8f2da5b3ac7a5998e
```

本次没有修改同步逻辑、数据格式或用户配置，没有提交、推送或创建 Release。干净 Windows、macOS/Linux 和真实发行下载流程仍未验证。

## 发布验收交接文档

已补充 [发布前清单](RELEASE_CHECKLIST.md) 和 [干净 Windows 验收步骤](WINDOWS_ACCEPTANCE.md)，区分自动验证、外部环境检查、发布授权和作者可选反馈。对照实际 UI、配置恢复和卸载保护代码核对步骤，并复核当前 EXE 的 SHA-256 与已有便携联网结果一致。本次只改文档，未重新运行单元测试、构建或桌面测试；下面保留实际运行记录。干净 Windows 环境仍未执行，没有推送或发布。

## 2026-11-02 后续：应用内可选 HTTPS DNS

新增“设置 → 网络连接”选项，默认继续使用系统 DNS；只有用户显式保存 Cloudflare HTTPS DNS 后，后续联网操作才使用该服务。本次实测通过应用保存的配置和实际主进程完成，**没有替换 DNS 函数或模拟 HTTP 响应**。

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | **60 项通过，6 个文件**。新增旧配置兼容、显式选项校验、保存/恢复不联网、模式即时生效、禁止静默回退、保留地址/本地名称保护、DNS 响应边界、超时/取消及 TLS 地址固定测试 |
| `npm run build` | **通过**，包含 TypeScript 类型检查。修正新增测试的类型标注后重新运行 |
| `npm run test:desktop` | **21 项通过**。新增 DNS 选择保存、刷新后保留、切回系统模式移除字段；此命令不发起外部网络请求 |
| `npm run test:desktop -- --public-network` | **24 项通过**。GitHub 与 SkillsMP 各返回 20 条真实搜索结果；公开 Git 子目录发现、导入、commit 记录及内容未变更新检查通过；GitHub Releases 返回 `unavailable` |
| `npm run dist -- --config.directories.output=release/network-20261102` | **通过**，生成新的 Windows x64 便携 EXE；仍未签名、未发布 |
| 新便携 EXE + `--portable --public-network` | **24 项通过，退出码 0**。通过实际便携封装器启动，空 PATH、临时 profile，保存配置后验证真实 Git、两个市场及版本接口；结果在 `test-results/portable-network-result.json` |
| 打包一致性 | **通过**。ASAR 中 main/preload/HTML/JS/CSS 共 5 个文件与当前构建逐字节一致 |
| 格式 / 源码审计 | **通过**。审计扫描 78 个仓库文件，未命中现有敏感内容规则 |

实际 UI 检查发现新下拉框缺少明确标签关联，增加 `aria-label` 后重新验收通过；已查看设置页截图，网络选项、数据说明、当前已保存状态和恢复入口可见。截图含临时测试路径，只保存在被忽略的 `test-results`。

当前交付：`release/network-20261102/Tangerine Skill Manager 0.1.0.exe`，**112,063,229 bytes**，`NotSigned`。同目录提供 `SHA256SUMS.txt`。

```text
d3fb85d107a171f6d700de7c38883194fb99192e5d76978ee3b96b7f569a6505
```

实际修改包括共享网络解析层、JSON/Git 注入、服务配置接线、版本检查缓存切换、设置 UI、可选配置 schema、测试及文档。原有配置可直接读取；新增 `network` 字段启用后，降级前需切回系统 DNS。没有改用户真实配置、系统 DNS 或代理，也没有提交、推送或发布。

边界仍然存在：系统 DNS 模式在本机 Fake-IP 环境会继续安全拒绝；HTTPS DNS 需要可达的 Cloudflare 和目标 HTTPS 服务，不是通用代理。没有干净 Windows 虚拟机、签名、真实新版本发行下载、macOS/Linux 或全部 Agent 调用的通过声明。此前诊断和旧产物记录保留如下。

## 2026-11-02 后续：真实公网与发行产物运行

仍为同一 Windows 主机，未改应用运行时代码、系统代理或系统 DNS，未推送或发布。以下记录补充并取代下文对应的“尚未验证”状态；历史失败保留。

| 检查 | 实际结果与边界 |
| --- | --- |
| GitHub / SkillsMP 真实搜索 | **通过**。显式 `--diagnostic-dns` 后，两个来源各返回 20 条真实结果，生产解析器成功处理响应；未模拟 HTTP |
| GitHub 应用更新查询 | **通过无正式发行版响应处理**。真实请求返回 `unavailable`，不是存在新版本、下载或安装成功的证明 |
| 公开 Git 完整获取 | **通过**。显式指定 `https://github.com/obra/superpowers.git`、`main`、`skills/writing-plans`，完成发现、导入、commit 来源记录和内容未变更新检查；使用生产 GitProvider，无 Git CLI |
| 默认网络路径 | **仍受阻**。本机默认解析返回 `198.18.0.0/15` 保留地址，触发 `PRIVATE_NETWORK`；没有把诊断成功写成默认路径成功 |
| `win-unpacked` 打包程序 | **19 项通过，退出码 0**。`app.isPackaged` 为真，实际配置位置位于临时 APPDATA，Node home 位于临时 USERPROFILE；PATH 为空 |
| 便携 EXE | **19 项通过，退出码 0**。实际运行下文 SHA-256 对应的 112,059,726 bytes EXE，经封装器解压启动后执行相同 UI 流程；结果写入 `test-results/portable-result.json` |
| 最终回归 | **51 项单元/集成测试、开发版 19 项桌面检查、类型检查、构建、格式检查均通过**。源码审计扫描 76 个文件未命中现有规则；打包运行内容与重新构建的 5 个文件逐字节一致 |
| 干净 Windows 机器 | **未运行**。本机没有可用的 Windows Sandbox、已安装 WSL 或已发现的虚拟机运行环境；隔离进程环境不是 OS 沙箱，宿主组件仍存在 |

显式 DNS 诊断仅存在于测试脚本，查询固定 Cloudflare HTTPS DNS 服务，保留公网地址校验、TLS 证书与目标主机名校验，HTTP/Git 仍访问真实远端。没有加入应用默认回退或绕过私网保护。复现方法与第三方 DNS 数据边界见 [开发说明](DEVELOPMENT.md)。服务测试结果分别保留在 `test-results/public-services.json`（默认失败）和 `public-services-diagnostic.json`（显式诊断成功）。

打包验收使用 `scripts/packaged-environment.mjs` 先验证临时 profile；便携封装器不转发调试 stderr，因此 `scripts/portable-launch.mjs` 改从隔离配置中的本机调试端点连接，未改动发行产物。修正了测试脚本中不存在的 `require` 上下文以及 Chromium home 与 Node home 混用的问题；前两次测试提前退出产生的错误弹窗不代表应用常规启动失败。清理时仅操作测试自己的数据，避开宿主输入法在临时 profile 创建的锁定缓存。

本轮没有重新打包发行 EXE：应用源码未变化，重新构建的运行内容与已有包一致，仅调整测试工具与文档。签名、真实新版本发行下载、其他操作系统和各 Agent 实际调用仍待验证。

## 2026-11-02 更新、Agent 模板与多来源发现

本轮仍在 Windows x64 / Node.js 26.5.0 / Electron 45.1.0 验证，没有推送或发布。

| 检查 | 本轮结果 |
| --- | --- |
| `npm test` | **51 项通过，5 个测试文件**。新增稳定版本比较、无发行版/错误/缓存、DNS 总超时、重定向拒绝、2 MiB 响应限制、外部链接范围、市场部分失败与缓存、模板路径/复用、Skill 内容快照与过期/修改保护 |
| `npm run typecheck` / `npm run build` | **通过**，最终界面与主进程均已构建；新增测试的类型错误已修复并重新检查 |
| `npm run test:desktop` | **19 项通过**，真实 Electron、临时用户数据。新验收覆盖模板复用、更新预览后来源再次变化仍安装预览内容、市场勾选入口、应用更新入口、非法外部 URL IPC 拒绝。应用更新/市场搜索的成功网络响应由单元测试模拟，不冒充桌面公网成功 |
| `npm run test:desktop -- --docs` | **通过**，更新 README 的真实本地库/同步截图。另查看 `test-results/` 下的模板、更新预览和市场界面；测试图片中的本机临时路径不进入公开截图 |
| `npm run format:check` / `npm run audit:source` | **通过**；审计扫描 73 个仓库文件，未命中现有敏感信息规则 |
| `npm run test:services:public -- --run` | **3 项受阻，未通过**：GitHub Releases、GitHub 搜索、SkillsMP 均因 DNS 返回私网/保留地址而触发 `PRIVATE_NETWORK`；没有关闭保护。逐项记录在 `test-results/public-services.json` |
| 新增依赖或持久化迁移 | **无**。使用现有依赖；配置与来源记录格式保持兼容 |
| `npm run dist -- --config.directories.output=release/validated-20261102` | **通过**。使用独立目录生成最新 Windows x64 便携版；主程序、preload、HTML/JS/CSS 共 5 个打包运行文件及内置示例与当前构建逐字节一致 |
| 新便携版签名 / 干净机器运行 | **未签名 / 未运行**，不宣称已完成签名发行或干净机器验证 |
| 各 Agent 实际加载/调用 Skill | **未逐一运行**。模板依据官方文档，已测配置与目录流程，不代表各产品端到端兼容性认证 |

首次桌面测试发现模板下拉框的标签定位问题，补充明确的可访问名称后重新通过。更新列表增加滚动，避免大型变更列表覆盖后续操作。常规 `npm run dist` 曾因 Windows 输出目录文件锁返回 `EPERM`；改用独立构建输出目录，不停止用户进程、不删除用户文件。

新增功能代码：`src/core/app-updates.ts`、`public-json.ts`、`markets.ts`、`skill-updates.ts`、`src/shared/agent-presets.ts`、`src/ui/Ecosystem.tsx`。实现状态见 [生态支持说明](ECOSYSTEM.md)。本段执行时公网、干净机器、签名和跨平台验证尚未完成；公网与产物运行的后续结果见本页顶部。以下保留先前基线，旧产物不是本轮交付。

本轮产物：`release/validated-20261102/Tangerine Skill Manager 0.1.0.exe`，112,059,726 bytes，`NotSigned`。同目录提供 `SHA256SUMS.txt`。SHA-256：

```text
9801753eb48f5ea515a3a163621b39010efb44d2b28ffaccabf2d88a1aba6439
```

## 先前基线（2026-10-30）

日期：2026-10-30。执行环境：Windows x64，Node.js 26.5.0，npm 11.17.0，Electron 45.1.0。这里仅记录实际执行结果；没有远程 CI、macOS/Linux 或干净虚拟机的通过声明。

| 检查 | 结果 | 范围与证据 |
| --- | --- | --- |
| `npm run schema` | 通过 | 重新生成前后 schema 与示例的 SHA-256 一致 |
| `npm run typecheck` | 通过 | TypeScript 无错误；最终构建也执行了类型检查 |
| `npm test` | 通过 | 3 个测试文件，36 项单元/集成测试 |
| `npm run format:check` | 通过 | 源码、脚本、测试及配置格式检查 |
| `npm run build` | 通过 | Vite 渲染器与 esbuild 主进程/preload 成功构建 |
| `npm run test:desktop` | 通过 | 真实 Electron，临时用户数据，Windows 14 项验收检查；子进程 PATH 为空，未依赖 Node/npm/Git CLI |
| `npm run test:desktop -- --docs` | 通过 | 真实 UI 截图，检查可见文本无当前账号名；人工查看本地库和同步截图，无明显遮挡/溢出 |
| `npm run audit:source` | 通过 | 扫描仓库文件，未发现规则覆盖的开发者账号名、私有地址、凭据或非公开 registry；另用 `rg` 检查参考图中的专用服务标识，无匹配 |
| `npm audit` | 通过 | 全部依赖报告 0 个已知漏洞；不等于安全认证 |
| `npm run notices` | 通过 | 生成 60 个生产依赖的许可证元数据与可用声明文本 |
| `npm run dist` | 通过 | Windows x64 portable EXE 已在本地生成，未发布 |
| 打包内容核对 | 通过 | ASAR 中 main/preload/notices 哈希与当前文件一致；资源目录确实包含内置 `Clear Plan` |
| Windows 签名核对 | 未签名 | Authenticode 状态为 `NotSigned`，未冒充签名发行版 |
| 真实公网 Git 闭环 | **受阻，未通过** | 手动指定公开 HTTPS 仓库、main 分支与 Skill 子目录；系统解析结果为私有/保留地址，`PRIVATE_NETWORK` 阻止连接。没有关闭安全校验或改动系统网络 |
| macOS/Linux 构建与桌面验收 | **未运行** | 已写 CI 和构建说明，本轮没有对应宿主，也未推送触发 CI |
| Node.js 24 | **未在本机运行** | 声明为开发建议版本并配置 CI；本机实测为 Node.js 26.5.0 |
| 打包 EXE 的干净机器运行 | **未运行** | 当前实测的是开发版真实 Electron进程与打包内容，不能替代另一台无开发环境机器上的测试 |
| Rust / `cargo check` | 不适用 | 项目选择 Electron/TypeScript，没有 Rust 工程 |

## 单元与集成覆盖

配置默认值、严格校验、v0 迁移、损坏恢复与原文件保留；多平台路径展开、相对路径、遍历保护；Markdown/YAML 解析和内容哈希；复制、junction/symlink、外部链接、外部文件、标记伪造；元数据 copy 强制与文件冲突；计划失效、幂等和单项 I/O 失败；只读来源名称冲突及删除保护；隐藏/空目录保护；本地来源损坏项隔离；Git 对象、refs、子目录与来源身份变更；离线状态；失效 Agent 目录不阻塞本地库工作。

Git 离线测试使用真实 Git 对象和分支/标签，只替换网络 clone 传输。首次来源身份回归测试在旧行为下失败（错误地报告另一子目录内容可更新），修复后通过。它不是公网连通性证明。

## 桌面核心流程

从空配置启动 → 显式导入内置示例，确认 Agent 目录未被自动创建 → 新增 Agent（自动标识）→ 绑定项目 → 添加本地来源（按能力展示字段）→ 发现并导入 → 选择用户级与项目级目标 → 预览并执行两个 copy 操作 → 再次预览为跳过 → 卸载指定副本 → 验证旁边的外部文件仍在。全过程没有 renderer Node API，没有 renderer 异常。

路径只使用临时测试目录，没有修改真实 Agent 或用户工程。README 截图位于 `docs/images/`，使用正常 UI 的路径模板显示，不包含个人绝对路径。

## 本地 Windows 候选产物

文件：`release/Tangerine Skill Manager 0.1.0.exe`。大小：112,067,295 bytes。状态：**未签名、未公开发布**。

SHA-256：

```text
dd5f9d88d8b386214c4a49267877d0689d002d2afee1c6aef9945268032e13c0
```

同目录保存 `SHA256SUMS.txt`。该校验值仅对应本次本地产物，重新构建后应重新生成。

## 发布门槛

目前可以做受控的 Windows 首版试用，不能宣布全平台稳定版。真实公网接口与便携 EXE 的本机核心流程已验证；公开推广前仍应完成默认公网 DNS 环境复验、干净机器体验、所宣称平台的实际验证，以及按计划完成签名/公证与下载说明。本轮没有推送、Release 创建或其他发布操作。
