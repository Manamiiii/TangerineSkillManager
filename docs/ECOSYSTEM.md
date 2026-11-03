# 更新、市场与 Agent 支持状态

核实与实施日期：2026-11-02。用户已授权按推荐方案推进。下面区分已实现代码、真实验证与后续建议；不表示市场 API 或各 Agent 已完成端到端验收。没有推送、发布或修改用户的 Agent 目录。

## 已确认方向

- Windows 首发，未来支持 macOS/Linux；构建配置存在不等于平台已验证。
- 面向已有 Skill 使用经验、需要管理多个 Agent 或工程的用户。
- 保持本地库与同步核心独立，市场可选、无隐式联网、无必需账号。

后续网络实现：现在可在“设置 → 网络连接”显式保存 Cloudflare HTTPS DNS，应用内真实 Git 获取、两个市场搜索和无正式发行版查询均已验证；默认仍为系统 DNS，Fake-IP 保留地址仍被阻止。早期诊断测试见验证记录；现在无需测试脚本替换解析函数即可使用该选项。具体边界见 [网络连接](CONFIGURATION.md#网络连接)。

## 更新：两条独立流程

已实现：主动读取本仓库的 GitHub 正式 Releases，按数字比较版本，显示纯文本发行说明，并打开固定发行页面供用户选择适用系统与架构的下载。公开 Release 的查询不要求用户提供 token；实现处理限流、断网、404 无发行版/不可访问、异常响应，一分钟内缓存成功结果。不会根据服务响应跳转到任意下载地址。[GitHub Releases API](https://docs.github.com/en/rest/releases/releases)

当前实际构建目标是 Windows portable。已实现手动检查并打开固定仓库的发行页面；自动下载、退出安装尚未实现。未来若需要自动安装，可增加按用户安装的 NSIS 产物，保留便携版，不直接覆盖正在运行的 EXE。没有后台检查或发布凭据，不默认切换到预发行版；签名、下载校验和失败恢复须单独验收。[electron-builder v26 目标说明](https://www.electron.build/v26/docs/targets/)

Skill 更新继续由原始来源负责：仓库 URL、分支/标签、仓库子目录和 Skill 相对目录共同定位来源，记录具体 commit 和内容 hash。已实现文件变化预览与内容快照，15 分钟内单次应用；配置、本地内容或来源记录变化会阻止执行，预览后来源再次变化不会改变待应用快照。最多保留四份有大小限制的内存快照，重启后失效。更新本地库后，copy 副本仍需独立预览同步，symlink/junction 则实时引用库内容，界面明确提示此差异。不会隐式把固定标签改成默认分支。

已用真实 Electron 测试本地来源的预览后变化场景。显式 HTTPS DNS 诊断已访问真实 GitHub Releases API，返回无正式发行版/不可访问的 `unavailable` 状态；尚未验收真实新版本下载或安装。默认系统 DNS 仍因返回保留地址而被阻止。

## 多市场：发现与安装分离

下列是有公开入口或技术文档的候选，不是经市场份额统计得出的排名。

| 来源 | 可用依据 | 当前实现 |
| --- | --- | --- |
| GitHub 公开仓库 | GitProvider 已在显式 HTTPS DNS 诊断中完成真实获取、导入和 hash 检查 | agent-skills 主题仓库搜索已返回 20 条真实结果；结果须保存来源并发现 Skill 后才能导入，非全站 Skill 文件搜索 |
| skills.sh | 公开 Skill 目录与 API 文档；API 文档描述 Vercel OIDC 认证 | 已提供用户主动打开的浏览器入口；应用内搜索未接入 |
| SkillsMP | 文档提供匿名关键词搜索及限额，也提供 API key 模式 | 实验性匿名搜索已在显式 HTTPS DNS 诊断中返回 20 条真实结果；返回格式不符、要求认证或限流时明确失败，提供浏览器入口 |
| ClawHub | OpenClaw 的 Skill/插件 Registry | 已提供浏览器入口；专用搜索与制品安装尚未实现，不处理插件或自动安装依赖 |

参考：[skills.sh API](https://www.skills.sh/docs/api)、[SkillsMP API](https://skillsmp.com/docs/api)、[ClawHub 官方说明](https://docs.openclaw.ai/clawhub/quickstart)。第三方接口会变化，开发接入时须重新核实，不能把文档可读当成 API 实测成功。

“来源”页新增可展开的“发现 Skill”，用户勾选要查询的服务后主动搜索。统一候选对象保留名称、描述、原始 GitHub 地址、仓库、结果类型和市场名称，按原始来源身份去重，不仅比较显示名称；Git 路径大小写保留。暂不宣称提供市场安全认证、许可证审计或版本详情。搜索失败按市场独立显示；网络发现不进入文件写入队列，失败不影响本地库。下载经原有 Git Provider 安全暂存后进入本地库，SyncEngine 不感知市场品牌。

发现目录由独立 `MarketAdapter` / `MarketRegistry` 实现，不改已有来源 kind 或保存格式，也不冒充通用 Registry 下载 Provider。每次展示最多 20 条/来源，一分钟内复用成功结果（最多 20 个缓存项）；无自动重试或静默认证回退。当前仅支持配置结果对应的 GitHub 仓库，用户需要核对分支/子目录。将来如接入认证，凭据应单独保存到系统凭据存储，不写入普通配置或日志。

## 已实现的可选 Agent 模板

模板只填充可编辑配置，用户主动添加后才成为目标，不自动启用所有 Agent、不安装 Agent 软件。下面列出主要原生目录，不罗列所有兼容别名。实际启用还取决于 Agent 版本与用户配置；同步成功不等于该 Agent 已调用 Skill。

| Agent | 用户级目录 | 项目级目录 | 官方依据 |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills` | `{workspace}/.agents/skills` | [OpenAI Docs](https://learn.chatgpt.com/docs/build-skills) |
| Claude Code | `~/.claude/skills` | `{workspace}/.claude/skills` | [Claude 文档](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) |
| Cursor | `~/.cursor/skills` | `{workspace}/.cursor/skills` | [Cursor 文档](https://cursor.com/help/customization/skills) |
| GitHub Copilot（本地） | `~/.copilot/skills` | `{workspace}/.github/skills` | [VS Code 文档](https://code.visualstudio.com/docs/agent-customization/agent-skills) |
| Gemini CLI | `~/.gemini/skills` | `{workspace}/.gemini/skills` | [Gemini CLI 文档](https://geminicli.com/docs/cli/skills/) |
| OpenCode | `~/.config/opencode/skills` | `{workspace}/.opencode/skills` | [OpenCode 文档](https://opencode.ai/docs/skills/) |
| Cline | `~/.cline/skills` | `{workspace}/.cline/skills` | [Cline 文档](https://docs.cline.bot/customization/skills) |

OpenCode 使用自定义配置位置时由用户覆盖模板路径，不自动推断额外环境变量。Windows 原生运行与 WSL 是不同文件系统环境，本机模板不会自动写入 WSL，也不声称覆盖远程/云端 Agent。

一些 Agent 同时读取 `.agents/skills` 等兼容目录。安全层仍阻止重叠目标；Codex 模板与默认 Generic .agents 指向相同路径时，会提示并打开已有配置，不新增重复目标。模板只建议目录，不构成所有 Agent 的真实加载/执行验收。

Windsurf 的原技能文档目前跳转到 Devin Local 定制文档，存在产品与目录演进，建议后续按实际版本适配，不沿用截图猜测路径。[当前官方跳转目标](https://docs.devin.ai/desktop/devin-local/customizations)。OpenClaw 也应在核实其工作区、管理目录和专有元数据规则后再加入，避免仅凭 `SKILL.md` 文件名宣称全兼容。

## 后续验收与扩展

1. 在默认系统 DNS 能解析到公网地址的环境复验 `npm run test:services:public -- --run`。目前显式 HTTPS DNS 诊断已核实真实接口响应；默认解析仍被保护阻止，应用未加入静默 DNS 回退。
2. GitProvider 的真实获取、导入及更新检查已经通过诊断路径；后续选代表性 Agent 实测加载/调用，而不仅验证目录写入。
3. 验收干净 Windows 机器上的新便携版；若要自动安装更新，另行加入 NSIS 与签名分发流程。
4. 依据真实使用需要决定 skills.sh API 认证、ClawHub 专用适配和更多平台，不添加隐式后台连接。

以上后续步骤未完成；发布与创建 Release 仍遵守用户“不自行发布”的要求。
